import type {
    SpindleCheckboxHandle,
    SpindleComponentsHelper,
    SpindleNumericInputHandle,
    SpindleSelectHandle,
    SpindleSelectOption,
    SpindleTextAreaHandle,
} from 'lumiverse-spindle-types';
import {
    normalizeHistoryDepth,
    normalizeMaxTokens,
    normalizeNumChoices,
    normalizeProfileId,
    normalizePromptTemplate,
    type NextChoicesSettings,
} from '../shared/settings';
import { DEFAULT_PROMPT_TEMPLATE } from '../shared/templates';
import { h, toolButton } from './ui/dom';
import type { Translate } from './ui/types';

export type SettingKey = keyof NextChoicesSettings;

export interface ProfileOption {
    id: string;
    name: string;
    model?: string;
}

export function applySettingChange(settings: NextChoicesSettings, key: SettingKey, raw: unknown): boolean {
    let next: NextChoicesSettings[SettingKey];
    switch (key) {
        case 'enabled':
        case 'autoGenerate':
        case 'autoSend':
        case 'showQuickGenerateButton':
            next = raw === true;
            break;
        case 'profileId':
            next = normalizeProfileId(raw);
            break;
        case 'numChoices':
            if (raw === null || raw === undefined) return false;
            next = normalizeNumChoices(raw);
            break;
        case 'maxTokens':
            if (raw === null || raw === undefined) return false;
            next = normalizeMaxTokens(raw);
            break;
        case 'historyDepth':
            if (raw === null || raw === undefined) return false;
            next = normalizeHistoryDepth(raw);
            break;
        case 'promptTemplate':
            next = normalizePromptTemplate(raw);
            break;
        default:
            return false;
    }
    if (settings[key] === next) return false;
    (settings as unknown as Record<string, unknown>)[key] = next;
    return true;
}

export function buildProfileOptions(
    tr: Translate,
    profiles: readonly ProfileOption[],
    pendingId?: string,
): SpindleSelectOption[] {
    const options: SpindleSelectOption[] = [{ value: 'current', label: tr('Current connection settings') }];
    for (const profile of profiles) {
        options.push({
            value: profile.id,
            label: profile.name || profile.id,
            ...(profile.model ? { sublabel: profile.model } : {}),
        });
    }
    if (pendingId && pendingId !== 'current' && !profiles.some((profile) => profile.id === pendingId)) {
        options.push({ value: pendingId, label: pendingId });
    }
    return options;
}

export interface SettingsPanelDeps {
    root: HTMLElement;
    components: SpindleComponentsHelper;
    tr: Translate;
    settings: NextChoicesSettings;
    listProfiles(): Promise<ProfileOption[] | null>;
    onChange(key: SettingKey): void;
}

export interface SettingsPanel {
    relabel(): void;
    refreshProfiles(): Promise<void>;
    destroy(): void;
}

export function createSettingsPanel(deps: SettingsPanelDeps): SettingsPanel {
    const { components, settings } = deps;
    const tr: Translate = (key, vars) => deps.tr(key, vars);
    let destroyed = false;
    let profiles: ProfileOption[] = [];
    let profilesLoaded = false;

    const wrapper = h('div', { className: 'next-choices-settings' });
    const mountPoint = () => h('div');
    const disposables: Array<{ destroy(): void }> = [];

    const checkboxes: Array<{
        key: SettingKey & ('enabled' | 'autoGenerate' | 'autoSend' | 'showQuickGenerateButton');
        label: string;
        handle: SpindleCheckboxHandle;
    }> = [];
    const checkboxSpecs = [
        { key: 'enabled', label: 'Enable extension' },
        {
            key: 'autoGenerate',
            label: 'Auto-generate (create choices after each AI reply. You can always trigger manually from the input bar menu)',
        },
        { key: 'autoSend', label: 'Send on click (by default the choice is inserted into the input box for editing)' },
        { key: 'showQuickGenerateButton', label: 'Show choice generation buttons beside the message box' },
    ] as const;
    for (const spec of checkboxSpecs) {
        const target = mountPoint();
        wrapper.append(target);
        const handle = components.mountCheckbox(target, {
            checked: settings[spec.key],
            label: tr(spec.label),
            onChange: (checked) => change(spec.key, checked),
        });
        checkboxes.push({ key: spec.key, label: spec.label, handle });
        disposables.push(handle);
    }

    const sourceLabel = h('label', { text: tr('Generation source') });
    const sourceTarget = mountPoint();
    const sourceSelect: SpindleSelectHandle = components.mountSelect(sourceTarget, {
        options: buildProfileOptions(tr, [], settings.profileId),
        value: settings.profileId,
        onChange: (value) => change('profileId', value),
    });
    disposables.push(sourceSelect);
    wrapper.append(h('div', { className: 'next-choices-settings-field', children: [sourceLabel, sourceTarget] }));

    const numberSpecs = [
        { key: 'numChoices', label: 'Number of choices', min: 1, max: 10 },
        { key: 'maxTokens', label: 'Max tokens', min: 50, max: 4096 },
        { key: 'historyDepth', label: 'History depth', min: 1, max: 50 },
    ] as const;
    const numberFields: Array<{
        key: (typeof numberSpecs)[number]['key'];
        label: string;
        labelNode: HTMLElement;
        handle: SpindleNumericInputHandle;
    }> = [];
    const numberRow = h('div', { className: 'next-choices-settings-row' });
    for (const spec of numberSpecs) {
        const labelNode = h('label', { text: tr(spec.label) });
        const target = mountPoint();
        const handle = components.mountNumericInput(target, {
            value: settings[spec.key],
            integer: true,
            min: spec.min,
            max: spec.max,
            ariaLabel: tr(spec.label),
            onChange: (value) => change(spec.key, value),
        });
        numberFields.push({ key: spec.key, label: spec.label, labelNode, handle });
        disposables.push(handle);
        numberRow.append(h('div', { className: 'next-choices-settings-field', children: [labelNode, target] }));
    }
    wrapper.append(numberRow);

    const promptLabel = h('label', { text: tr('Prompt template') });
    const hint = h('small');
    function renderHint(): void {
        const code = (text: string) => h('code', { text });
        hint.replaceChildren(
            tr('Available macros: '),
            code('{{history}}'),
            tr(' (recent conversation), '),
            code('{{user}}'),
            tr(', '),
            code('{{char}}'),
            tr(', '),
            code('{{numChoices}}'),
            tr(', '),
            code('{{persona}}'),
            tr(' (your persona description). Other Lumiverse macros are also supported. '),
            tr('This request is never written into the chat log and does not affect the chat context.'),
        );
    }
    renderHint();
    const promptTarget = h('div', { className: 'next-choices-prompt' });
    const promptArea: SpindleTextAreaHandle = components.mountTextArea(promptTarget, {
        value: settings.promptTemplate,
        rows: 8,
        ariaLabel: tr('Prompt template'),
        onChange: (value) => change('promptTemplate', value),
    });
    disposables.push(promptArea);
    const resetButton = toolButton('next-choices-settings-reset', tr('Restore default template'));
    resetButton.addEventListener('click', () => {
        if (applySettingChange(settings, 'promptTemplate', DEFAULT_PROMPT_TEMPLATE)) deps.onChange('promptTemplate');
        promptArea.update({ value: DEFAULT_PROMPT_TEMPLATE });
    });
    wrapper.append(
        h('div', { className: 'next-choices-settings-field', children: [promptLabel, hint, promptTarget, resetButton] }),
    );

    deps.root.append(wrapper);

    function change(key: SettingKey, raw: unknown): void {
        if (destroyed) return;
        if (applySettingChange(settings, key, raw)) deps.onChange(key);
    }

    return {
        relabel() {
            if (destroyed) return;
            for (const box of checkboxes) box.handle.update({ label: tr(box.label) });
            sourceLabel.textContent = tr('Generation source');
            sourceSelect.update({ options: buildProfileOptions(tr, profilesLoaded ? profiles : [], settings.profileId) });
            for (const field of numberFields) {
                field.labelNode.textContent = tr(field.label);
                field.handle.update({ ariaLabel: tr(field.label) });
            }
            promptLabel.textContent = tr('Prompt template');
            promptArea.update({ ariaLabel: tr('Prompt template') });
            renderHint();
            resetButton.textContent = tr('Restore default template');
        },

        async refreshProfiles() {
            let listed: ProfileOption[] | null;
            try {
                listed = await deps.listProfiles();
            } catch (err) {
                console.warn(`[nextChoices] ${tr('Could not load the connection list.')}`, err);
                return;
            }
            if (destroyed || listed === null) return;
            profiles = listed;
            profilesLoaded = true;
            if (settings.profileId !== 'current' && !profiles.some((profile) => profile.id === settings.profileId)) {
                change('profileId', 'current');
            }
            sourceSelect.update({ options: buildProfileOptions(tr, profiles), value: settings.profileId });
        },

        destroy() {
            if (destroyed) return;
            destroyed = true;
            for (const item of disposables) {
                try {
                    item.destroy();
                } catch {}
            }
            wrapper.remove();
        },
    };
}
