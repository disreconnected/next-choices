import { describe, expect, test } from 'bun:test';
import { DEFAULT_SETTINGS, type NextChoicesSettings } from '../src/shared/settings';
import { DEFAULT_PROMPT_TEMPLATE } from '../src/shared/templates';
import { applySettingChange, buildProfileOptions } from '../src/lumiverse/settings-panel';

const fresh = (): NextChoicesSettings => ({ ...DEFAULT_SETTINGS });
const identity = (key: string) => key;

describe('applySettingChange', () => {
    test('booleans store only a real true', () => {
        const settings = fresh();
        expect(applySettingChange(settings, 'autoSend', true)).toBe(true);
        expect(settings.autoSend).toBe(true);
        expect(applySettingChange(settings, 'autoSend', 'true')).toBe(true);
        expect(settings.autoSend).toBe(false);
    });

    test('reports no change when the value is the same', () => {
        const settings = fresh();
        expect(applySettingChange(settings, 'enabled', true)).toBe(false);
        expect(applySettingChange(settings, 'numChoices', 3)).toBe(false);
    });

    test('numbers are normalised like the SillyTavern inputs', () => {
        const settings = fresh();
        expect(applySettingChange(settings, 'numChoices', 99)).toBe(true);
        expect(settings.numChoices).toBe(10);
        expect(applySettingChange(settings, 'numChoices', '5')).toBe(true);
        expect(settings.numChoices).toBe(5);
        expect(applySettingChange(settings, 'historyDepth', 10)).toBe(true);
        expect(applySettingChange(settings, 'historyDepth', 0)).toBe(true);
        expect(settings.historyDepth).toBe(DEFAULT_SETTINGS.historyDepth);
    });

    test('an empty number field is not a value and leaves the setting alone', () => {
        const settings = { ...fresh(), maxTokens: 800 };
        expect(applySettingChange(settings, 'maxTokens', null)).toBe(false);
        expect(applySettingChange(settings, 'maxTokens', undefined)).toBe(false);
        expect(settings.maxTokens).toBe(800);
    });

    test('profile id falls back to "current" when empty', () => {
        const settings = { ...fresh(), profileId: 'abc' };
        expect(applySettingChange(settings, 'profileId', '')).toBe(true);
        expect(settings.profileId).toBe('current');
    });

    test('an empty prompt template falls back to the default', () => {
        const settings = { ...fresh(), promptTemplate: 'custom' };
        expect(applySettingChange(settings, 'promptTemplate', '')).toBe(true);
        expect(settings.promptTemplate).toBe(DEFAULT_PROMPT_TEMPLATE);
    });

    test('an unknown key changes nothing', () => {
        const settings = fresh();
        expect(applySettingChange(settings, 'nope' as never, 1)).toBe(false);
        expect(settings).toEqual(DEFAULT_SETTINGS);
    });
});

describe('buildProfileOptions', () => {
    test('"current" comes first, then the profiles with their model', () => {
        const options = buildProfileOptions(identity, [
            { id: 'a', name: 'Alpha', model: 'm1' },
            { id: 'b', name: '', model: undefined },
        ]);
        expect(options.map((option) => option.value)).toEqual(['current', 'a', 'b']);
        expect(options[0]?.label).toBe('Current connection settings');
        expect(options[1]).toMatchObject({ label: 'Alpha', sublabel: 'm1' });
        expect(options[2]?.label).toBe('b');
        expect(options[2]).not.toHaveProperty('sublabel');
    });

    test('a saved profile stays selectable until the list has loaded', () => {
        const options = buildProfileOptions(identity, [], 'saved-id');
        expect(options.map((option) => option.value)).toEqual(['current', 'saved-id']);
    });

    test('no duplicate for a pending id that is in the list, or for "current"', () => {
        expect(buildProfileOptions(identity, [{ id: 'a', name: 'A' }], 'a')).toHaveLength(2);
        expect(buildProfileOptions(identity, [], 'current')).toHaveLength(1);
    });
});
