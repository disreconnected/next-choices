import { afterEach, describe, expect, test } from 'bun:test';
import zhTW from '../i18n/zh-tw.json';
import { getLocale, setLocale, tr, translate } from '../src/lumiverse/i18n';

afterEach(() => setLocale('en'));

describe('tr', () => {
    test('returns the English text for en and for locales without a table', () => {
        for (const locale of ['en', 'zh', 'ja', 'fr', 'it']) {
            setLocale(locale);
            expect(tr('Regenerate')).toBe('Regenerate');
        }
    });

    test('translates through the shared zh-TW table', () => {
        setLocale('zh-TW');
        expect(getLocale()).toBe('zh-TW');
        expect(tr('Regenerate')).toBe('重新生成');
        expect(tr('Stop generating')).toBe('停止生成');
    });

    test('every key of the shared table resolves to its translation', () => {
        for (const [key, value] of Object.entries(zhTW)) expect(translate('zh-TW', key)).toBe(value);
    });

    test('falls back to the English text for an unknown key', () => {
        setLocale('zh-TW');
        expect(tr('Some brand new string')).toBe('Some brand new string');
    });

    test('substitutes {placeholders} after translating', () => {
        expect(tr('{count} selected', { count: 3 })).toBe('3 selected');
        setLocale('zh-TW');
        expect(tr('{count} selected', { count: 3 })).toBe('已選擇 3 個選項');
        expect(tr('Select choice {number} to combine', { number: 2 })).toBe('選擇要合併的第 2 個選項');
        expect(tr('e.g. have {name} reassure her', { name: 'Ann' })).toBe('例如：讓 Ann 安慰她');
    });

    test('substitutes every occurrence and leaves unknown placeholders alone', () => {
        expect(translate('en', '{a} and {a} and {b}', { a: 'x' })).toBe('x and x and {b}');
    });

    test('setLocale tolerates empty values', () => {
        setLocale(null);
        expect(getLocale()).toBe('en');
        setLocale('');
        expect(getLocale()).toBe('en');
    });

    test('the Lumiverse-only strings are translated for zh-TW', () => {
        setLocale('zh-TW');
        expect(tr('Send failed: chat is busy')).not.toBe('Send failed: chat is busy');
    });
});
