import { DEFAULT_PROMPT_TEMPLATE, LEGACY_DEFAULT_PROMPT_TEMPLATE } from './templates';

/** Key under which SillyTavern stores the settings, and the log prefix. */
export const MODULE_NAME = 'nextChoices';

export interface NextChoicesSettings {
    enabled: boolean;
    /** auto (event-driven) / manual (button) */
    autoGenerate: boolean;
    /** send immediately on click */
    autoSend: boolean;
    /** 'current' or a connection profile id */
    profileId: string;
    /** composer toolbar shortcut (opt-in) */
    showQuickGenerateButton: boolean;
    numChoices: number;
    maxTokens: number;
    historyDepth: number;
    promptTemplate: string;
}

export const DEFAULT_SETTINGS: Readonly<NextChoicesSettings> = Object.freeze({
    enabled: true,
    autoGenerate: true,      // auto (event-driven) / manual (button)
    autoSend: false,         // send immediately on click
    profileId: 'current',    // 'current' or a connection profile id
    showQuickGenerateButton: false, // composer toolbar shortcut (opt-in)
    numChoices: 3,
    maxTokens: 500,
    historyDepth: 4,
    promptTemplate: DEFAULT_PROMPT_TEMPLATE,
});

/**
 * Backfills missing keys in place. Never recreates the object: UI handlers and
 * callers must all share the same reference, otherwise writes land on an
 * orphaned copy and are never persisted. A key that is present but undefined
 * is deliberately NOT backfilled.
 */
export function backfillDefaults(stored: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (!(key in stored)) stored[key] = value;
    }
}

/**
 * Upgrades, in place, only the exact former default template. Custom
 * templates are user content and must never be silently rewritten. Returns
 * true when the template was replaced, so the caller can persist the change.
 */
export function upgradeLegacyTemplate(stored: { promptTemplate?: unknown }): boolean {
    if (stored.promptTemplate === LEGACY_DEFAULT_PROMPT_TEMPLATE) {
        stored.promptTemplate = DEFAULT_PROMPT_TEMPLATE;
        return true;
    }
    return false;
}

// Input normalisation. `raw` is whatever the control produced (a string from
// a text/number input in practice); parseInt semantics are intentional.

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

/**
 * Builds a complete, valid settings object from untrusted stored data (used by
 * hosts that persist settings as plain JSON). Returns a new object; the input
 * is not modified and unknown keys are dropped. Invalid values fall back to
 * the defaults, numbers are clamped like the SillyTavern inputs, and the
 * exact former default template is upgraded.
 */
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
