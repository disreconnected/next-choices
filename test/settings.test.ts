import { describe, expect, test } from 'bun:test';
import {
    DEFAULT_SETTINGS,
    MODULE_NAME,
    backfillDefaults,
    normalizeHistoryDepth,
    normalizeMaxTokens,
    normalizeNumChoices,
    normalizeProfileId,
    normalizePromptTemplate,
    normalizeSettings,
    upgradeLegacyTemplate,
} from '../src/shared/settings';
import { DEFAULT_PROMPT_TEMPLATE, LEGACY_DEFAULT_PROMPT_TEMPLATE } from '../src/shared/templates';

describe('DEFAULT_SETTINGS', () => {
    test('has the documented values', () => {
        expect({ ...DEFAULT_SETTINGS }).toEqual({
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
    });

    test('is frozen', () => {
        expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
    });

    test('the SillyTavern settings key is unchanged', () => {
        expect(MODULE_NAME).toBe('nextChoices');
    });
});

describe('prompt templates', () => {
    test('the default template is the legacy one plus the persona block', () => {
        const persona = 'Persona of {{user}} (match their voice, writing style, and inner narration):\n{{persona}}\n\n';
        expect(DEFAULT_PROMPT_TEMPLATE).toContain(persona);
        expect(DEFAULT_PROMPT_TEMPLATE.replace(persona, '')).toBe(LEGACY_DEFAULT_PROMPT_TEMPLATE);
        expect(LEGACY_DEFAULT_PROMPT_TEMPLATE).not.toContain('{{persona}}');
    });

    test('both templates use the history and numChoices macros', () => {
        for (const template of [DEFAULT_PROMPT_TEMPLATE, LEGACY_DEFAULT_PROMPT_TEMPLATE]) {
            expect(template).toContain('{{history}}');
            expect(template).toContain('{{numChoices}}');
            expect(template).toContain('{{user}}');
            expect(template).toContain('{{char}}');
        }
    });
});

describe('upgradeLegacyTemplate', () => {
    test('upgrades the exact former default and reports it', () => {
        const stored = { promptTemplate: LEGACY_DEFAULT_PROMPT_TEMPLATE };
        expect(upgradeLegacyTemplate(stored)).toBe(true);
        expect(stored.promptTemplate).toBe(DEFAULT_PROMPT_TEMPLATE);
    });

    test('never touches anything that is not an exact match', () => {
        for (const template of [
            LEGACY_DEFAULT_PROMPT_TEMPLATE + ' ',
            LEGACY_DEFAULT_PROMPT_TEMPLATE + '\n',
            ' ' + LEGACY_DEFAULT_PROMPT_TEMPLATE,
            LEGACY_DEFAULT_PROMPT_TEMPLATE.replace('assistant', 'helper'),
            'my own template {{history}}',
            DEFAULT_PROMPT_TEMPLATE,
            '',
        ]) {
            const stored = { promptTemplate: template };
            expect(upgradeLegacyTemplate(stored)).toBe(false);
            expect(stored.promptTemplate).toBe(template);
        }
    });

    test('does nothing when there is no template', () => {
        const stored: { promptTemplate?: string } = {};
        expect(upgradeLegacyTemplate(stored)).toBe(false);
        expect('promptTemplate' in stored).toBe(false);
    });
});

describe('backfillDefaults', () => {
    test('fills missing keys in place, on the same object', () => {
        const stored: Record<string, unknown> = { numChoices: 7 };
        const returned = backfillDefaults(stored);
        expect(returned).toBeUndefined();
        expect(stored).toEqual({ ...DEFAULT_SETTINGS, numChoices: 7 });
    });

    test('keeps existing values and unknown keys', () => {
        const stored: Record<string, unknown> = { enabled: false, autoSend: true, extra: 'kept' };
        backfillDefaults(stored);
        expect(stored.enabled).toBe(false);
        expect(stored.autoSend).toBe(true);
        expect(stored.extra).toBe('kept');
        expect(stored.maxTokens).toBe(500);
    });

    test('a key that is present but undefined is NOT backfilled (uses `key in stored`)', () => {
        const stored: Record<string, unknown> = { maxTokens: undefined };
        backfillDefaults(stored);
        expect('maxTokens' in stored).toBe(true);
        expect(stored.maxTokens).toBeUndefined();
    });
});

describe('numeric and text input normalisation', () => {
    test('numChoices: parseInt semantics, positive only, capped at 10', () => {
        expect(normalizeNumChoices('3')).toBe(3);
        expect(normalizeNumChoices('3.7')).toBe(3);
        expect(normalizeNumChoices('1')).toBe(1);
        expect(normalizeNumChoices('7')).toBe(7);
        expect(normalizeNumChoices('10')).toBe(10);
        expect(normalizeNumChoices('15')).toBe(10);
        expect(normalizeNumChoices(4)).toBe(4);
        expect(normalizeNumChoices(99)).toBe(10);
    });

    test('numChoices: invalid or non-positive input falls back to the default', () => {
        for (const raw of ['0', '-1', 'abc', '', ' ', undefined, null, NaN, 0, -3]) {
            expect(normalizeNumChoices(raw)).toBe(DEFAULT_SETTINGS.numChoices);
        }
    });

    test('maxTokens: positive integers pass through uncapped, anything else becomes the default', () => {
        expect(normalizeMaxTokens('800')).toBe(800);
        expect(normalizeMaxTokens('1.9')).toBe(1);
        expect(normalizeMaxTokens('99999')).toBe(99999);
        for (const raw of ['0', '-5', 'x', '', undefined, null]) {
            expect(normalizeMaxTokens(raw)).toBe(DEFAULT_SETTINGS.maxTokens);
        }
    });

    test('historyDepth: positive integers pass through uncapped, anything else becomes the default', () => {
        expect(normalizeHistoryDepth('25')).toBe(25);
        expect(normalizeHistoryDepth('1')).toBe(1);
        for (const raw of ['0', '-5', 'x', '', undefined, null]) {
            expect(normalizeHistoryDepth(raw)).toBe(DEFAULT_SETTINGS.historyDepth);
        }
    });

    test('promptTemplate: empty or missing becomes the default; anything else is kept verbatim', () => {
        expect(normalizePromptTemplate('')).toBe(DEFAULT_PROMPT_TEMPLATE);
        expect(normalizePromptTemplate(undefined)).toBe(DEFAULT_PROMPT_TEMPLATE);
        expect(normalizePromptTemplate(null)).toBe(DEFAULT_PROMPT_TEMPLATE);
        expect(normalizePromptTemplate('custom {{history}}')).toBe('custom {{history}}');
        expect(normalizePromptTemplate('   ')).toBe('   ');
    });

    test('profileId: empty or missing becomes "current"', () => {
        expect(normalizeProfileId('')).toBe('current');
        expect(normalizeProfileId(undefined)).toBe('current');
        expect(normalizeProfileId(null)).toBe('current');
        expect(normalizeProfileId('abc-123')).toBe('abc-123');
    });
});

describe('normalizeSettings', () => {
    test('anything that is not an object gives a fresh copy of the defaults', () => {
        for (const raw of [undefined, null, 'x', 5, [], true]) {
            const result = normalizeSettings(raw);
            expect(result).toEqual({ ...DEFAULT_SETTINGS });
            expect(result).not.toBe(DEFAULT_SETTINGS);
            expect(Object.isFrozen(result)).toBe(false);
        }
    });

    test('keeps valid values', () => {
        const input = {
            enabled: false,
            autoGenerate: false,
            autoSend: true,
            profileId: 'p1',
            showQuickGenerateButton: true,
            numChoices: 5,
            maxTokens: 900,
            historyDepth: 8,
            promptTemplate: 'mine {{history}}',
        };
        expect(normalizeSettings(input)).toEqual(input);
    });

    test('fills missing keys with defaults', () => {
        expect(normalizeSettings({ numChoices: 2 })).toEqual({ ...DEFAULT_SETTINGS, numChoices: 2 });
    });

    test('clamps and repairs invalid values', () => {
        const result = normalizeSettings({
            enabled: 'yes',
            autoGenerate: 1,
            autoSend: null,
            profileId: '',
            showQuickGenerateButton: 'true',
            numChoices: 50,
            maxTokens: -1,
            historyDepth: 'abc',
            promptTemplate: '',
        });
        expect(result).toEqual({ ...DEFAULT_SETTINGS, numChoices: 10 });
    });

    test('upgrades only the exact legacy default template', () => {
        expect(normalizeSettings({ promptTemplate: LEGACY_DEFAULT_PROMPT_TEMPLATE }).promptTemplate).toBe(
            DEFAULT_PROMPT_TEMPLATE,
        );
        const custom = LEGACY_DEFAULT_PROMPT_TEMPLATE + ' (edited)';
        expect(normalizeSettings({ promptTemplate: custom }).promptTemplate).toBe(custom);
    });

    test('does not mutate its input and drops unknown keys', () => {
        const input = { numChoices: 50, unknown: 'x' };
        const result = normalizeSettings(input);
        expect(input).toEqual({ numChoices: 50, unknown: 'x' });
        expect('unknown' in result).toBe(false);
    });
});
