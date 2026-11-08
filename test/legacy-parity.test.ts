/**
 * Differential test: the extracted code (src/shared + src/st/prompt) must give
 * exactly the same results as the original index.js code, which is kept
 * verbatim in test/legacy-oracle.js (a mechanical copy of the pure parts of
 * index.js at the commit before the extraction).
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
// @ts-expect-error -- plain JS fixture without type declarations (verbatim legacy code)
import * as legacy from './legacy-oracle.js';
import { parseChoices, parseRewrittenChoices } from '../src/shared/parse';
import { HISTORY_PLACEHOLDER } from '../src/shared/prompt';
import {
    DEFAULT_SETTINGS,
    backfillDefaults,
    normalizeHistoryDepth,
    normalizeMaxTokens,
    normalizeNumChoices,
    normalizePromptTemplate,
    upgradeLegacyTemplate,
} from '../src/shared/settings';
import { DEFAULT_PROMPT_TEMPLATE, LEGACY_DEFAULT_PROMPT_TEMPLATE } from '../src/shared/templates';
import * as st from '../src/st/prompt';

let warnSpy: { mockRestore(): void };
beforeEach(() => {
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warnSpy.mockRestore());

describe('constants', () => {
    test('templates, placeholder and defaults are identical to the legacy ones', () => {
        expect(DEFAULT_PROMPT_TEMPLATE).toBe(legacy.DEFAULT_PROMPT_TEMPLATE);
        expect(LEGACY_DEFAULT_PROMPT_TEMPLATE).toBe(legacy.LEGACY_DEFAULT_PROMPT_TEMPLATE);
        expect(HISTORY_PLACEHOLDER).toBe(legacy.HISTORY_PLACEHOLDER);
        expect({ ...DEFAULT_SETTINGS }).toEqual({ ...legacy.DEFAULT_SETTINGS });
        expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(Object.isFrozen(legacy.DEFAULT_SETTINGS));
    });
});

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

const CHATS: Array<[string, unknown]> = [
    [
        'mixed',
        [
            { name: 'Alice', mes: 'Hello there', is_system: false },
            { name: 'Bob', mes: 'Hi! *waves*', is_system: false },
            { name: 'System', mes: 'hidden note', is_system: true },
            null,
            { name: 'Alice', mes: { not: 'a string' } },
            { mes: 'nameless message' },
            { name: 'Bob', mes: '"Quoted" and {{persona}} and {{user}}' },
            { name: 'Alice', mes: 'last message' },
        ],
    ],
    ['macro and dollar patterns', [{ name: 'Bob', mes: 'costs $$5, $&, $1 and {{persona}}' }]],
    ['empty', []],
    ['missing', undefined],
    ['not an array', 'oops'],
];

const NAMES: Array<[string, { name1?: string; name2?: string }]> = [
    ['named', { name1: 'Alice', name2: 'Bob' }],
    ['unnamed', {}],
];

const PERSONAS: unknown[] = ['Tall, quiet.', '  padded  \n', '', undefined, 42];

const CUSTOM_TEMPLATE =
    'U={{user}} C={{char}} P={{persona}} N={{numChoices}} D={{description}}\n{{history}}\n[{{history}}] {{numChoices}}';
const TEMPLATES: Array<[string, string]> = [
    ['default', DEFAULT_PROMPT_TEMPLATE],
    ['legacy', LEGACY_DEFAULT_PROMPT_TEMPLATE],
    ['empty', ''],
    ['custom', CUSTOM_TEMPLATE],
    ['no macros', 'Just write some options.'],
];

const EXPANDERS: Array<[string, ((text: string) => unknown) | undefined]> = [
    ['none', undefined],
    ['identity', (text) => text],
    ['description', (text) => text.replaceAll('{{description}}', 'DESC')],
    ['names', (text) => text.replaceAll('{{user}}', 'Zed').replaceAll('{{persona}}', 'P').replaceAll('{{char}}', 'Y')],
    [
        'throws',
        () => {
            throw new Error('boom');
        },
    ],
    ['number', () => 42],
    ['undefined', () => undefined],
];

const DEPTHS = [1, 3, 100];
const COUNTS = [1, 3, 10];
const CHOICE_SETS = [['a', 'b'], ['say {{user}} and $&'], ['x', 'y', 'z'], []];
const GUIDANCES = ['more bold', '{{user}} "quote"\nsecond line $$', ''];

function makeCtx(chat: unknown, names: { name1?: string; name2?: string }, persona: unknown, expand: unknown) {
    const ctx: Record<string, unknown> = {
        chat,
        ...names,
        powerUserSettings: { persona_description: persona },
    };
    if (expand) ctx.substituteParams = expand;
    return ctx;
}

describe('prompt building matches index.js', () => {
    test('buildHistory', () => {
        const mismatches: string[] = [];
        for (const [chatLabel, chat] of CHATS) {
            for (const depth of [0, 1, 2, 3, 100, -4]) {
                const ctx = { chat };
                const a = legacy.buildHistory(ctx, depth);
                const b = st.buildHistory(ctx, depth);
                if (a !== b) mismatches.push(`${chatLabel} depth=${depth}`);
            }
        }
        expect(mismatches).toEqual([]);
        expect(st.buildHistory(undefined, 4)).toBe(legacy.buildHistory(undefined, 4));
    });

    test('buildPrompt / buildGuidedPrompt / buildEnhancementPrompt / buildCombinationPrompt', () => {
        const mismatches: string[] = [];
        let compared = 0;
        for (const [chatLabel, chat] of CHATS) {
            for (const [nameLabel, names] of NAMES) {
                for (const persona of PERSONAS) {
                    for (const [templateLabel, promptTemplate] of TEMPLATES) {
                        for (const [expandLabel, expand] of EXPANDERS) {
                            const ctx = makeCtx(chat, names, persona, expand);
                            for (const historyDepth of DEPTHS) {
                                for (const numChoices of COUNTS) {
                                    const settings = { promptTemplate, historyDepth, numChoices };
                                    const where = `${chatLabel}/${nameLabel}/${String(persona)}/${templateLabel}/${expandLabel}/${historyDepth}/${numChoices}`;
                                    const check = (kind: string, a: unknown, b: unknown) => {
                                        compared++;
                                        if (a !== b) mismatches.push(`${kind} ${where}`);
                                    };
                                    check('prompt', legacy.buildPrompt(ctx, settings), st.buildPrompt(ctx, settings));
                                    const guidance = GUIDANCES[numChoices % GUIDANCES.length]!;
                                    check(
                                        'guided',
                                        legacy.buildGuidedPrompt(ctx, settings, guidance),
                                        st.buildGuidedPrompt(ctx, settings, guidance),
                                    );
                                    const choices = CHOICE_SETS[historyDepth % CHOICE_SETS.length]!;
                                    check(
                                        'enhancement',
                                        legacy.buildEnhancementPrompt(ctx, settings, choices, guidance),
                                        st.buildEnhancementPrompt(ctx, settings, choices, guidance),
                                    );
                                    check(
                                        'combination',
                                        legacy.buildCombinationPrompt(ctx, settings, choices),
                                        st.buildCombinationPrompt(ctx, settings, choices),
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
        expect(mismatches).toEqual([]);
        expect(compared).toBeGreaterThan(10000);
    });

    test('a missing ctx falls back to "User" / "Assistant" like the original', () => {
        const settings = { promptTemplate: '{{user}}|{{char}}|{{persona}}|{{history}}', historyDepth: 4, numChoices: 3 };
        expect(st.buildPrompt(undefined, settings)).toBe(legacy.buildPrompt(undefined, settings));
        expect(st.buildPrompt(null, settings)).toBe(legacy.buildPrompt(null, settings));
        expect(st.buildPrompt(undefined, settings)).toBe('User|Assistant||');
    });
});

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const PARSE_INPUTS: unknown[] = [
    '["a","b","c"]',
    '[" a ", "", "   ", "b"]',
    '[{"text":"t"},{"option":"o"},{"choice":"c"},{"content":"k"}]',
    '[{"content":"k","text":"t"}]',
    '[{"text":"","option":"o"},"b"]',
    '[{"text":5},{"other":"x"},null,7,"ok"]',
    '["a","b","c","d","e"]',
    '["", "a", "b", "c"]',
    'Sure! Here are the options:\n["a","b"]\nHope this helps.',
    '```json\n[\n  "a",\n  "b"\n]\n```',
    'see [1]\n["a"]',
    '1. a\n2) b\n3、c',
    '- a\n* b\n• c',
    '1 . a\n2  ) b',
    '-foo\n*bar',
    '1.foo',
    'Here you go:\r\n   1. first\r\n   2. second\r\nThanks!',
    '1. a\n2. b\n3. c\n4. d',
    '1. "Hello there",',
    "- 'single'",
    '2) "quoted"',
    '1. 「你好」',
    '2. 『再见』,',
    '- ""x""',
    "- 'it's'",
    '1. ""\n2. real',
    'Here: ["a", "b",]\n- x',
    '[oops\n1. a',
    '[]\n1. from list',
    '[1,2,3]\n- from list',
    '[1,2,3]',
    '[]',
    '["a"]',
    '["a",""]',
    '["a","   "]',
    '["a",1]',
    '[{"text":"a"}]',
    '["a",null]',
    '["  a ", "b  "]',
    'Sure: ["a"] done',
    '][',
    '{"choices":["a","b"]}',
    '[["nested"]]',
    '- "a",\n- "b",\n',
    '* **bold** start\n* second',
    '1) 1.5 apples',
    'I am sorry, I cannot help with that.',
    '',
    '   \n  ',
    undefined,
    null,
    42,
    { content: '["a"]' },
    ['a'],
];

describe('parsing matches index.js', () => {
    test('parseChoices', () => {
        const mismatches: string[] = [];
        for (const input of PARSE_INPUTS) {
            for (const max of [0, 1, 2, 3, 10, undefined]) {
                const a = JSON.stringify(legacy.parseChoices(input, max));
                const b = JSON.stringify(parseChoices(input, max as number));
                if (a !== b) mismatches.push(`${JSON.stringify(input)} max=${max}`);
            }
        }
        expect(mismatches).toEqual([]);
    });

    test('parseRewrittenChoices', () => {
        const mismatches: string[] = [];
        for (const input of PARSE_INPUTS) {
            for (const count of [0, 1, 2, 3, 5]) {
                const a = JSON.stringify(legacy.parseRewrittenChoices(input, count));
                const b = JSON.stringify(parseRewrittenChoices(input, count));
                if (a !== b) mismatches.push(`${JSON.stringify(input)} count=${count}`);
            }
        }
        expect(mismatches).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

describe('settings match index.js', () => {
    const INPUTS: unknown[] = [
        '3', '3.7', '0', '-1', 'abc', '', ' ', '1', '7', '10', '15', '99999', '1.9', '08', '1e3', '0x10',
        '  5  ', '5px', undefined, null, NaN, 0, 4, -3, 99, ['2'], [],
    ];

    // Transcribed from the input handlers in bindSettingsUI() of index.js.
    const legacyNum = (raw: unknown) => {
        const value = parseInt(raw as string, 10);
        return Number.isFinite(value) && value > 0 ? Math.min(value, 10) : legacy.DEFAULT_SETTINGS.numChoices;
    };
    const legacyMax = (raw: unknown) => {
        const value = parseInt(raw as string, 10);
        return Number.isFinite(value) && value > 0 ? value : legacy.DEFAULT_SETTINGS.maxTokens;
    };
    const legacyDepth = (raw: unknown) => {
        const value = parseInt(raw as string, 10);
        return Number.isFinite(value) && value > 0 ? value : legacy.DEFAULT_SETTINGS.historyDepth;
    };
    const legacyTemplate = (raw: unknown) => String(raw ?? '') || legacy.DEFAULT_PROMPT_TEMPLATE;

    test('numeric and template normalisation', () => {
        for (const raw of INPUTS) {
            expect(normalizeNumChoices(raw)).toBe(legacyNum(raw));
            expect(normalizeMaxTokens(raw)).toBe(legacyMax(raw));
            expect(normalizeHistoryDepth(raw)).toBe(legacyDepth(raw));
            expect(normalizePromptTemplate(raw)).toBe(legacyTemplate(raw));
        }
    });

    test('getSettings backfill and legacy-template upgrade', () => {
        const stores: unknown[] = [
            undefined,
            {},
            { numChoices: 7 },
            { promptTemplate: LEGACY_DEFAULT_PROMPT_TEMPLATE },
            { promptTemplate: LEGACY_DEFAULT_PROMPT_TEMPLATE + '\n' },
            { promptTemplate: 'custom', maxTokens: undefined, extra: true },
            { ...DEFAULT_SETTINGS },
            { enabled: false, autoSend: true, profileId: 'abc' },
        ];
        const previous = (globalThis as Record<string, unknown>).SillyTavern;
        try {
            for (const store of stores) {
                const legacyCtx: any = { extensionSettings: {}, saveSettingsDebounced: () => legacyCtx.saves++, saves: 0 };
                if (store !== undefined) legacyCtx.extensionSettings.nextChoices = structuredClone(store);
                (globalThis as Record<string, unknown>).SillyTavern = { getContext: () => legacyCtx };
                const legacyResult = legacy.getSettings();

                // The composition that the SillyTavern adapter performs in getSettings().
                let saves = 0;
                const sharedStore: Record<string, unknown> =
                    store === undefined ? { ...DEFAULT_SETTINGS } : (structuredClone(store) as Record<string, unknown>);
                backfillDefaults(sharedStore);
                if (upgradeLegacyTemplate(sharedStore)) saves++;

                expect(sharedStore).toEqual(legacyResult);
                expect(saves).toBe(legacyCtx.saves);
            }
        } finally {
            (globalThis as Record<string, unknown>).SillyTavern = previous;
        }
    });
});
