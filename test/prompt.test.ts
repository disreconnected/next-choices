import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import {
    HISTORY_PLACEHOLDER,
    appendCombinationTask,
    appendEnhancementTask,
    appendGuidedTask,
    buildCombinationPrompt,
    buildEnhancementPrompt,
    buildGuidedPrompt,
    buildHistory,
    buildPrompt,
    buildPromptAsync,
    finalizePrompt,
    prepareTemplate,
    type PromptVars,
} from '../src/shared/prompt';
import { DEFAULT_PROMPT_TEMPLATE } from '../src/shared/templates';

const TEMPLATE = 'Chat ({{user}} / {{char}}):\n{{history}}\nPersona: {{persona}}\nN={{numChoices}}';

function vars(overrides: Partial<PromptVars> = {}): PromptVars {
    return {
        history: 'Alice: hi\nBob: yo',
        numChoices: 3,
        user: 'Alice',
        char: 'Bob',
        persona: 'Tall.',
        ...overrides,
    };
}

function payloadBetween(prompt: string, start: string, end: string): any {
    const from = prompt.indexOf(start);
    const to = prompt.lastIndexOf(end);
    expect(from).toBeGreaterThanOrEqual(0);
    expect(to).toBeGreaterThan(from);
    return JSON.parse(prompt.slice(from + start.length, to));
}

const warnSpies: Array<{ mockRestore(): void }> = [];
function silenceWarn() {
    const spy = spyOn(console, 'warn').mockImplementation(() => {});
    warnSpies.push(spy);
    return spy;
}
afterEach(() => {
    while (warnSpies.length) warnSpies.pop()!.mockRestore();
});

describe('buildHistory', () => {
    const messages = [
        { name: 'Alice', text: 'one' },
        { name: 'Bob', text: 'two' },
        { name: 'Alice', text: 'three' },
    ];

    test('formats "Name: text" lines joined by newlines', () => {
        expect(buildHistory(messages, 10)).toBe('Alice: one\nBob: two\nAlice: three');
    });

    test('keeps only the last `depth` messages', () => {
        expect(buildHistory(messages, 2)).toBe('Bob: two\nAlice: three');
    });

    test('depth below 1 still keeps one message', () => {
        expect(buildHistory(messages, 0)).toBe('Alice: three');
        expect(buildHistory(messages, -5)).toBe('Alice: three');
    });

    test('a missing name becomes "?"', () => {
        expect(buildHistory([{ text: 'x' }, { name: null, text: 'y' }], 5)).toBe('?: x\n?: y');
    });

    test('no messages gives an empty string', () => {
        expect(buildHistory([], 4)).toBe('');
    });
});

describe('buildPrompt', () => {
    test('HISTORY_PLACEHOLDER is a private-use sentinel', () => {
        expect(HISTORY_PLACEHOLDER).toBe('NEXT_CHOICES_HISTORY');
    });

    test('without an expander it substitutes numChoices, history and the manual macros', () => {
        expect(buildPrompt(TEMPLATE, vars())).toBe(
            'Chat (Alice / Bob):\nAlice: hi\nBob: yo\nPersona: Tall.\nN=3',
        );
    });

    test('replaces every occurrence of numChoices and history', () => {
        expect(buildPrompt('{{numChoices}}+{{numChoices}} {{history}}|{{history}}', vars({ history: 'H' }))).toBe(
            '3+3 H|H',
        );
    });

    test('an empty or missing template falls back to the default template', () => {
        const expected = buildPrompt(DEFAULT_PROMPT_TEMPLATE, vars());
        expect(buildPrompt('', vars())).toBe(expected);
        expect(buildPrompt(undefined, vars())).toBe(expected);
        expect(expected).toContain('Persona of Alice');
        expect(expected).toContain('Tall.');
    });

    test('the expander sees the placeholder instead of history, with numChoices already replaced', () => {
        const seen: string[] = [];
        buildPrompt('H={{history}} N={{numChoices}} D={{description}}', vars(), (text) => {
            seen.push(text);
            return text;
        });
        expect(seen).toEqual([`H=${HISTORY_PLACEHOLDER} N=3 D={{description}}`]);
        expect(seen[0]).not.toContain('Alice: hi');
    });

    test('the expander result is used and history is inserted after it', () => {
        const out = buildPrompt('{{history}} / {{description}} / {{user}}', vars(), (text) =>
            text.replaceAll('{{description}}', 'DESC'),
        );
        expect(out).toBe('Alice: hi\nBob: yo / DESC / Alice');
    });

    test('macros inside the history are never expanded (not by the expander, not by the manual pass)', () => {
        const history = 'Bob: use {{persona}} and {{user}} and {{char}} here';
        const out = buildPrompt('{{history}}', vars({ history }), (text) =>
            text.replaceAll('{{persona}}', 'LEAK').replaceAll('{{user}}', 'LEAK'),
        );
        expect(out).toBe(history);
    });

    test('manual fallback fills {{user}}, {{char}} and {{persona}} when the expander leaves them', () => {
        const out = buildPrompt('{{user}}|{{char}}|{{persona}}', vars(), (text) => text);
        expect(out).toBe('Alice|Bob|Tall.');
    });

    test('an empty persona is substituted as an empty string', () => {
        expect(buildPrompt('[{{persona}}]', vars({ persona: '' }))).toBe('[]');
    });

    test('an expander that throws falls back to manual replacement and warns', () => {
        const warn = silenceWarn();
        const out = buildPrompt(TEMPLATE, vars(), () => {
            throw new Error('boom');
        });
        expect(out).toBe('Chat (Alice / Bob):\nAlice: hi\nBob: yo\nPersona: Tall.\nN=3');
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toBe('[nextChoices] substituteParams failed, using manual macro replacement:');
    });

    test('an expander that returns a non-string is ignored and warns', () => {
        const warn = silenceWarn();
        const out = buildPrompt(TEMPLATE, vars(), (() => 42) as unknown as (text: string) => string);
        expect(out).toBe('Chat (Alice / Bob):\nAlice: hi\nBob: yo\nPersona: Tall.\nN=3');
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toBe(
            '[nextChoices] substituteParams returned a non-string; using manual macro replacement.',
        );
    });

    test('quirk: history is inserted through replaceAll(string, string), so "$" patterns in it are interpreted', () => {
        expect(buildPrompt('{{history}}', vars({ history: 'costs $$5' }))).toBe('costs $5');
        expect(buildPrompt('{{history}}', vars({ history: 'x $& y' }))).toBe(`x ${HISTORY_PLACEHOLDER} y`);
    });
});

describe('prepareTemplate / finalizePrompt', () => {
    test('prepareTemplate swaps in the placeholder and numChoices and applies the default template', () => {
        expect(prepareTemplate('{{history}} {{numChoices}} {{user}}', 4)).toBe(`${HISTORY_PLACEHOLDER} 4 {{user}}`);
        expect(prepareTemplate('', 2)).toBe(prepareTemplate(DEFAULT_PROMPT_TEMPLATE, 2));
    });

    test('finalizePrompt fills the manual macros and then the history', () => {
        expect(finalizePrompt(`{{user}}/{{char}}/{{persona}}/${HISTORY_PLACEHOLDER}`, vars())).toBe(
            'Alice/Bob/Tall./Alice: hi\nBob: yo',
        );
    });
});

describe('buildPromptAsync', () => {
    test('awaits an async expander', async () => {
        const out = await buildPromptAsync('{{description}} {{user}} {{history}}', vars(), async (text) =>
            text.replaceAll('{{description}}', 'DESC'),
        );
        expect(out).toBe('DESC Alice Alice: hi\nBob: yo');
    });

    test('gives the same result as buildPrompt for a synchronous expander', async () => {
        const expand = (text: string) => text.replaceAll('{{description}}', 'DESC');
        expect(await buildPromptAsync(TEMPLATE + ' {{description}}', vars(), expand)).toBe(
            buildPrompt(TEMPLATE + ' {{description}}', vars(), expand),
        );
    });

    test('works without an expander', async () => {
        expect(await buildPromptAsync(TEMPLATE, vars())).toBe(buildPrompt(TEMPLATE, vars()));
    });

    test('a rejecting expander falls back to manual replacement and warns', async () => {
        const warn = silenceWarn();
        const out = await buildPromptAsync(TEMPLATE, vars(), async () => {
            throw new Error('rpc failed');
        });
        expect(out).toBe(buildPrompt(TEMPLATE, vars()));
        expect(warn.mock.calls[0]?.[0]).toBe('[nextChoices] substituteParams failed, using manual macro replacement:');
    });

    test('a non-string result is ignored and warns', async () => {
        const warn = silenceWarn();
        const out = await buildPromptAsync(TEMPLATE, vars(), (async () => null) as unknown as () => Promise<string>);
        expect(out).toBe(buildPrompt(TEMPLATE, vars()));
        expect(warn.mock.calls[0]?.[0]).toBe(
            '[nextChoices] substituteParams returned a non-string; using manual macro replacement.',
        );
    });

    test('the expander never sees the history', async () => {
        const seen: string[] = [];
        await buildPromptAsync('{{history}}', vars(), async (text) => {
            seen.push(text);
            return text;
        });
        expect(seen).toEqual([HISTORY_PLACEHOLDER]);
    });
});

describe('buildGuidedPrompt', () => {
    const START = '\n\n=== Next Choices guided generation ===\n';
    const END = '\n=== End of Next Choices guided generation ===';

    test('appends the JSON task block to the expanded base prompt', () => {
        const prompt = buildGuidedPrompt(TEMPLATE, vars(), 'invite her to dance');
        const base = buildPrompt(TEMPLATE, vars());
        expect(prompt.startsWith(base + START)).toBe(true);
        expect(prompt.endsWith(END)).toBe(true);

        const payload = payloadBetween(prompt, START, END);
        expect(payload.task).toBe('Generate new response options around the shared theme below.');
        expect(payload.guidance).toBe('invite her to dance');
        expect(payload.requirements).toHaveLength(4);
        expect(payload.requirements[3]).toBe(
            'Return ONLY a JSON array of exactly 3 nonempty strings, with no commentary.',
        );
    });

    test('uses numChoices from vars both in the base prompt and in the task', () => {
        const prompt = buildGuidedPrompt('N={{numChoices}}', vars({ numChoices: 5 }), 'g');
        expect(prompt.startsWith('N=5' + START)).toBe(true);
        expect(payloadBetween(prompt, START, END).requirements[3]).toContain('exactly 5 nonempty strings');
    });

    test('the task is appended after expansion, so guidance never reaches the expander or manual macros', () => {
        const seen: string[] = [];
        const prompt = buildGuidedPrompt(TEMPLATE, vars(), '{{user}} dances {{persona}}', (text) => {
            seen.push(text);
            return text.replaceAll('{{user}}', 'LEAK');
        });
        expect(seen).toHaveLength(1);
        expect(seen[0]).not.toContain('guided generation');
        expect(payloadBetween(prompt, START, END).guidance).toBe('{{user}} dances {{persona}}');
    });

    test('appendGuidedTask produces the same block', () => {
        const base = buildPrompt(TEMPLATE, vars());
        expect(appendGuidedTask(base, 3, 'g')).toBe(buildGuidedPrompt(TEMPLATE, vars(), 'g'));
    });
});

describe('buildEnhancementPrompt', () => {
    const START = '\n\n=== Next Choices enhancement task ===\n';
    const END = '\n=== End of Next Choices enhancement task ===';

    test('pins numChoices to the number of displayed choices', () => {
        const prompt = buildEnhancementPrompt('N={{numChoices}}', vars({ numChoices: 5 }), ['a', 'b'], 'bolder');
        expect(prompt.startsWith('N=2' + START)).toBe(true);
        expect(prompt.endsWith(END)).toBe(true);
    });

    test('carries the originals, the guidance and an exact-count requirement', () => {
        const prompt = buildEnhancementPrompt(TEMPLATE, vars(), ['a', 'b'], 'bolder');
        const payload = payloadBetween(prompt, START, END);
        expect(payload.task).toStartWith('Enhance each response option below according to the guidance.');
        expect(payload.guidance).toBe('bolder');
        expect(payload.choices).toEqual(['a', 'b']);
        expect(payload.requirements).toHaveLength(4);
        expect(payload.requirements[3]).toBe(
            'Return the complete enhanced version of every choice (not only the additions) as a JSON array of exactly 2 nonempty strings, with no commentary.',
        );
    });

    test('appended after expansion and, unlike the combination prompt, braces are not escaped', () => {
        const seen: string[] = [];
        const prompt = buildEnhancementPrompt(TEMPLATE, vars(), ['say {{user}}'], 'more {{char}}', (text) => {
            seen.push(text);
            return text;
        });
        expect(seen).toHaveLength(1);
        expect(seen[0]).not.toContain('enhancement task');
        expect(prompt).toContain('say {{user}}');
        expect(prompt).not.toContain('\\u007B');
    });

    test('appendEnhancementTask produces the same block', () => {
        const base = buildPrompt(TEMPLATE, { ...vars(), numChoices: 1 });
        expect(appendEnhancementTask(base, ['a'], 'g')).toBe(buildEnhancementPrompt(TEMPLATE, vars(), ['a'], 'g'));
    });
});

describe('buildCombinationPrompt', () => {
    const START = '\n\n=== Next Choices combination task ===\n';
    const END = '\n=== End of Next Choices combination task ===';

    test('pins numChoices to 1', () => {
        const prompt = buildCombinationPrompt('N={{numChoices}}', vars({ numChoices: 5 }), ['a', 'b']);
        expect(prompt.startsWith('N=1' + START)).toBe(true);
        expect(prompt.endsWith(END)).toBe(true);
    });

    test('escapes "{{" in the payload so the host\'s second macro pass cannot expand choice text', () => {
        const prompt = buildCombinationPrompt(TEMPLATE, vars(), ['say {{user}}', 'and {{char}} too']);
        const block = prompt.slice(prompt.indexOf('=== Next Choices combination task ==='));
        expect(block).not.toContain('{{');
        expect(block).toContain('\\u007B\\u007B');
    });

    test('JSON decoding recovers the exact choice strings', () => {
        const choices = ['say {{user}}', 'and {{char}} too'];
        const payload = payloadBetween(buildCombinationPrompt(TEMPLATE, vars(), choices), START, END);
        expect(payload.choices).toEqual(choices);
        expect(payload.task).toStartWith('Rewrite the selected response options into ONE coherent player response.');
        expect(payload.requirements).toHaveLength(5);
        expect(payload.requirements[4]).toBe(
            'Return ONLY a JSON array containing exactly one nonempty string: the complete combined response, with no commentary.',
        );
    });

    test('the task is appended after expansion', () => {
        const seen: string[] = [];
        buildCombinationPrompt(TEMPLATE, vars(), ['a', 'b'], (text) => {
            seen.push(text);
            return text;
        });
        expect(seen).toHaveLength(1);
        expect(seen[0]).not.toContain('combination task');
    });

    test('appendCombinationTask produces the same block', () => {
        const base = buildPrompt(TEMPLATE, { ...vars(), numChoices: 1 });
        expect(appendCombinationTask(base, ['a', 'b'])).toBe(buildCombinationPrompt(TEMPLATE, vars(), ['a', 'b']));
    });
});
