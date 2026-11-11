import { describe, expect, jest, test } from 'bun:test';
import { createRpcClient, RpcError, type RpcTransport } from '../src/lumiverse/rpc-client';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

function fakeTransport() {
    const sent: any[] = [];
    let handler: ((payload: unknown) => void) | null = null;
    let unsubscribed = false;
    const transport: RpcTransport = {
        sendToBackend: (payload) => void sent.push(payload),
        onBackendMessage: (h) => {
            handler = h;
            return () => {
                unsubscribed = true;
                handler = null;
            };
        },
    };
    return {
        transport,
        sent,
        reply: (payload: unknown) => handler?.(payload),
        get unsubscribed() {
            return unsubscribed;
        },
    };
}

function counterIds() {
    let n = 0;
    return () => `id${++n}`;
}

describe('request / reply correlation', () => {
    test('getContext resolves with the reply that carries its requestId, ignoring others', async () => {
        const host = fakeTransport();
        const rpc = createRpcClient(host.transport, { newId: counterIds() });
        const promise = rpc.getContext('chat1', null, 4);
        expect(host.sent).toEqual([
            { type: 'get_context', requestId: 'id1', chatId: 'chat1', characterId: null, historyDepth: 4 },
        ]);
        host.reply({ type: 'context', requestId: 'other', history: [], userName: 'X', charName: 'Y', persona: '', lastIsUser: false });
        host.reply({
            type: 'context',
            requestId: 'id1',
            history: [{ name: 'A', text: 'hi', isUser: true }],
            userName: 'A',
            charName: 'B',
            persona: 'p',
            lastIsUser: true,
        });
        expect(await promise).toMatchObject({
            history: [{ name: 'A', text: 'hi', isUser: true }],
            userName: 'A',
            charName: 'B',
            persona: 'p',
            lastIsUser: true,
        });
    });

    test('concurrent requests are resolved independently and out of order', async () => {
        const host = fakeTransport();
        const rpc = createRpcClient(host.transport, { newId: counterIds() });
        const macros = rpc.resolveMacros('{{user}}', 'c', null);
        const context = rpc.getContext('c', 'ch', 2);
        host.reply({ type: 'context', requestId: 'id2', history: [], userName: 'U', charName: 'C', persona: '', lastIsUser: false });
        host.reply({ type: 'macros', requestId: 'id1', text: 'expanded' });
        expect(await macros).toBe('expanded');
        expect((await context).userName).toBe('U');
    });

    test('an error reply rejects with RpcError carrying the message and aborted flag', async () => {
        const host = fakeTransport();
        const rpc = createRpcClient(host.transport, { newId: counterIds() });
        const promise = rpc.generate('p', null, 100);
        host.reply({ type: 'error', requestId: 'id1', message: 'no permission', aborted: false });
        const err = await promise.catch((e) => e);
        expect(err).toBeInstanceOf(RpcError);
        expect(err.message).toBe('no permission');
        expect(err.aborted).toBe(false);
    });

    test('get_context and save_settings reject on an error reply (host call failed)', async () => {
        const host = fakeTransport();
        const rpc = createRpcClient(host.transport, { newId: counterIds() });
        const context = rpc.getContext('c', null, 4);
        const save = rpc.saveSettings({ ...DEFAULT_SETTINGS });
        host.reply({ type: 'error', requestId: 'id1', message: 'chat_mutation not granted', aborted: false });
        host.reply({ type: 'error', requestId: 'id2', message: 'storage failed', aborted: false });
        const first = await context.catch((e) => e);
        const second = await save.catch((e) => e);
        expect(first).toBeInstanceOf(RpcError);
        expect(first.message).toBe('chat_mutation not granted');
        expect(second.message).toBe('storage failed');
        expect(second.aborted).toBe(false);
    });

    test('an unexpected reply type for a request rejects instead of resolving', async () => {
        const host = fakeTransport();
        const rpc = createRpcClient(host.transport, { newId: counterIds() });
        const promise = rpc.resolveMacros('t', 'c', null);
        host.reply({ type: 'result', requestId: 'id1', text: 'oops' });
        await expect(promise).rejects.toBeInstanceOf(RpcError);
    });

    test('malformed payloads and replies to unknown ids are ignored', async () => {
        const host = fakeTransport();
        const rpc = createRpcClient(host.transport, { newId: counterIds() });
        const promise = rpc.resolveMacros('t', 'c', null);
        host.reply('garbage');
        host.reply(null);
        host.reply({ type: 'macros', requestId: 'nope', text: 'x' });
        host.reply({ type: 'macros', requestId: 'id1', text: 'ok' });
        expect(await promise).toBe('ok');
    });

    test('a request that never gets a reply rejects after the timeout', async () => {
        const host = fakeTransport();
        const rpc = createRpcClient(host.transport, { newId: counterIds(), requestTimeoutMs: 15 });
        await expect(rpc.getContext('c', null, 1)).rejects.toThrow('did not respond');
    });

    test('saveSettings sends the settings and resolves with the stored ones', async () => {
        const host = fakeTransport();
        const rpc = createRpcClient(host.transport, { newId: counterIds() });
        const promise = rpc.saveSettings({ ...DEFAULT_SETTINGS, numChoices: 5 });
        expect(host.sent[0]).toMatchObject({ type: 'save_settings', requestId: 'id1' });
        host.reply({ type: 'settings', requestId: 'id1', settings: { ...DEFAULT_SETTINGS, numChoices: 5 } });
        expect((await promise).numChoices).toBe(5);
    });
});

describe('generate and cancellation', () => {
    test('resolves with the result text', async () => {
        const host = fakeTransport();
        const rpc = createRpcClient(host.transport, { newId: counterIds() });
        const promise = rpc.generate('prompt', 'conn1', 321);
        expect(host.sent[0]).toEqual({ type: 'generate', requestId: 'id1', prompt: 'prompt', connectionId: 'conn1', maxTokens: 321 });
        host.reply({ type: 'result', requestId: 'id1', text: '["a","b"]' });
        expect(await promise).toBe('["a","b"]');
    });

    test('aborting rejects at once with aborted=true and sends cancel for the generate request', async () => {
        const host = fakeTransport();
        const rpc = createRpcClient(host.transport, { newId: counterIds() });
        const controller = new AbortController();
        const promise = rpc.generate('prompt', null, 100, controller.signal);
        controller.abort();
        const err = await promise.catch((e) => e);
        expect(err).toBeInstanceOf(RpcError);
        expect(err.aborted).toBe(true);
        expect(host.sent[1]).toEqual({ type: 'cancel', requestId: 'id2', targetRequestId: 'id1' });
    });

    test('a late result or error for an aborted request is ignored', async () => {
        const host = fakeTransport();
        const rpc = createRpcClient(host.transport, { newId: counterIds() });
        const controller = new AbortController();
        const promise = rpc.generate('prompt', null, 100, controller.signal);
        controller.abort();
        await promise.catch(() => {});
        host.reply({ type: 'result', requestId: 'id1', text: 'late' });
        host.reply({ type: 'error', requestId: 'id1', message: 'cancelled', aborted: true });
        expect(host.sent).toHaveLength(2);
    });

    test('an already aborted signal rejects without sending anything', async () => {
        const host = fakeTransport();
        const rpc = createRpcClient(host.transport, { newId: counterIds() });
        const controller = new AbortController();
        controller.abort();
        const err = await rpc.generate('p', null, 1, controller.signal).catch((e) => e);
        expect(err.aborted).toBe(true);
        expect(host.sent).toHaveLength(0);
    });

    test('a backend-reported abort maps to aborted=true', async () => {
        const host = fakeTransport();
        const rpc = createRpcClient(host.transport, { newId: counterIds() });
        const promise = rpc.generate('p', null, 1);
        host.reply({ type: 'error', requestId: 'id1', message: 'aborted', aborted: true });
        expect(((await promise.catch((e) => e)) as RpcError).aborted).toBe(true);
    });

    test('aborting after completion does not send a cancel', async () => {
        const host = fakeTransport();
        const rpc = createRpcClient(host.transport, { newId: counterIds() });
        const controller = new AbortController();
        const promise = rpc.generate('p', null, 1, controller.signal);
        host.reply({ type: 'result', requestId: 'id1', text: 'done' });
        await promise;
        controller.abort();
        expect(host.sent).toHaveLength(1);
    });
});

describe('loadSettings startup handshake', () => {
    test('resolves with the settings reply', async () => {
        const host = fakeTransport();
        const rpc = createRpcClient(host.transport, { newId: counterIds() });
        const promise = rpc.loadSettings();
        expect(host.sent).toEqual([{ type: 'load_settings', requestId: 'id1' }]);
        host.reply({ type: 'settings', requestId: 'id1', settings: { ...DEFAULT_SETTINGS, maxTokens: 123 } });
        expect((await promise)?.maxTokens).toBe(123);
    });

    test('re-sends when the backend says hello', async () => {
        const host = fakeTransport();
        const rpc = createRpcClient(host.transport, { newId: counterIds() });
        const promise = rpc.loadSettings();
        expect(host.sent).toHaveLength(1);
        host.reply({ type: 'hello' });
        expect(host.sent).toEqual([
            { type: 'load_settings', requestId: 'id1' },
            { type: 'load_settings', requestId: 'id1' },
        ]);
        host.reply({ type: 'settings', requestId: 'id1', settings: { ...DEFAULT_SETTINGS } });
        await promise;
        host.reply({ type: 'hello' });
        expect(host.sent).toHaveLength(2);
    });

    test('resolves null when no reply arrives within 10 s, and a late reply is ignored', async () => {
        jest.useFakeTimers();
        try {
            const host = fakeTransport();
            const rpc = createRpcClient(host.transport, { newId: counterIds() });
            const promise = rpc.loadSettings();
            jest.advanceTimersByTime(9_999);
            host.reply({ type: 'hello' });
            expect(host.sent).toHaveLength(2);
            jest.advanceTimersByTime(1);
            expect(await promise).toBeNull();
            expect(() => host.reply({ type: 'settings', requestId: 'id1', settings: { ...DEFAULT_SETTINGS } })).not.toThrow();
            host.reply({ type: 'hello' });
            expect(host.sent).toHaveLength(2);
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('push messages and disposal', () => {
    test('command handlers are invoked and can be removed', () => {
        const host = fakeTransport();
        const rpc = createRpcClient(host.transport, { newId: counterIds() });
        const commands: string[] = [];
        const offCommand = rpc.onCommand((id) => commands.push(id));
        host.reply({ type: 'command', id: 'generate' });
        offCommand();
        host.reply({ type: 'command', id: 'guided' });
        expect(commands).toEqual(['generate']);
    });

    test('a throwing listener does not break the others', () => {
        const host = fakeTransport();
        const rpc = createRpcClient(host.transport, { newId: counterIds() });
        const seen: string[] = [];
        rpc.onCommand(() => {
            throw new Error('boom');
        });
        rpc.onCommand((id) => seen.push(id));
        const original = console.error;
        console.error = () => {};
        try {
            host.reply({ type: 'command', id: 'generate' });
        } finally {
            console.error = original;
        }
        expect(seen).toEqual(['generate']);
    });

    test('dispose unsubscribes, rejects pending requests as aborted and refuses new ones', async () => {
        const host = fakeTransport();
        const rpc = createRpcClient(host.transport, { newId: counterIds() });
        const pendingGenerate = rpc.generate('p', null, 1);
        const pendingSettings = rpc.loadSettings();
        rpc.dispose();
        expect(host.unsubscribed).toBe(true);
        expect(((await pendingGenerate.catch((e) => e)) as RpcError).aborted).toBe(true);
        expect(await pendingSettings).toBeNull();
        await expect(rpc.getContext('c', null, 1)).rejects.toBeInstanceOf(RpcError);
        rpc.dispose();
    });
});
