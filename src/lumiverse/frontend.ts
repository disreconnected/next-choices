import type {
    SpindleFrontendContext,
    SpindleInputBarActionHandle,
} from 'lumiverse-spindle-types';
import { errorMessage } from '../shared/error';
import { parseChoices } from '../shared/parse';
import {
    appendCombinationTask,
    appendEnhancementTask,
    appendGuidedTask,
    buildHistory,
    buildPromptAsync,
    type PromptVars,
} from '../shared/prompt';
import { DEFAULT_SETTINGS, MODULE_NAME, type NextChoicesSettings } from '../shared/settings';
import { getLocale, setLocale, tr } from './i18n';
import { createRpcClient, RpcError, type ContextReply, type RpcClient } from './rpc-client';
import {
    createSettingsPanel,
    type ProfileOption,
    type SettingKey,
    type SettingsPanel,
} from './settings-panel';
import { STYLES } from './styles';
import { CONTAINER_ID, createChoicesUi, type ChoicesUi } from './ui/choices-ui';
import { h, isRendered } from './ui/dom';
import {
    AUTO_GENERATE_DEBOUNCE_MS,
    chatIdFromChatChanged,
    createEventFilter,
} from './ui/event-filter';
import { createGuidanceEditor, type GuidanceEditor } from './ui/guidance-editor';
import { COMPASS_SVG, DICE_SVG } from './ui/icons';
import { createQuickButtons } from './ui/quick-buttons';
import { NoConversationError, type RequestHandle, type RewriteTask } from './ui/types';

const LOG = `[${MODULE_NAME}]`;
const SAVE_DEBOUNCE_MS = 300;

type Reason = 'manual' | 'auto' | 'guided';

export function setup(ctx: SpindleFrontendContext): () => void {
    let disposed = false;
    const cleanups: Array<() => void> = [];
    const track = (fn: (() => void) | void | undefined | null): void => {
        if (typeof fn === 'function') cleanups.push(fn);
    };

    setLocale(ctx.locale.get());

    const settings: NextChoicesSettings = { ...DEFAULT_SETTINGS };
    const rpc: RpcClient = createRpcClient(ctx);
    track(() => rpc.dispose());
    ctx.ready();
    track(ctx.dom.addStyle(STYLES));

    function getActiveChat(): { chatId: string | null; characterId: string | null } {
        try {
            const { chatId, characterId } = ctx.getActiveChat();
            return { chatId: chatId ?? null, characterId: characterId ?? null };
        } catch {
            return { chatId: null, characterId: null };
        }
    }

    const filter = createEventFilter({ getActiveChatId: () => getActiveChat().chatId });
    let lastUserName = '';
    let lastChatId: string | null = getActiveChat().chatId;

    let mountRoot: HTMLElement | null = null;
    let container: HTMLElement | null = null;
    let mountWarned = false;
    let guidanceEditor: GuidanceEditor | null = null;
    let settingsPanel: SettingsPanel | null = null;
    let settingsHeading: HTMLElement | null = null;
    const inputActions: Array<{ handle: SpindleInputBarActionHandle; label: string }> = [];

    let sequence = 0;
    let abortController: AbortController | null = null;
    let autoTimer: ReturnType<typeof setTimeout> | undefined;

    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let saveDirty = false;

    function ensureMounted(): HTMLElement | null {
        if (disposed) return null;
        if (container && container.isConnected && mountRoot?.contains(container)) return container;
        let root: Element | null = null;
        try {
            root = ctx.ui.mount('chat_composer_above');
        } catch (err) {
            if (!mountWarned) console.warn(`${LOG} The composer mount point is not available:`, err);
            mountWarned = true;
            return null;
        }
        if (!root) return null;
        mountRoot = root as HTMLElement;
        container ??= h('div', { id: CONTAINER_ID, className: 'next-choices-container', hidden: true });
        if (container.parentElement !== mountRoot) mountRoot.append(container);
        if (guidanceEditor && guidanceEditor.wrapper.parentElement !== mountRoot) {
            mountRoot.insertBefore(guidanceEditor.wrapper, container);
        }
        return container.isConnected ? container : null;
    }

    function cancelAutoTimer(): void {
        clearTimeout(autoTimer);
        autoTimer = undefined;
    }

    function armAutoTimer(): void {
        cancelAutoTimer();
        if (!settings.enabled || !settings.autoGenerate) return;
        autoTimer = setTimeout(() => {
            autoTimer = undefined;
            if (settings.enabled && settings.autoGenerate) void generateChoices('auto');
        }, AUTO_GENERATE_DEBOUNCE_MS);
    }

    function abortPending(): void {
        sequence++;
        try {
            abortController?.abort();
        } catch {}
        abortController = null;
        guidanceEditor?.setBusy(false);
    }

    function beginRequest(): RequestHandle {
        abortPending();
        const id = sequence;
        const controller = new AbortController();
        abortController = controller;
        return { signal: controller.signal, isCurrent: () => id === sequence };
    }

    function focusComposer(): void {
        try {
            ctx.composer?.focus();
        } catch {}
    }

    function restoreFocusToLauncher(opener: Element | null): void {
        const candidates: Array<Element | null | undefined> = [opener, ...quick.elements()];
        for (const candidate of candidates) {
            if (isRendered(candidate)) {
                candidate.focus();
                return;
            }
        }
        focusComposer();
    }

    function restoreFocusAfterStop(target: Element | null): void {
        const launchers = quick.elements();
        const keepTarget =
            isRendered(target) &&
            target !== document.body &&
            !container?.contains(target) &&
            (launchers.includes(target) || target.matches('textarea, [contenteditable="true"]'));
        const candidates: Array<Element | null> = keepTarget ? [target, ...launchers] : launchers;
        for (const candidate of candidates) {
            if (isRendered(candidate) && !(candidate as HTMLButtonElement).disabled) {
                candidate.focus();
                return;
            }
        }
        focusComposer();
    }

    function getGuidanceEditor(): GuidanceEditor {
        if (!guidanceEditor) {
            guidanceEditor = createGuidanceEditor({
                tr,
                place(wrapper) {
                    const target = ensureMounted();
                    if (!target || !mountRoot) return false;
                    if (wrapper.parentElement !== mountRoot || wrapper.nextElementSibling !== target) {
                        mountRoot.insertBefore(wrapper, target);
                    }
                    return wrapper.isConnected;
                },
                onSubmit: (theme) => void generateChoices('guided', theme),
                onOpenChange: (open) => quick.setGuidedExpanded(open),
                restoreFocus: restoreFocusToLauncher,
            });
        }
        return guidanceEditor;
    }

    function resetGuidance(): void {
        guidanceEditor?.destroy();
        guidanceEditor = null;
        quick.setGuidedExpanded(false);
    }

    function toggleGuided(opener: Element | null): void {
        if (!settings.enabled) return;
        const editor = getGuidanceEditor();
        editor.setOpen(!editor.isOpen(), opener);
    }

    function connectionId(snapshot: NextChoicesSettings): string | null {
        return snapshot.profileId && snapshot.profileId !== 'current' ? snapshot.profileId : null;
    }

    function promptVars(info: ContextReply, snapshot: NextChoicesSettings, numChoices: number): PromptVars {
        return {
            history: buildHistory(info.history, snapshot.historyDepth),
            numChoices,
            user: info.userName || 'User',
            char: info.charName || 'Assistant',
            persona: info.persona,
        };
    }

    function buildBasePrompt(
        info: ContextReply,
        snapshot: NextChoicesSettings,
        numChoices: number,
        chatId: string,
        characterId: string | null,
    ): Promise<string> {
        return buildPromptAsync(snapshot.promptTemplate, promptVars(info, snapshot, numChoices), (text) =>
            rpc.resolveMacros(text, chatId, characterId),
        );
    }

    async function generateChoices(reason: Reason = 'manual', guidance = ''): Promise<void> {
        if (disposed || !settings.enabled) return;
        if (reason === 'auto' && !settings.autoGenerate) return;

        const guided = reason === 'guided';
        const theme = guided ? String(guidance ?? '').trim() : '';
        if (guided && !theme) return;

        const { chatId, characterId } = getActiveChat();
        if (!chatId) return;

        const snapshot: NextChoicesSettings = { ...settings };

        if (guided) cancelAutoTimer();
        const focusTarget = document.activeElement;

        const handle = beginRequest();
        if (guided) guidanceEditor?.setBusy(true);
        if (reason !== 'auto') choicesUi.renderLoading(handle, focusTarget);

        let text: string;
        try {
            const info = await rpc.getContext(chatId, characterId, snapshot.historyDepth);
            if (!handle.isCurrent()) return;
            lastUserName = info.userName;

            if (info.history.length === 0 || (reason === 'auto' && info.lastIsUser)) {
                if (reason === 'auto') return;
                if (guided) {
                    guidanceEditor?.setBusy(false);
                    guidanceEditor?.setStatus(tr('No conversation is available to generate choices.'));
                    choicesUi.clear();
                } else {
                    choicesUi.renderNotice(tr('No conversation is available to generate choices.'));
                }
                return;
            }
            if (reason === 'auto') choicesUi.renderLoading(handle, focusTarget);

            const base = await buildBasePrompt(info, snapshot, snapshot.numChoices, chatId, characterId);
            if (!handle.isCurrent()) return;
            const prompt = guided ? appendGuidedTask(base, snapshot.numChoices, theme) : base;
            text = await rpc.generate(prompt, connectionId(snapshot), snapshot.maxTokens, handle.signal);
        } catch (err) {
            if (!handle.isCurrent()) return;
            if (guided) guidanceEditor?.setBusy(false);
            console.error(`${LOG} Generation failed:`, err);
            choicesUi.renderError(errorMessage(err), theme);
            return;
        }

        if (!handle.isCurrent()) return;
        if (guided) guidanceEditor?.setBusy(false);

        const choices = parseChoices(text, snapshot.numChoices);
        if (!choices.length) {
            choicesUi.renderError(tr('Could not parse choices from the model response'), theme);
            return;
        }
        choicesUi.renderChoices(choices, theme);
        if (guided && guidanceEditor?.isOpen()) guidanceEditor.setOpen(false);
    }

    async function runRewrite(handle: RequestHandle, task: RewriteTask): Promise<string> {
        const { chatId, characterId } = getActiveChat();
        if (!chatId) throw new NoConversationError();
        const snapshot: NextChoicesSettings = { ...settings };

        const info = await rpc.getContext(chatId, characterId, snapshot.historyDepth);
        if (!handle.isCurrent()) throw new RpcError('Superseded', true);
        if (info.history.length === 0) throw new NoConversationError();
        lastUserName = info.userName;

        const numChoices = task.kind === 'enhance' ? task.originals.length : 1;
        const base = await buildBasePrompt(info, snapshot, numChoices, chatId, characterId);
        if (!handle.isCurrent()) throw new RpcError('Superseded', true);
        const prompt =
            task.kind === 'enhance'
                ? appendEnhancementTask(base, task.originals, task.guidance)
                : appendCombinationTask(base, task.selected);
        return rpc.generate(prompt, connectionId(snapshot), snapshot.maxTokens, handle.signal);
    }

    function isBusyError(err: unknown): boolean {
        const code = (err as { code?: unknown } | null)?.code;
        return code === 'COMPOSER_BUSY' || errorMessage(err).includes('COMPOSER_BUSY');
    }

    async function applyChoice(text: string): Promise<void> {
        const composer = ctx.composer;
        if (!composer) {
            choicesUi.renderNotice(tr('The message composer is not available.'));
            return;
        }
        try {
            composer.setText(text);
        } catch (err) {
            console.error(`${LOG} Failed to fill the composer:`, err);
            choicesUi.renderNotice(tr('The message composer is not available.'));
            return;
        }
        choicesUi.clear();
        if (!settings.autoSend) {
            focusComposer();
            return;
        }
        try {
            await composer.send();
        } catch (err) {
            choicesUi.renderNotice(
                isBusyError(err) ? tr('Send failed: chat is busy') : tr('Send failed: ') + errorMessage(err),
            );
        }
    }

    const quick = createQuickButtons({
        tr,
        mount: () => ctx.ui.mount('chat_input_tools_left'),
        isWanted: () => settings.enabled && settings.showQuickGenerateButton,
        onGenerate: () => void generateChoices('manual'),
        onGuided: (opener) => toggleGuided(opener),
    });
    track(() => quick.destroy());

    const choicesUi: ChoicesUi = createChoicesUi({
        tr,
        getContainer: ensureMounted,
        peekContainer: () => container,
        isEnabled: () => settings.enabled,
        getUserName: () => lastUserName,
        applyChoice: (text) => void applyChoice(text),
        regenerate: (guidance) => void generateChoices(guidance ? 'guided' : 'manual', guidance),
        beginRequest,
        abortPending,
        cancelAutoTimer,
        runRewrite,
        restoreFocusAfterStop,
    });

    function resetTurn(): void {
        cancelAutoTimer();
        abortPending();
        choicesUi.clear();
        resetGuidance();
    }

    function applyEnabledState(): void {
        for (const { handle } of inputActions) handle.setEnabled(settings.enabled);
        quick.sync();
    }

    function scheduleSave(): void {
        saveDirty = true;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
    }

    function flushSave(): void {
        clearTimeout(saveTimer);
        saveTimer = undefined;
        if (!saveDirty) return;
        saveDirty = false;
        rpc.saveSettings({ ...settings }).catch((err) => {
            if (!(err instanceof RpcError && err.aborted)) console.warn(`${LOG} Failed to save settings:`, err);
        });
    }

    function onSettingChanged(key: SettingKey): void {
        switch (key) {
            case 'enabled':
                cancelAutoTimer();
                abortPending();
                choicesUi.clear();
                if (!settings.enabled) resetGuidance();
                applyEnabledState();
                break;
            case 'autoGenerate':
                cancelAutoTimer();
                abortPending();
                choicesUi.clear();
                break;
            case 'showQuickGenerateButton':
                quick.sync();
                break;
            default:
                break;
        }
        scheduleSave();
    }

    async function listProfiles(): Promise<ProfileOption[] | null> {
        const api = ctx.connections;
        if (!api) return null;
        const supportsKinds = Boolean(ctx.host?.capabilities?.['connection-kinds-v1']);
        const listed: ReadonlyArray<{ id: string; name: string; model?: string }> = supportsKinds
            ? await api.list({ kind: 'llm' })
            : await api.list();
        return listed.map((profile) => ({ id: profile.id, name: profile.name, model: profile.model }));
    }

    function initSettingsPanel(): void {
        const section = ctx.ui.mount('settings_extensions') as HTMLElement;
        settingsHeading = h('h3', { text: tr('Next Choices') });
        const root = h('div', { children: [settingsHeading] });
        section.append(root);
        track(() => root.remove());

        const panel = createSettingsPanel({
            root,
            components: ctx.components,
            tr,
            settings,
            listProfiles,
            onChange: onSettingChanged,
        });
        settingsPanel = panel;
        track(() => panel.destroy());
        void panel.refreshProfiles();
        if (typeof IntersectionObserver === 'function') {
            const observer = new IntersectionObserver((entries) => {
                if (entries.some((entry) => entry.isIntersecting)) void panel.refreshProfiles();
            });
            observer.observe(root);
            track(() => observer.disconnect());
        }
    }

    function registerInputBarActions(): void {
        const specs = [
            { id: 'next_choices_generate', label: 'Generate choices', iconSvg: DICE_SVG, run: () => void generateChoices('manual') },
            { id: 'next_choices_guided', label: 'Generate choices (guided)', iconSvg: COMPASS_SVG, run: () => toggleGuided(null) },
        ];
        for (const spec of specs) {
            try {
                const handle = ctx.ui.registerInputBarAction({
                    id: spec.id,
                    label: tr(spec.label),
                    iconSvg: spec.iconSvg,
                    enabled: settings.enabled,
                });
                track(handle.onClick(spec.run));
                track(() => handle.destroy());
                inputActions.push({ handle, label: spec.label });
            } catch (err) {
                console.warn(`${LOG} Could not register the "${spec.label}" input bar action:`, err);
            }
        }
    }

    function wireEvents(): void {
        const on = (name: string, handler: (payload: unknown) => void) => {
            try {
                track(ctx.events.on(name, handler));
            } catch (err) {
                console.warn(`${LOG} Could not subscribe to ${name}:`, err);
            }
        };

        on('GENERATION_STARTED', (payload) => {
            if (filter.onGenerationStarted(payload) === 'reset') resetTurn();
        });
        on('GENERATION_ENDED', (payload) => {
            if (filter.onGenerationEnded(payload) === 'generate') armAutoTimer();
        });
        on('CHAT_SWITCHED', (payload) => {
            lastChatId = (payload as { chatId?: string | null } | null)?.chatId ?? null;
            resetTurn();
            ensureMounted();
        });
        on('CHAT_CHANGED', (payload) => {
            const id = chatIdFromChatChanged(payload);
            if (id && id !== lastChatId) {
                lastChatId = id;
                resetTurn();
                ensureMounted();
            }
        });
        const onMutated = (payload: unknown) => {
            if (filter.onMessageMutated(payload) === 'clear') resetTurn();
        };
        on('MESSAGE_EDITED', onMutated);
        on('MESSAGE_DELETED', onMutated);
        on('MESSAGE_SWIPED', (payload) => {
            const verdict = filter.onMessageSwiped(payload);
            if (verdict === 'ignore') return;
            resetTurn();
            if (verdict === 'clear-and-rearm') armAutoTimer();
        });

        const composer = ctx.composer;
        if (composer?.onChange) {
            let previous = composer.getState();
            track(
                composer.onChange((state) => {
                    const chatChanged = state.chatId !== previous.chatId;
                    const mountedNow = state.mounted && !previous.mounted;
                    previous = state;
                    if (chatChanged) {
                        lastChatId = state.chatId;
                        resetTurn();
                    }
                    if (chatChanged || mountedNow) {
                        ensureMounted();
                        quick.sync();
                    }
                }),
            );
        }

        track(
            rpc.onCommand((id) => {
                if (document.visibilityState !== 'visible') return;
                if (id === 'generate') void generateChoices('manual');
                else if (id === 'guided') toggleGuided(null);
            }),
        );

        track(
            ctx.locale.subscribe((locale) => {
                setLocale(locale);
                for (const { handle, label } of inputActions) handle.setLabel(tr(label));
                if (settingsHeading) settingsHeading.textContent = tr('Next Choices');
                settingsPanel?.relabel();
                quick.relabel();
            }),
        );
    }

    function init(): void {
        registerInputBarActions();
        wireEvents();
        try {
            initSettingsPanel();
        } catch (err) {
            console.error(`${LOG} Settings panel init failed:`, err);
        }
        applyEnabledState();
        ensureMounted();
        console.log(`${LOG} Extension loaded (${getLocale()}).`);
    }

    async function start(): Promise<void> {
        try {
            const stored = await rpc.loadSettings();
            if (disposed) return;
            if (stored) {
                Object.assign(settings, stored);
            } else {
                console.warn(`${LOG} The backend did not send the settings in time; using the defaults.`);
            }
            init();
        } catch (err) {
            if (!disposed) console.error(`${LOG} Init failed:`, err);
        }
    }
    void start();

    function teardown(): void {
        if (disposed) return;
        disposed = true;
        cancelAutoTimer();
        abortPending();
        clearTimeout(saveTimer);
        if (saveDirty) {
            saveDirty = false;
            rpc.saveSettings({ ...settings }).catch(() => {});
        }
        for (const cleanup of cleanups.splice(0).reverse()) {
            try {
                cleanup();
            } catch (err) {
                console.warn(`${LOG} Cleanup step failed:`, err);
            }
        }
        guidanceEditor?.destroy();
        guidanceEditor = null;
        choicesUi.clear();
        container?.remove();
        container = null;
        mountRoot = null;
        try {
            ctx.dom.cleanup();
        } catch {}
    }

    return teardown;
}
