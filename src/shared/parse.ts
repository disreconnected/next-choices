/**
 * Extracts up to `max` choice strings from the raw model output.
 * 1) Try JSON array between the first '[' and the last ']'.
 * 2) Fallback: numbered / bulleted list lines.
 * Returns [] if nothing usable was found.
 */
export function parseChoices(text: unknown, max: number): string[] {
    if (typeof text !== 'string' || !text.trim()) return [];

    // Attempt 1: JSON array.
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
        } catch { /* fall through */ }
    }

    // Attempt 2: numbered / bulleted list.
    const items: string[] = [];
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        const match = line.match(/^(?:\d+\s*[.)、]\s*|[-*•]\s+)(.+)$/);
        if (match) {
            let item = match[1]!.trim();
            // Strip wrapping quotes and trailing comma left over from JSON-ish output.
            item = item.replace(/^["'「『]|["'」』,]+$/g, '').trim();
            if (item) items.push(item);
        }
    }
    return items.slice(0, max);
}

/**
 * Extracts exactly `expectedCount` rewritten choice strings from the raw
 * model output. Unlike parseChoices this is atomic: anything other than
 * a JSON array of exactly `expectedCount` nonempty strings rejects the
 * whole response (returns null). No filtering, truncation, object
 * aliases, or numbered-line fallback: those could silently commit an
 * incomplete or incorrectly mapped rewrite.
 */
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
