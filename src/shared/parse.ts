export function parseChoices(text: unknown, max: number): string[] {
    if (typeof text !== 'string' || !text.trim()) return [];

    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start !== -1 && end > start) {
        try {
            const arr: unknown = JSON.parse(text.slice(start, end + 1));
            if (Array.isArray(arr)) {
                const items = arr
                    .map((item: unknown): string => {
                        if (typeof item === 'string') return item.trim();
                        if (item && typeof item === 'object') {
                            const entry = item as Record<string, unknown>;
                            const v = entry.text ?? entry.option ?? entry.choice ?? entry.content;
                            return typeof v === 'string' ? v.trim() : '';
                        }
                        return '';
                    })
                    .filter(Boolean);
                if (items.length) return items.slice(0, max);
            }
        } catch { }
    }

    const items: string[] = [];
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        const match = line.match(/^(?:\d+\s*[.)、]\s*|[-*•]\s+)(.+)$/);
        if (match) {
            let item = match[1]!.trim();
            item = item.replace(/^["'「『]|["'」』,]+$/g, '').trim();
            if (item) items.push(item);
        }
    }
    return items.slice(0, max);
}

export function parseRewrittenChoices(text: unknown, expectedCount: number): string[] | null {
    if (typeof text !== 'string' || !text.trim()) return null;
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end <= start) return null;
    let arr: unknown;
    try {
        arr = JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
    if (!Array.isArray(arr) || arr.length !== expectedCount) return null;
    const items = arr.map((item: unknown) => (typeof item === 'string' ? item.trim() : null));
    if (items.some((item) => !item)) return null;
    return items as string[];
}
