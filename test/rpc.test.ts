import { describe, expect, test } from 'bun:test';
import { isBackendMessage, isFrontendMessage } from '../src/lumiverse/rpc';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

describe('isFrontendMessage', () => {
    const settings = { ...DEFAULT_SETTINGS };
    const valid: unknown[] = [
        { type: 'load_settings', requestId: 'r1' },
        { type: 'save_settings', requestId: 'r2', settings },
        { type: 'get_context', requestId: 'r3', chatId: 'c1', characterId: 'ch1', historyDepth: 4 },
        { type: 'get_context', requestId: 'r3', chatId: 'c1', characterId: null, historyDepth: 4 },
        { type: 'resolve_macros', requestId: 'r4', template: '{{user}}', chatId: 'c1', characterId: null },
        { type: 'generate', requestId: 'r5', prompt: 'p', connectionId: null, maxTokens: 500 },
        { type: 'generate', requestId: 'r5', prompt: 'p', connectionId: 'conn', maxTokens: 500 },
        { type: 'cancel', requestId: 'r6', targetRequestId: 'r5' },
    ];

    test('accepts every well-formed request', () => {
        for (const message of valid) expect(isFrontendMessage(message)).toBe(true);
    });

    test('rejects non-objects, unknown types and a missing requestId', () => {
        for (const message of [null, undefined, 'x', 5, [], {}, { type: 'nope', requestId: 'r' }, { type: 'load_settings' }]) {
            expect(isFrontendMessage(message)).toBe(false);
        }
    });

    test('rejects malformed fields', () => {
        const bad: unknown[] = [
            { type: 'save_settings', requestId: 'r', settings: 'x' },
            { type: 'get_context', requestId: 'r', chatId: 5, characterId: null, historyDepth: 4 },
            { type: 'get_context', requestId: 'r', chatId: 'c', characterId: null, historyDepth: '4' },
            { type: 'get_context', requestId: 'r', chatId: 'c', characterId: undefined, historyDepth: 4 },
            { type: 'resolve_macros', requestId: 'r', template: 1, chatId: 'c', characterId: null },
            { type: 'generate', requestId: 'r', prompt: 'p', connectionId: undefined, maxTokens: 500 },
            { type: 'generate', requestId: 'r', prompt: 'p', connectionId: null, maxTokens: NaN },
            { type: 'cancel', requestId: 'r' },
        ];
        for (const message of bad) expect(isFrontendMessage(message)).toBe(false);
    });

    test('does not accept backend messages', () => {
        expect(isFrontendMessage({ type: 'result', requestId: 'r', text: 't' })).toBe(false);
        expect(isFrontendMessage({ type: 'hello' })).toBe(false);
    });
});

describe('isBackendMessage', () => {
    const valid: unknown[] = [
        { type: 'hello' },
        { type: 'settings', requestId: 'r1', settings: { ...DEFAULT_SETTINGS } },
        {
            type: 'context',
            requestId: 'r2',
            history: [{ name: 'Alice', text: 'hi', isUser: true }],
            userName: 'Alice',
            charName: 'Bob',
            persona: '',
            lastIsUser: true,
        },
        { type: 'context', requestId: 'r2', history: [], userName: 'A', charName: 'B', persona: 'p', lastIsUser: false },
        { type: 'macros', requestId: 'r3', text: 't' },
        { type: 'result', requestId: 'r4', text: 't' },
        { type: 'error', requestId: 'r5', message: 'boom', aborted: false },
        { type: 'command', id: 'generate' },
    ];

    test('accepts every well-formed message', () => {
        for (const message of valid) expect(isBackendMessage(message)).toBe(true);
    });

    test('rejects non-objects, unknown types and a missing requestId', () => {
        for (const message of [null, undefined, 'x', 5, [], {}, { type: 'nope' }, { type: 'result', text: 't' }]) {
            expect(isBackendMessage(message)).toBe(false);
        }
    });

    test('rejects malformed fields', () => {
        const bad: unknown[] = [
            { type: 'settings', requestId: 'r', settings: null },
            { type: 'context', requestId: 'r', history: [{ name: 'A', text: 'x' }], userName: 'A', charName: 'B', persona: '', lastIsUser: true },
            { type: 'context', requestId: 'r', history: 'x', userName: 'A', charName: 'B', persona: '', lastIsUser: true },
            { type: 'context', requestId: 'r', history: [], userName: 'A', charName: 'B', persona: '' },
            { type: 'macros', requestId: 'r' },
            { type: 'result', requestId: 'r', text: 5 },
            { type: 'error', requestId: 'r', message: 'm' },
            { type: 'command' },
        ];
        for (const message of bad) expect(isBackendMessage(message)).toBe(false);
    });

    test('does not accept frontend messages', () => {
        expect(isBackendMessage({ type: 'load_settings', requestId: 'r' })).toBe(false);
        expect(isBackendMessage({ type: 'cancel', requestId: 'r', targetRequestId: 'x' })).toBe(false);
    });
});
