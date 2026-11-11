import { DEFAULT_PROMPT_TEMPLATE, LEGACY_DEFAULT_PROMPT_TEMPLATE } from './templates';

export const MODULE_NAME = 'nextChoices';

export interface NextChoicesSettings {
    enabled: boolean;
    autoGenerate: boolean;
    autoSend: boolean;
    profileId: string;
    showQuickGenerateButton: boolean;
    numChoices: number;
    maxTokens: number;
    historyDepth: number;
    promptTemplate: string;
}

export const DEFAULT_SETTINGS: Readonly<NextChoicesSettings> = Object.freeze({
    enabled: true,
    autoGenerate: true,
    autoSend: false,
    profileId: 'current',
    showQuickGenerateButton: false,
    numChoices: 3,
    maxTokens: 500,
    historyDepth: 4,
    promptTemplate: DEFAULT_PROMPT_TEMPLATE,
});

export function backfillDefaults(stored: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (!(key in stored)) stored[key] = value;
    }
}

export function upgradeLegacyTemplate(stored: { promptTemplate?: unknown }): boolean {
    if (stored.promptTemplate === LEGACY_DEFAULT_PROMPT_TEMPLATE) {
        stored.promptTemplate = DEFAULT_PROMPT_TEMPLATE;
        return true;
    }
    return false;
}

export function normalizeNumChoices(raw: unknown): number {
    const value = parseInt(String(raw), 10);
    return Number.isFinite(value) && value > 0 ? Math.min(value, 10) : DEFAULT_SETTINGS.numChoices;
}

export function normalizeMaxTokens(raw: unknown): number {
    const value = parseInt(String(raw), 10);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_SETTINGS.maxTokens;
}

export function normalizeHistoryDepth(raw: unknown): number {
    const value = parseInt(String(raw), 10);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_SETTINGS.historyDepth;
}

export function normalizePromptTemplate(raw: unknown): string {
    return String(raw ?? '') || DEFAULT_PROMPT_TEMPLATE;
}

export function normalizeProfileId(raw: unknown): string {
    return String(raw || 'current');
}

export function normalizeSettings(raw: unknown): NextChoicesSettings {
    const source: Record<string, unknown> =
        raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
    const text = (value: unknown): unknown => (typeof value === 'string' ? value : undefined);

    const settings: NextChoicesSettings = {
        enabled: bool(source.enabled, DEFAULT_SETTINGS.enabled),
        autoGenerate: bool(source.autoGenerate, DEFAULT_SETTINGS.autoGenerate),
        autoSend: bool(source.autoSend, DEFAULT_SETTINGS.autoSend),
        profileId: normalizeProfileId(text(source.profileId)),
        showQuickGenerateButton: bool(source.showQuickGenerateButton, DEFAULT_SETTINGS.showQuickGenerateButton),
        numChoices: normalizeNumChoices(source.numChoices),
        maxTokens: normalizeMaxTokens(source.maxTokens),
        historyDepth: normalizeHistoryDepth(source.historyDepth),
        promptTemplate: normalizePromptTemplate(text(source.promptTemplate)),
    };
    upgradeLegacyTemplate(settings);
    return settings;
}
