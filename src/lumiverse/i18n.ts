import zhTW from '../../i18n/zh-tw.json';

const LUMIVERSE_ZH_TW: Readonly<Record<string, string>> = {
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

let currentLocale = 'en';

export function setLocale(locale: string | null | undefined): void {
    currentLocale = locale || 'en';
}

export function getLocale(): string {
    return currentLocale;
}

export function translate(locale: string, key: string, vars?: Readonly<Record<string, string | number>>): string {
    const text = TABLES[locale]?.[key] ?? key;
    if (!vars) return text;
    let result = text;
    for (const [name, value] of Object.entries(vars)) result = result.replaceAll(`{${name}}`, String(value));
    return result;
}

export function tr(key: string, vars?: Readonly<Record<string, string | number>>): string {
    return translate(currentLocale, key, vars);
}
