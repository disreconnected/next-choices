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
