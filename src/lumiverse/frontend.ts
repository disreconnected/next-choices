/**
 * Next Choices, Lumiverse (Spindle) frontend module.
 *
 * After each AI reply it asks the backend (see ./backend.ts) for suggested
 * player replies and shows them above the composer. This file is the
 * controller: it owns the settings, the request ids and cancellation, the
 * mount points, the host events and the composer. The DOM lives in ./ui, the
 * settings tab in ./settings-panel, the transport in ./rpc-client. The
 * behaviour is a port of the SillyTavern adapter (src/st/index.ts).
 */
import type {
    SpindleFrontendContext,
    SpindleInputBarActionHandle,
    SpindleSettingsTabHandle,
} from 'lumiverse-spindle-types';
import { parseChoices } from '../shared/parse';
import {
    appendCombinationTask,
    appendEnhancementTask,
    appendGuidedTask,
    buildHistory,
    buildPromptAsync,
    type PromptVars,
} from '../shared/prompt';
import { DEFAULT_SETTINGS, MODULE_NAME, normalizeSettings, type NextChoicesSettings } from '../shared/settings';
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
import { errorText, h, isRendered } from './ui/dom';
import {
    AUTO_GENERATE_DEBOUNCE_MS,
    chatIdFromChatChanged,
    createEventFilter,
    isForegroundTab,
} from './ui/event-filter';
import { createGuidanceEditor, type GuidanceEditor } from './ui/guidance-editor';
import { COMPASS_SVG, DICE_SVG } from './ui/icons';
import { createQuickButtons } from './ui/quick-buttons';
import { NoConversationError, type RequestHandle, type RewriteTask } from './ui/types';

const LOG = `[${MODULE_NAME}]`;
/** Edits in the settings tab are saved this long after the last one. */
const SAVE_DEBOUNCE_MS = 300;

type Reason = 'manual' | 'auto' | 'guided';

export function setup(ctx: SpindleFrontendContext): () => void {
    let disposed = false;
    const cleanups: Array<() => void> = [];
    const track = (fn: (() => void) | void | undefined | null): void => {
        if (typeof fn === 'function') cleanups.push(fn);
    };

    // The host queues backend messages until ready(). Defer only until the RPC
    // handler below is registered: waiting for the settings reply here would
    // deadlock, because that reply is itself a queued startup message.
    ctx.deferReady?.();
    try {
        setLocale(ctx.locale?.get?.());
    } catch {
        setLocale('en');
    }

    /** The live settings. One object for the whole session: the settings tab writes into it. */
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

    // State declared up front: the functions below reference each other freely.
    let mountRoot: HTMLElement | null = null;
    let container: HTMLElement | null = null;
    let mountWarned = false;
    let guidanceEditor: GuidanceEditor | null = null;
    let settingsPanel: SettingsPanel | null = null;
    let settingsTab: SpindleSettingsTabHandle | null = null;
    const inputActions: Array<{ handle: SpindleInputBarActionHandle; label: string }> = [];

    let sequence = 0; // request counter: a result is stale once it no longer matches
    let abortController: AbortController | null = null;
    let autoTimer: ReturnType<typeof setTimeout> | undefined;

    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let saveDirty = false;
    let saveEpoch = 0;

    // =========================================================================
    // Mount point above the composer
    // =========================================================================

    /**
     * The container above the composer, (re)attached to a live mount root. The
     * chat view can be rebuilt (chat switch, navigation), which detaches the
     * root, so this runs before every render rather than only at startup.
     * Null when there is no composer on screen.
     */
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
        // Only our own nodes are moved; a root the host left behind is the host's to clean up.
        mountRoot = root as HTMLElement;
        container ??= h('div', { id: CONTAINER_ID, className: 'next-choices-container', hidden: true });
        if (container.parentElement !== mountRoot) mountRoot.append(container);
        // The theme editor sits just above the choices; it follows a re-acquired root.
        if (guidanceEditor && guidanceEditor.wrapper.parentElement !== mountRoot) {
            mountRoot.insertBefore(guidanceEditor.wrapper, container);
        }
        return container.isConnected ? container : null;
    }

    // =========================================================================
    // Requests: ids, cancellation, auto-generate timer
    // =========================================================================

    function cancelAutoTimer(): void {
        clearTimeout(autoTimer);
        autoTimer = undefined;
    }

    function armAutoTimer(): void {
        cancelAutoTimer();
        if (!settings.enabled || !settings.autoGenerate) return;
        autoTimer = setTimeout(() => {
            autoTimer = undefined;
            // Settings may have changed while the timer was pending.
            if (settings.enabled && settings.autoGenerate) void generateChoices('auto');
        }, AUTO_GENERATE_DEBOUNCE_MS);
    }

    function abortPending(): void {
        sequence++;
        try {
            abortController?.abort();
        } catch {
            /* ignore */
        }
        abortController = null;
        // The theme editor is locked only for the duration of its own request, so
        // anything that abandons a pending request must unlock it here.
        guidanceEditor?.setBusy(false);
    }

    function beginRequest(): RequestHandle {
        abortPending();
        const id = sequence;
        const controller = new AbortController();
        abortController = controller;
        return { id, signal: controller.signal, isCurrent: () => id === sequence };
    }

    // =========================================================================
    // Focus
    // =========================================================================

    function focusComposer(): void {
        try {
            ctx.composer?.focus();
        } catch {
            /* no composer mounted */
        }
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

    /** After Stop: back to what had focus, if that was a launcher or the composer; otherwise the first visible launcher. */
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

    // =========================================================================
    // Guided theme editor
    // =========================================================================

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

    /** Discards the editor and its draft (the conversation turn is over, or the extension is off). */
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

    // =========================================================================
    // Generation
    // =========================================================================

    /** The id the backend expects: null means "the connection that is active in Lumiverse". */
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

    /** Template with the host's macros expanded and the history spliced in last (never macro-expanded). */
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

        // Only the guided reason consumes the submitted theme. The dice, Retry and
        // auto callbacks are unguided by construction.
        const guided = reason === 'guided';
        const theme = guided ? String(guidance ?? '').trim() : '';
        if (guided && !theme) return;

        const { chatId, characterId } = getActiveChat();
        if (!chatId) return;

        // Snapshot before the first await: a preference changed while the request
        // is in flight must not change this request's prompt or its validation.
        const snapshot: NextChoicesSettings = { ...settings };

        // A pending auto-generation would otherwise fire mid-request and abort
        // the guided request it was submitted from.
        if (guided) cancelAutoTimer();
        const focusTarget = document.activeElement;

        const handle = beginRequest();
        if (guided) guidanceEditor?.setBusy(true);
        // Auto generation shows nothing until the chat is known to need choices.
        if (reason !== 'auto') choicesUi.renderLoading(handle, focusTarget);

        let text: string;
        try {
            const info = await rpc.getContext(chatId, characterId, snapshot.historyDepth);
            if (!handle.isCurrent()) return;
            lastUserName = info.userName;

            if (info.history.length === 0 || (reason === 'auto' && info.lastIsUser)) {
                if (reason === 'auto') return; // nothing was shown yet
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
            if (!handle.isCurrent()) return; // stale, ignore
            if (guided) guidanceEditor?.setBusy(false);
            console.error(`${LOG} Generation failed:`, err);
            choicesUi.renderError(errorText(err), theme);
            return;
        }

        if (!handle.isCurrent()) return; // stale, ignore
        if (guided) guidanceEditor?.setBusy(false);

        const choices = parseChoices(text, snapshot.numChoices);
        if (!choices.length) {
            choicesUi.renderError(tr('Could not parse choices from the model response'), theme);
            return;
        }
        choicesUi.renderChoices(choices, theme);
        // Success collapses the editor; the theme stays in the textarea so it can be
        // reopened and reused within the same conversation turn.
        if (guided && guidanceEditor?.isOpen()) guidanceEditor.setOpen(false);
    }

    /** The model's raw answer for an enhance or combine task on the choices on screen. */
    async function runRewrite(handle: RequestHandle, task: RewriteTask): Promise<string> {
        const { chatId, characterId } = getActiveChat();
        if (!chatId) throw new NoConversationError();
        const snapshot: NextChoicesSettings = { ...settings };

        const info = await rpc.getContext(chatId, characterId, snapshot.historyDepth);
        if (!handle.isCurrent()) throw new RpcError('Superseded', true);
        if (info.history.length === 0) throw new NoConversationError();
        lastUserName = info.userName;

        // numChoices is pinned to the list being rewritten, as in the shared prompt builders.
        const numChoices = task.kind === 'enhance' ? task.originals.length : 1;
        const base = await buildBasePrompt(info, snapshot, numChoices, chatId, characterId);
        if (!handle.isCurrent()) throw new RpcError('Superseded', true);
        const prompt =
            task.kind === 'enhance'
                ? appendEnhancementTask(base, task.originals, task.guidance)
                : appendCombinationTask(base, task.selected);
        return rpc.generate(prompt, connectionId(snapshot), snapshot.maxTokens, handle.signal);
    }

    // =========================================================================
    // Applying a choice
    // =========================================================================

    function isBusyError(err: unknown): boolean {
        const code = (err as { code?: unknown } | null)?.code;
        return code === 'COMPOSER_BUSY' || errorText(err).includes('COMPOSER_BUSY');
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
            // The text stays in the composer, so nothing is lost.
            choicesUi.renderNotice(
                isBusyError(err) ? tr('Send failed: chat is busy') : tr('Send failed: ') + errorText(err),
            );
        }
    }

    // =========================================================================
    // UI parts
    // =========================================================================

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

    /** Clears everything tied to the current conversation turn. */
    function resetTurn(): void {
        cancelAutoTimer();
        abortPending();
        choicesUi.clear();
        resetGuidance();
    }

    // =========================================================================
    // Settings: live effects and persistence
    // =========================================================================

    function applyEnabledState(): void {
        for (const { handle } of inputActions) handle.setEnabled(settings.enabled);
        quick.sync();
    }

    function scheduleSave(): void {
        saveDirty = true;
        saveEpoch++;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
    }

    function flushSave(): void {
        clearTimeout(saveTimer);
        saveTimer = undefined;
        if (!saveDirty) return;
        saveDirty = false;
        const epoch = saveEpoch;
        rpc.saveSettings({ ...settings })
            .then((stored) => {
                // The backend's normalised copy is the source of truth, unless the player
                // has edited something since: that edit has its own save in flight.
                if (disposed || epoch !== saveEpoch) return;
                const normalized = normalizeSettings(stored);
                const changed = (Object.keys(normalized) as SettingKey[]).some((key) => normalized[key] !== settings[key]);
                if (!changed) return;
                Object.assign(settings, normalized);
                settingsPanel?.syncFromSettings();
                applyEnabledState();
            })
            .catch((err) => {
                if (!(err instanceof RpcError && err.aborted)) console.warn(`${LOG} Failed to save settings:`, err);
            });
    }

    /** A setting was changed in the settings tab: take effect now, then save. */
    function onSettingChanged(key: SettingKey): void {
        switch (key) {
            case 'enabled':
                cancelAutoTimer();
                abortPending();
                choicesUi.clear();
                // Disabling discards the theme editor and its draft.
                if (!settings.enabled) resetGuidance();
                applyEnabledState();
                break;
            case 'autoGenerate':
                cancelAutoTimer();
                abortPending();
                choicesUi.clear();
                break;
            case 'showQuickGenerateButton':
                // A display preference only: it never touches the choices or in-flight requests.
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
        let root: HTMLElement | null = null;
        if (typeof ctx.ui.registerSettingsTab === 'function') {
            try {
                const tab = ctx.ui.registerSettingsTab({
                    id: 'next_choices',
                    title: tr('Next Choices'),
                    shortName: tr('Choices'),
                    description: tr('Next Choices settings'),
                    keywords: ['choices', 'suggest', 'reply', 'next choices'],
                });
                settingsTab = tab;
                root = tab.root;
                track(() => tab.destroy());
            } catch (err) {
                console.warn(`${LOG} registerSettingsTab failed, using the extensions section:`, err);
                settingsTab = null;
            }
        }
        if (!root) {
            const section = ctx.ui.mount('settings_extensions') as HTMLElement;
            const body = h('div', { children: [h('h3', { text: tr('Next Choices') })] });
            section.append(body);
            root = body;
            track(() => body.remove());
        }

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
        // The connection list can change while the tab is closed: reload it on every visit.
        if (settingsTab) track(settingsTab.onActivate(() => void panel.refreshProfiles()));
    }

    // =========================================================================
    // Triggers: input bar menu, quick buttons, backend commands
    // =========================================================================

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

    // =========================================================================
    // Events
    // =========================================================================

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
        // CHAT_CHANGED also fires for metadata-only changes: only a different chat id counts.
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
                    // Fires on every keystroke: only a new chat or a (re)mounted composer matters.
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
                // The backend forwards a command to every open tab of the user.
                if (!isForegroundTab(document.visibilityState)) return;
                if (id === 'generate') void generateChoices('manual');
                else if (id === 'guided') toggleGuided(null);
            }),
        );

        if (ctx.locale?.subscribe) {
            track(
                ctx.locale.subscribe((locale) => {
                    setLocale(locale);
                    for (const { handle, label } of inputActions) handle.setLabel(tr(label));
                    settingsTab?.setTitle(tr('Next Choices'));
                    settingsPanel?.relabel();
                    quick.relabel();
                }),
            );
        }
    }

    // =========================================================================
    // Startup and teardown
    // =========================================================================

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
                Object.assign(settings, normalizeSettings(stored));
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
        // An edit still waiting for its debounced save must not be lost.
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
        } catch {
            /* ignore */
        }
    }

    return teardown;
}
