import { describe, expect, test } from 'bun:test';
import { formatChoiceHtml } from '../src/shared/format';

describe('formatChoiceHtml: escaping', () => {
    test('escapes markup so scripts and attributes cannot be injected', () => {
        const html = formatChoiceHtml('<script>alert(1)</script>');
        expect(html).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).not.toContain('<script');

        const attr = formatChoiceHtml('"><img src=x onerror=alert(1)>');
        expect(attr).not.toContain('<img');
        expect(attr).toContain('&lt;img');
    });

    test('escapes ampersands, quotes and apostrophes', () => {
        expect(formatChoiceHtml("Tom & Jerry's")).toBe('Tom &amp; Jerry&#39;s');
        expect(formatChoiceHtml('a "b')).toBe('a &quot;b');
    });

    test('an existing entity is escaped, not interpreted', () => {
        expect(formatChoiceHtml('&lt;b&gt;')).toBe('&amp;lt;b&amp;gt;');
    });

    test('markup inside emphasis is still escaped', () => {
        expect(formatChoiceHtml('*<b>x</b>*')).toBe('<em>&lt;b&gt;x&lt;/b&gt;</em>');
    });

    test('plain text and the empty string pass through', () => {
        expect(formatChoiceHtml('just words, nothing special.')).toBe('just words, nothing special.');
        expect(formatChoiceHtml('')).toBe('');
    });
});

describe('formatChoiceHtml: formatting', () => {
    test('*em*', () => {
        expect(formatChoiceHtml('a *soft* word')).toBe('a <em>soft</em> word');
    });

    test('**strong**', () => {
        expect(formatChoiceHtml('a **loud** word')).toBe('a <strong>loud</strong> word');
    });

    test('__underline__', () => {
        expect(formatChoiceHtml('a __marked__ word')).toBe('a <u>marked</u> word');
    });

    test('straight double quotes become <q> and keep their quote characters', () => {
        expect(formatChoiceHtml('She said "hello there".')).toBe('She said <q>&quot;hello there&quot;</q>.');
    });

    test('curly double quotes become <q> and keep their quote characters', () => {
        expect(formatChoiceHtml('She said “hello there”.')).toBe('She said <q>“hello there”</q>.');
    });

    test('newlines become <br>, CRLF included', () => {
        expect(formatChoiceHtml('one\ntwo\r\nthree')).toBe('one<br>two<br>three');
    });

    test('formats several spans in one string', () => {
        expect(formatChoiceHtml('"Hi," *she* said, **loudly**.')).toBe(
            '<q>&quot;Hi,&quot;</q> <em>she</em> said, <strong>loudly</strong>.',
        );
    });
});

describe('formatChoiceHtml: nesting and non-matches', () => {
    test('a quote inside emphasis', () => {
        expect(formatChoiceHtml('*"hi" there*')).toBe('<em><q>&quot;hi&quot;</q> there</em>');
    });

    test('emphasis inside a quote', () => {
        expect(formatChoiceHtml('"*hi* there"')).toBe('<q>&quot;<em>hi</em> there&quot;</q>');
    });

    test('underline inside strong', () => {
        expect(formatChoiceHtml('**a __b__ c**')).toBe('<strong>a <u>b</u> c</strong>');
    });

    test('triple asterisks give strong around em', () => {
        expect(formatChoiceHtml('***both***')).toBe('<strong><em>both</em></strong>');
    });

    test('spans do not cross line breaks', () => {
        expect(formatChoiceHtml('*one\ntwo*')).toBe('*one<br>two*');
    });

    test('lone or space-padded markers are left alone', () => {
        expect(formatChoiceHtml('2 * 3 * 4')).toBe('2 * 3 * 4');
        expect(formatChoiceHtml('a * b')).toBe('a * b');
        expect(formatChoiceHtml('a __ b')).toBe('a __ b');
    });

    test('an unclosed quote is just escaped', () => {
        expect(formatChoiceHtml('he said "oops')).toBe('he said &quot;oops');
    });
});

describe('formatChoiceHtml: output only ever contains the allowed tags', () => {
    const ALPHABET = ['<', '>', '&', '"', "'", '*', '_', '“', '”', '\n', ' ', 'a', 'b', '/', '=', 'x'];
    const ALLOWED = /<\/?(?:q|em|strong|u)>|<br>/g;

    test('random inputs never leak a raw "<" or ">"', () => {
        // Small deterministic LCG so a failure is reproducible.
        let seed = 12345;
        const next = () => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return seed;
        };
        for (let i = 0; i < 2000; i++) {
            const length = next() % 24;
            let input = '';
            for (let j = 0; j < length; j++) input += ALPHABET[next() % ALPHABET.length];
            const html = formatChoiceHtml(input);
            const withoutAllowed = html.replace(ALLOWED, '');
            expect(withoutAllowed.includes('<') || withoutAllowed.includes('>')).toBe(false);
        }
    });
});
