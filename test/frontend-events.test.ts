import { describe, expect, test } from 'bun:test';
import { chatIdFromChatChanged, createEventFilter, DEDUPE_WINDOW_MS } from '../src/lumiverse/ui/event-filter';

function make(activeChatId: string | null = 'chat1') {
    let time = 1_000_000;
    const state = { activeChatId };
    const filter = createEventFilter({ getActiveChatId: () => state.activeChatId, now: () => time });
    return {
        filter,
        state,
        advance: (ms: number) => void (time += ms),
    };
}

const ended = (extra: Record<string, unknown> = {}) => ({
    generationId: 'g1',
    chatId: 'chat1',
    messageId: 'm1',
    content: 'hello',
    generationType: 'normal',
    ...extra,
});

describe('onGenerationEnded', () => {
    test('a finished reply in the active chat triggers auto-generation', () => {
        expect(make().filter.onGenerationEnded(ended())).toBe('generate');
    });

    test.each([
        ['error', { error: 'boom' }],
        ['impersonate', { generationType: 'impersonate' }],
        ['another chat', { chatId: 'chat2' }],
        ['no saved message', { messageId: undefined }],
        ['no chat id', { chatId: undefined }],
    ])('ignores %s', (_name, extra) => {
        expect(make().filter.onGenerationEnded(ended(extra))).toBe('ignore');
    });

    test('ignores everything when no chat is open or the payload is not an object', () => {
        expect(make(null).filter.onGenerationEnded(ended())).toBe('ignore');
        for (const bad of [null, undefined, 'x', 3, []]) expect(make().filter.onGenerationEnded(bad)).toBe('ignore');
    });

    test('dedupes by message within the window, then allows it again', () => {
        const { filter, advance } = make();
        expect(filter.onGenerationEnded(ended())).toBe('generate');
        advance(500);
        expect(filter.onGenerationEnded(ended({ generationId: 'g2' }))).toBe('ignore');
        advance(DEDUPE_WINDOW_MS);
        expect(filter.onGenerationEnded(ended({ generationId: 'g3' }))).toBe('generate');
    });

    test('dedupes by generation id when the message id differs', () => {
        const { filter, advance } = make();
        expect(filter.onGenerationEnded(ended())).toBe('generate');
        advance(100);
        expect(filter.onGenerationEnded(ended({ messageId: 'm2' }))).toBe('ignore');
    });

    test('a swipe id in the payload separates regenerations of the same message', () => {
        const { filter, advance } = make();
        expect(filter.onGenerationEnded(ended({ swipeId: 0, generationId: 'a' }))).toBe('generate');
        advance(100);
        expect(filter.onGenerationEnded(ended({ swipeId: 1, generationId: 'b' }))).toBe('generate');
    });
});

describe('extension generations (own and foreign)', () => {
    test('GENERATION_STARTED from an extension is ignored and its end never triggers choices', () => {
        const { filter } = make();
        expect(filter.onGenerationStarted({ generationId: 'ext1', chatId: 'chat1', extensionId: 'next_choices' })).toBe('ignore');
        expect(filter.onGenerationEnded(ended({ generationId: 'ext1' }))).toBe('ignore');
        expect(filter.onGenerationEnded(ended({ generationId: 'g9', messageId: 'm9' }))).toBe('generate');
    });

    test('a foreign extension generation is treated the same way', () => {
        const { filter } = make();
        expect(filter.onGenerationStarted({ generationId: 'ext2', chatId: 'chat1', extensionId: 'lumi_summaryception' })).toBe('ignore');
        expect(filter.onGenerationEnded(ended({ generationId: 'ext2' }))).toBe('ignore');
    });
});

describe('onGenerationStarted', () => {
    test('a chat generation in the active chat resets the turn', () => {
        expect(make().filter.onGenerationStarted({ generationId: 'g', chatId: 'chat1', model: 'm' })).toBe('reset');
    });

    test('a generation in another chat does not', () => {
        expect(make().filter.onGenerationStarted({ generationId: 'g', chatId: 'chat2' })).toBe('ignore');
    });

    test('a payload without a chat id resets (cannot tell)', () => {
        expect(make().filter.onGenerationStarted({ generationId: 'g' })).toBe('reset');
        expect(make().filter.onGenerationStarted(undefined)).toBe('reset');
    });
});

describe('onMessageSwiped', () => {
    const swiped = (action: string, extra: Record<string, unknown> = {}) => ({
        chatId: 'chat1',
        message: { id: 'm1' },
        action,
        swipeId: 1,
        ...extra,
    });

    test('navigating swipes clears and re-arms auto-generation', () => {
        expect(make().filter.onMessageSwiped(swiped('navigated'))).toBe('clear-and-rearm');
    });

    test.each(['updated', 'deleted', 'added'])('%s clears', (action) => {
        expect(make().filter.onMessageSwiped(swiped(action))).toBe('clear');
    });

    test('an added swipe right after the generation ended is its echo and is ignored', () => {
        const { filter, advance } = make();
        expect(filter.onGenerationEnded(ended())).toBe('generate');
        advance(50);
        expect(filter.onMessageSwiped(swiped('added'))).toBe('ignore');
        advance(DEDUPE_WINDOW_MS + 1);
        expect(filter.onMessageSwiped(swiped('added'))).toBe('clear');
    });

    test('an added swipe BEFORE the generation ended clears, and the end still triggers', () => {
        const { filter } = make();
        expect(filter.onMessageSwiped(swiped('added'))).toBe('clear');
        expect(filter.onGenerationEnded(ended())).toBe('generate');
    });

    test('an added swipe for a different message than the one that ended clears', () => {
        const { filter } = make();
        filter.onGenerationEnded(ended());
        expect(filter.onMessageSwiped(swiped('added', { message: { id: 'other' } }))).toBe('clear');
    });

    test('swipes in another chat are ignored; a missing payload clears', () => {
        const { filter } = make();
        expect(filter.onMessageSwiped(swiped('navigated', { chatId: 'chat2' }))).toBe('ignore');
        expect(filter.onMessageSwiped(undefined)).toBe('clear');
    });
});

describe('onMessageMutated', () => {
    test('clears for the active chat or an unknown chat, ignores another chat', () => {
        const { filter } = make();
        expect(filter.onMessageMutated({ chatId: 'chat1' })).toBe('clear');
        expect(filter.onMessageMutated({})).toBe('clear');
        expect(filter.onMessageMutated(undefined)).toBe('clear');
        expect(filter.onMessageMutated({ chatId: 'chat2' })).toBe('ignore');
    });
});

describe('chatIdFromChatChanged', () => {
    test('reads both payload shapes', () => {
        expect(chatIdFromChatChanged({ chatId: 'c1' })).toBe('c1');
        expect(chatIdFromChatChanged({ chat: { id: 'c2', name: 'x' } })).toBe('c2');
        expect(chatIdFromChatChanged({ chatId: 'c1', chat: { id: 'c2' } })).toBe('c1');
    });

    test('returns null when there is no id', () => {
        for (const bad of [null, undefined, 'x', {}, { chat: {} }, { chatId: '' }, { chat: { id: 5 } }]) {
            expect(chatIdFromChatChanged(bad)).toBeNull();
        }
    });
});
