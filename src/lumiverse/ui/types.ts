/** Contracts between the choices UI and the controller in ../frontend.ts. */

/** One in-flight request. Anything that supersedes it makes `isCurrent()` false. */
export interface RequestHandle {
    readonly id: number;
    readonly signal: AbortSignal;
    isCurrent(): boolean;
}

/** A rewrite of the choices on screen (the generation of new ones lives in the controller). */
export type RewriteTask =
    | { kind: 'enhance'; originals: readonly string[]; guidance: string }
    | { kind: 'combine'; selected: readonly string[] };

/** Thrown by a rewrite when the chat has no messages to base the prompt on. */
export class NoConversationError extends Error {
    constructor() {
        super('No conversation is available');
        this.name = 'NoConversationError';
    }
}

export type Translate = (key: string, vars?: Readonly<Record<string, string | number>>) => string;
