import { describe, expect, test } from 'bun:test';
import { parseChoices, parseRewrittenChoices } from '../src/shared/parse';

describe('parseChoices: JSON array', () => {
    test('plain strings', () => {
        expect(parseChoices('["a","b","c"]', 3)).toEqual(['a', 'b', 'c']);
    });

    test('trims items and drops empty ones', () => {
        expect(parseChoices('[" a ", "", "   ", "b"]', 5)).toEqual(['a', 'b']);
    });

    test('object items use text, then option, then choice, then content', () => {
        const text = '[{"text":"t"},{"option":"o"},{"choice":"c"},{"content":"k"}]';
        expect(parseChoices(text, 4)).toEqual(['t', 'o', 'c', 'k']);
        expect(parseChoices('[{"content":"k","text":"t"}]', 1)).toEqual(['t']);
    });

    test('object alias lookup uses ??, so an empty text hides later aliases and is dropped', () => {
        expect(parseChoices('[{"text":"","option":"o"},"b"]', 5)).toEqual(['b']);
    });

    test('objects without a usable string field are dropped', () => {
        expect(parseChoices('[{"text":5},{"other":"x"},null,7,"ok"]', 5)).toEqual(['ok']);
    });

    test('slices to the requested count', () => {
        expect(parseChoices('["a","b","c","d","e"]', 3)).toEqual(['a', 'b', 'c']);
    });

    test('empties are dropped before slicing', () => {
        expect(parseChoices('["", "a", "b", "c"]', 2)).toEqual(['a', 'b']);
    });

    test('fewer items than requested are returned as-is', () => {
        expect(parseChoices('["a"]', 3)).toEqual(['a']);
    });

    test('ignores prose before and after the array', () => {
        const text = 'Sure! Here are the options:\n["a","b"]\nHope this helps.';
        expect(parseChoices(text, 3)).toEqual(['a', 'b']);
    });

    test('parses a multi-line, pretty-printed array inside a code fence', () => {
        expect(parseChoices('```json\n[\n  "a",\n  "b"\n]\n```', 2)).toEqual(['a', 'b']);
    });

    test('quirk: the array is sliced from the FIRST "[" to the LAST "]"', () => {
        // "[1]" in the prose makes the slice "[1]\n[\"a\"]", which is not valid JSON,
        // and there is no list line to fall back to.
        expect(parseChoices('see [1]\n["a"]', 3)).toEqual([]);
    });

    test('quirk: an undefined max means no slicing', () => {
        expect(parseChoices('["a","b","c"]', undefined as unknown as number)).toEqual(['a', 'b', 'c']);
    });
});

describe('parseChoices: numbered and bulleted fallback', () => {
    test('numbered with ".", ")" and the CJK enumeration comma', () => {
        expect(parseChoices('1. a\n2) b\n3、c', 3)).toEqual(['a', 'b', 'c']);
    });

    test('bulleted with "-", "*" and the bullet character', () => {
        expect(parseChoices('- a\n* b\n• c', 3)).toEqual(['a', 'b', 'c']);
    });

    test('numbers may be followed by spaces before the delimiter', () => {
        expect(parseChoices('1 . a\n2  ) b', 2)).toEqual(['a', 'b']);
    });

    test('bullets need whitespace after them, numbers do not', () => {
        expect(parseChoices('-foo\n*bar', 3)).toEqual([]);
        expect(parseChoices('1.foo', 3)).toEqual(['foo']);
    });

    test('indented lines, CRLF endings and non-list lines are handled', () => {
        const text = 'Here you go:\r\n   1. first\r\n   2. second\r\nThanks!';
        expect(parseChoices(text, 5)).toEqual(['first', 'second']);
    });

    test('slices the list to the requested count', () => {
        expect(parseChoices('1. a\n2. b\n3. c\n4. d', 2)).toEqual(['a', 'b']);
    });

    test('strips wrapping ASCII quotes and a trailing comma', () => {
        expect(parseChoices('1. "Hello there",', 3)).toEqual(['Hello there']);
        expect(parseChoices("- 'single'", 3)).toEqual(['single']);
        expect(parseChoices('2) "quoted"', 3)).toEqual(['quoted']);
    });

    test('strips wrapping CJK quotes', () => {
        expect(parseChoices('1. 「你好」', 3)).toEqual(['你好']);
        expect(parseChoices('2. 『再见』,', 3)).toEqual(['再见']);
    });

    test('quirk: one leading quote char is stripped, but a whole trailing run is', () => {
        expect(parseChoices('- ""x""', 3)).toEqual(['"x']);
        expect(parseChoices("- 'it's'", 3)).toEqual(["it's"]);
    });

    test('an item that is only quotes is skipped', () => {
        expect(parseChoices('1. ""\n2. real', 3)).toEqual(['real']);
    });

    test('a JSON array that is invalid JSON (trailing comma) falls back to list lines', () => {
        expect(parseChoices('Here: ["a", "b",]\n- x', 3)).toEqual(['x']);
    });

    test('an unterminated "[" falls back to list lines', () => {
        expect(parseChoices('[oops\n1. a', 3)).toEqual(['a']);
    });

    test('a JSON array with no usable items falls THROUGH to the list fallback', () => {
        expect(parseChoices('[]\n1. from list', 3)).toEqual(['from list']);
        expect(parseChoices('[1,2,3]\n- from list', 3)).toEqual(['from list']);
        expect(parseChoices('[1,2,3]', 3)).toEqual([]);
        expect(parseChoices('[]', 3)).toEqual([]);
    });
});

describe('parseChoices: garbage', () => {
    test('returns [] when nothing usable is found', () => {
        expect(parseChoices('I am sorry, I cannot help with that.', 3)).toEqual([]);
        expect(parseChoices('', 3)).toEqual([]);
        expect(parseChoices('   \n  ', 3)).toEqual([]);
    });

    test('returns [] for non-string input', () => {
        expect(parseChoices(undefined, 3)).toEqual([]);
        expect(parseChoices(null, 3)).toEqual([]);
        expect(parseChoices(42, 3)).toEqual([]);
        expect(parseChoices({ content: '["a"]' }, 3)).toEqual([]);
    });
});

describe('parseRewrittenChoices', () => {
    test('accepts exactly N non-empty strings', () => {
        expect(parseRewrittenChoices('["a","b"]', 2)).toEqual(['a', 'b']);
        expect(parseRewrittenChoices('["only"]', 1)).toEqual(['only']);
    });

    test('returns trimmed items', () => {
        expect(parseRewrittenChoices('["  a ", "b  "]', 2)).toEqual(['a', 'b']);
    });

    test('ignores prose around the array', () => {
        expect(parseRewrittenChoices('Sure: ["a"] done', 1)).toEqual(['a']);
    });

    test('rejects a wrong count (too few or too many)', () => {
        expect(parseRewrittenChoices('["a"]', 2)).toBeNull();
        expect(parseRewrittenChoices('["a","b","c"]', 2)).toBeNull();
    });

    test('rejects any item that is empty after trimming', () => {
        expect(parseRewrittenChoices('["a",""]', 2)).toBeNull();
        expect(parseRewrittenChoices('["a","   "]', 2)).toBeNull();
    });

    test('rejects non-string items: no object aliases, no coercion', () => {
        expect(parseRewrittenChoices('["a",1]', 2)).toBeNull();
        expect(parseRewrittenChoices('[{"text":"a"}]', 1)).toBeNull();
        expect(parseRewrittenChoices('["a",null]', 2)).toBeNull();
    });

    test('has no numbered-line fallback', () => {
        expect(parseRewrittenChoices('1. a\n2. b', 2)).toBeNull();
    });

    test('rejects invalid JSON, missing brackets and non-string input', () => {
        expect(parseRewrittenChoices('["a",]', 1)).toBeNull();
        expect(parseRewrittenChoices('no array here', 1)).toBeNull();
        expect(parseRewrittenChoices('][', 1)).toBeNull();
        expect(parseRewrittenChoices('', 1)).toBeNull();
        expect(parseRewrittenChoices('   ', 1)).toBeNull();
        expect(parseRewrittenChoices(undefined, 1)).toBeNull();
        expect(parseRewrittenChoices(null, 1)).toBeNull();
        expect(parseRewrittenChoices(['a'], 1)).toBeNull();
    });

    test('quirk: an empty array satisfies an expected count of 0', () => {
        expect(parseRewrittenChoices('[]', 0)).toEqual([]);
    });
});
