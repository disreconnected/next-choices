/**
 * UI strings. The English text is the key (same convention as the
 * SillyTavern build); zh-TW comes from the shared i18n/zh-tw.json table plus
 * a small table for strings that only exist in the Lumiverse build. A missing
 * key falls back to the English text, so an untranslated string is never blank.
 */
import zhTW from '../../i18n/zh-tw.json';

export type Locale = 'en' | 'zh' | 'zh-TW' | 'ja' | 'fr' | 'it';

const LUMIVERSE_ZH_TW: Readonly<Record<string, string>> = {
    'Next Choices': 'Next Choices',
    'Choices': '選項',
    'Next Choices settings': 'Next Choices 設定',
    'Auto-generate (create choices after each AI reply. You can always trigger manually from the input bar menu)':
        '自動生成（AI 回覆後自動產生選項；也可隨時從輸入列選單手動生成）',
    'Send failed: chat is busy': '送出失敗：聊天正忙碌中',
    'Send failed: ': '送出失敗：',
    'The message composer is not available.': '訊息輸入框目前無法使用。',
    ' (your persona description). Other Lumiverse macros are also supported. ':
        '（你的玩家角色描述）。也支援其他 Lumiverse 內建巨集。',
    'Could not load the connection list.': '無法載入連線清單。',
    'The Next Choices backend did not respond': 'Next Choices 後端沒有回應',
    'Aborted': '已中止',
};

const TABLES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    'zh-TW': { ...(zhTW as Record<string, string>), ...LUMIVERSE_ZH_TW },
};

let currentLocale: Locale = 'en';

export function setLocale(locale: string | null | undefined): void {
    currentLocale = (locale || 'en') as Locale;
}

export function getLocale(): Locale {
    return currentLocale;
}

/** Looks up `key` for `locale` (English text when there is no table or no entry). */
export function translate(locale: string, key: string, vars?: Readonly<Record<string, string | number>>): string {
    const text = TABLES[locale]?.[key] ?? key;
    if (!vars) return text;
    let result = text;
    for (const [name, value] of Object.entries(vars)) result = result.replaceAll(`{${name}}`, String(value));
    return result;
}

/** Translates `key` for the current locale and substitutes `{name}` placeholders from `vars`. */
export function tr(key: string, vars?: Readonly<Record<string, string | number>>): string {
    return translate(currentLocale, key, vars);
}
