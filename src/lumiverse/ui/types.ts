export interface RequestHandle {
    readonly signal: AbortSignal;
    isCurrent(): boolean;
}

export type RewriteTask =
    | { kind: 'enhance'; originals: readonly string[]; guidance: string }
    | { kind: 'combine'; selected: readonly string[] };

export class NoConversationError extends Error {
    constructor() {
        super('No conversation is available');
        this.name = 'NoConversationError';
    }
}

export type Translate = (key: string, vars?: Readonly<Record<string, string | number>>) => string;
