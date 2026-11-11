export const DEDUPE_WINDOW_MS = 2000;
export const AUTO_GENERATE_DEBOUNCE_MS = 300;

const MAX_REMEMBERED_GENERATIONS = 64;

export interface EventFilterDeps {
    getActiveChatId(): string | null;
    now?(): number;
}

export type StartedVerdict = 'reset' | 'ignore';
export type EndedVerdict = 'generate' | 'ignore';
export type SwipeVerdict = 'ignore' | 'clear' | 'clear-and-rearm';

export interface EventFilter {
    onGenerationStarted(payload: unknown): StartedVerdict;
    onGenerationEnded(payload: unknown): EndedVerdict;
    onMessageSwiped(payload: unknown): SwipeVerdict;
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

export function chatIdFromChatChanged(payload: unknown): string | null {
    const record = asRecord(payload);
    if (!record) return null;
    return asString(record.chatId) ?? asString(asRecord(record.chat)?.id);
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value : null;
}
