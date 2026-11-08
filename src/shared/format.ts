const ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (char) => ESCAPES[char]!);
}

/**
 * Minimal chat-style formatter for hosts without their own message pipeline
 * (SillyTavern uses its messageFormatting instead). The input is HTML-escaped
 * FIRST, then only these fixed tags are produced:
 *
 *   "quoted" and "quoted" (curly)  ->  <q>...</q>  (the quote characters are kept inside)
 *   ***text***                     ->  <strong><em>
 *   **text**                       ->  <strong>
 *   *text*                         ->  <em>
 *   __text__                       ->  <u>
 *   newline                        ->  <br>
 *
 * Because the quote characters stay inside <q>, a stylesheet should set
 * `q::before, q::after { content: none }` to avoid doubled quotes. Spans never
 * cross a line break, and a marker next to whitespace (e.g. "2 * 3 * 4") is
 * left alone. The result is safe to assign to innerHTML.
 */
export function formatChoiceHtml(text: string): string {
    return escapeHtml(text)
        .replace(/\*\*\*(?=\S)(.+?)(?<=\S)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(?=\S)(.+?)(?<=\S)\*/g, '<em>$1</em>')
        .replace(/__(?=\S)(.+?)(?<=\S)__/g, '<u>$1</u>')
        .replace(/&quot;(.+?)&quot;/g, '<q>&quot;$1&quot;</q>')
        .replace(/“(.+?)”/g, '<q>“$1”</q>')
        .replace(/\r?\n/g, '<br>');
}
