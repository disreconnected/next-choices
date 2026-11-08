/**
 * Decides what a Lumiverse event means for the choices UI. Pure (no DOM, no
 * host calls) so the rules can be unit tested. Payloads come from the host as
 * `unknown`; every field is read defensively because the published types and
 * the documentation disagree in places (CHAT_CHANGED) and the events differ by
 * host version.
 */

/** Same event ignored if it was already handled this recently. */
export const DEDUPE_WINDOW_MS = 2000;
/** Wait after the last trigger before an automatic generation starts. */
export const AUTO_GENERATE_DEBOUNCE_MS = 300;

const MAX_REMEMBERED_GENERATIONS = 64;

export interface EventFilterDeps {
    /** Active chat id, or null when no chat is open. */
    getActiveChatId(): string | null;
    now?(): number;
}

export type StartedVerdict = 'reset' | 'ignore';
export type EndedVerdict = 'generate' | 'ignore';
export type SwipeVerdict = 'ignore' | 'clear' | 'clear-and-rearm';

export interface EventFilter {
    /**
     * GENERATION_STARTED. Generations started by an extension (this one's own
     * out-of-chat requests, a summarizer, ...) must not wipe the choices, and
     * their GENERATION_ENDED must not trigger new ones, so their ids are
     * remembered. Only a chat generation in the active chat resets the turn.
     */
    onGenerationStarted(payload: unknown): StartedVerdict;
    /** GENERATION_ENDED: should the auto-generate timer be armed? */
    onGenerationEnded(payload: unknown): EndedVerdict;
    /**
     * MESSAGE_SWIPED. A regenerate emits `added` next to GENERATION_ENDED, in
     * either order: an `added` for a message whose generation just ended is the
     * echo of it and must neither clear the choices nor cancel the pending
     * auto-generation.
     */
    onMessageSwiped(payload: unknown): SwipeVerdict;
    /** MESSAGE_EDITED / MESSAGE_DELETED: ignore when they concern another chat. */
    onMessageMutated(payload: unknown): 'clear' | 'ignore';
}

export function createEventFilter(deps: EventFilterDeps): EventFilter {
    const now = deps.now ?? Date.now;
    const extensionGenerations = new Set<string>();
    const handledEnds = new Map<string, number>();
    const endedMessages = new Map<string, number>();

    function remember(map: Map<string, number>, key: string, at: number): void {
        map.set(key, at);
        if (map.size > 256) {
            for (const [oldKey, oldAt] of map) {
                if (at - oldAt > DEDUPE_WINDOW_MS) map.delete(oldKey);
            }
        }
    }

    function seenRecently(map: Map<string, number>, key: string, at: number): boolean {
        const seen = map.get(key);
        return seen !== undefined && at - seen <= DEDUPE_WINDOW_MS;
    }

    /** True when the payload names a chat other than the active one. */
    function isOtherChat(payload: Record<string, unknown>): boolean {
        const chatId = asString(payload.chatId);
        const active = deps.getActiveChatId();
        return chatId !== null && active !== null && chatId !== active;
    }

    return {
        onGenerationStarted(payload) {
            const record = asRecord(payload);
            if (!record) return 'reset';
            const generationId = asString(record.generationId);
            if (asString(record.extensionId)) {
                if (generationId) {
                    extensionGenerations.add(generationId);
                    if (extensionGenerations.size > MAX_REMEMBERED_GENERATIONS) {
                        extensionGenerations.delete(extensionGenerations.values().next().value as string);
                    }
                }
                return 'ignore';
            }
            return isOtherChat(record) ? 'ignore' : 'reset';
        },

        onGenerationEnded(payload) {
            const record = asRecord(payload);
            if (!record || record.error) return 'ignore';
            if (asString(record.generationType) === 'impersonate') return 'ignore';
            const generationId = asString(record.generationId);
            if (generationId && extensionGenerations.has(generationId)) return 'ignore';
            if (asString(record.extensionId)) return 'ignore';

            // Only a generation that saved a message in the chat that is open now.
            const messageId = asString(record.messageId);
            const chatId = asString(record.chatId);
            const active = deps.getActiveChatId();
            if (!messageId || !chatId || !active || chatId !== active) return 'ignore';

            const at = now();
            const swipeId = record.swipeId ?? record.swipe_id;
            const messageKey = `${messageId}:${swipeId === undefined || swipeId === null ? '' : String(swipeId)}`;
            const generationKey = generationId ? `gen:${generationId}` : null;
            const duplicate =
                seenRecently(handledEnds, messageKey, at) || (generationKey !== null && seenRecently(handledEnds, generationKey, at));
            remember(endedMessages, messageId, at);
            if (duplicate) return 'ignore';
            remember(handledEnds, messageKey, at);
            if (generationKey) remember(handledEnds, generationKey, at);
            return 'generate';
        },

        onMessageSwiped(payload) {
            const record = asRecord(payload);
            if (!record) return 'clear';
            if (isOtherChat(record)) return 'ignore';
            const action = asString(record.action);
            if (action === 'navigated') return 'clear-and-rearm';
            if (action === 'added') {
                const messageId = asString(asRecord(record.message)?.id);
                if (messageId && seenRecently(endedMessages, messageId, now())) return 'ignore';
            }
            return 'clear';
        },

        onMessageMutated(payload) {
            const record = asRecord(payload);
            if (record && isOtherChat(record)) return 'ignore';
            return 'clear';
        },
    };
}

/**
 * Chat id carried by a CHAT_CHANGED payload: `{ chatId }` (documented) or
 * `{ chat: { id } }` (typed). Null when the payload has neither.
 */
export function chatIdFromChatChanged(payload: unknown): string | null {
    const record = asRecord(payload);
    if (!record) return null;
    return asString(record.chatId) ?? asString(asRecord(record.chat)?.id);
}

/**
 * The backend forwards a slash-command style trigger to every open tab of the
 * user. Only the tab the player is looking at acts on it, otherwise one command
 * would start one generation per tab. A host without the Page Visibility API
 * reports nothing (undefined), which counts as foreground.
 */
export function isForegroundTab(visibilityState: string | null | undefined): boolean {
    return visibilityState === undefined || visibilityState === null || visibilityState === 'visible';
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value : null;
}
