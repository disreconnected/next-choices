import { describe, expect, test } from 'bun:test';
import type { GenerationRequestDTO, SpindleCommandDTO, SpindleCommandOriginDTO } from 'lumiverse-spindle-types';
import { initBackend } from '../src/lumiverse/backend';
import type { BackendApi } from '../src/lumiverse/backend';
import type { BackendMessage } from '../src/lumiverse/rpc';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/settings';
import { LEGACY_DEFAULT_PROMPT_TEMPLATE } from '../src/shared/templates';

// ---------------------------------------------------------------------------
// Fake `spindle`: captures every call and lets a test script the host's answers
// ---------------------------------------------------------------------------

type Sent = { payload: BackendMessage; userId: string | undefined; options: { frontendSessionId?: string } | undefined };
type HostMessage = Record<string, unknown>;

const abortError = (): Error => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });

function makeFake() {
    const sent: Sent[] = [];
    const order: string[] = [];
    const logs: string[] = [];
    const generateCalls: { kind: 'raw' | 'quiet'; input: GenerationRequestDTO }[] = [];
    const calls = {
        getJson: [] as [string, { fallback?: unknown } | undefined][],
        setJson: [] as [string, unknown][],
        getMessages: [] as unknown[][],
        macros: [] as unknown[][],
        register: [] as SpindleCommandDTO[][],
        unregister: [] as (string[] | undefined)[],
    };
    // Scriptable host behaviour; tests reassign what they need.
    const host = {
        stored: undefined as unknown,
        getJsonError: undefined as Error | undefined,
        setJsonError: undefined as Error | undefined,
        messages: [] as HostMessage[],
        getMessages: undefined as ((chatId: string, options?: unknown) => unknown[]) | undefined,
        persona: null as { name?: string; description?: string } | null | Error,
        macros: undefined as ((template: string) => string) | undefined,
        generate: undefined as ((kind: 'raw' | 'quiet', input: GenerationRequestDTO) => Promise<unknown>) | undefined,
    };

    let messageHandler: ((payload: unknown, userId: string, sid?: string) => void | Promise<void>) | null = null;
    let commandHandler:
        | ((id: string, context: { route: string }, origin?: SpindleCommandOriginDTO) => void | Promise<void>)
        | null = null;

    const generate = (kind: 'raw' | 'quiet') => (input: GenerationRequestDTO) => {
        generateCalls.push({ kind, input });
        return host.generate ? host.generate(kind, input) : Promise.resolve('ok');
    };

    const api: BackendApi = {
        onFrontendMessage(handler) {
            order.push('onFrontendMessage');
            messageHandler = handler;
            return () => {
                messageHandler = null;
            };
        },
        sendToFrontend(payload, userId, options) {
            order.push(`send:${(payload as BackendMessage).type}`);
            sent.push({ payload: payload as BackendMessage, userId, options });
        },
        userStorage: {
            async getJson(path, options) {
                calls.getJson.push([path, options]);
                if (host.getJsonError) throw host.getJsonError;
                return host.stored === undefined ? options?.fallback : host.stored;
            },
            async setJson(path, value) {
                calls.setJson.push([path, value]);
                if (host.setJsonError) throw host.setJsonError;
            },
        },
        chat: {
            async getMessages(...args) {
                calls.getMessages.push(args);
                const [chatId, options] = args;
                return host.getMessages ? host.getMessages(chatId, options) : host.messages;
            },
        },
        personas: {
            async getActive() {
                if (host.persona instanceof Error) throw host.persona;
                return host.persona;
            },
        },
        macros: {
            async resolve(template, options) {
                calls.macros.push([template, options]);
                if (!host.macros) throw new Error('macro engine down');
                return { text: host.macros(template) };
            },
        },
        generate: { raw: generate('raw'), quiet: generate('quiet') },
        log: {
            info: (m) => void logs.push(`info ${m}`),
            warn: (m) => void logs.push(`warn ${m}`),
            error: (m) => void logs.push(`error ${m}`),
        },
        commands: {
            register(commands) {
                calls.register.push(commands);
            },
            unregister(ids) {
                calls.unregister.push(ids);
            },
            onInvoked(handler) {
                commandHandler = handler as typeof commandHandler;
                return () => {
                    commandHandler = null;
                };
            },
        },
    };

    return {
        api,
        sent,
        order,
        logs,
        calls,
        generateCalls,
        host,
        /** Delivers a payload as the host would and resolves once the backend has finished handling it. */
        deliver: (payload: unknown, userId = 'u1', sid?: string) => messageHandler!(payload, userId, sid),
        invokeCommand: (id: string, origin?: SpindleCommandOriginDTO) => commandHandler!(id, { route: '/chat/c1' }, origin),
        hasMessageHandler: () => messageHandler !== null,
        hasCommandHandler: () => commandHandler !== null,
        /** Messages sent after the initial hello. */
        replies: () => sent.slice(1).map((s) => s.payload),
    };
}

type Fake = ReturnType<typeof makeFake>;

function start(setup?: (fake: Fake) => void) {
    const fake = makeFake();
    setup?.(fake);
    const stop = initBackend(fake.api);
    return { fake, stop };
}

/** A chat message shaped like `chat.getMessages` output. */
function msg(overrides: HostMessage): HostMessage {
    return { role: 'assistant', is_user: false, name: 'Bot', content: 'text', hidden: false, extra: {}, ...overrides };
}

// ---------------------------------------------------------------------------

describe('startup', () => {
    test('registers the handler, then broadcasts hello with no user target', () => {
        const { fake } = start();
        expect(fake.order.slice(0, 2)).toEqual(['onFrontendMessage', 'send:hello']);
        expect(fake.sent[0]).toEqual({ payload: { type: 'hello' }, userId: undefined, options: undefined });
        expect(fake.sent).toHaveLength(1);
    });

    test('registers the two palette commands', () => {
        const { fake } = start();
        expect(fake.calls.register).toHaveLength(1);
        const [commands] = fake.calls.register;
        expect(commands!.map((c) => c.id)).toEqual(['generate', 'guided']);
        expect(commands!.map((c) => c.label)).toEqual([
            'Next Choices: Generate choices',
            'Next Choices: Generate choices (guided)',
        ]);
        for (const command of commands!) {
            expect(command.scope).toBe('chat-idle');
            expect(command.description.length).toBeGreaterThan(0);
            expect(command.label.length).toBeLessThanOrEqual(80);
            expect(command.description.length).toBeLessThanOrEqual(200);
        }
    });

    test('the teardown unsubscribes, unregisters commands and aborts in-flight generations', async () => {
        const { fake, stop } = start((f) => {
            f.host.generate = (_kind, input) =>
                new Promise((_resolve, reject) => input.signal!.addEventListener('abort', () => reject(abortError())));
        });
        const running = fake.deliver({ type: 'generate', requestId: 'g1', prompt: 'p', connectionId: null, maxTokens: 10 });
        stop();
        await running;
        expect(fake.hasMessageHandler()).toBe(false);
        expect(fake.hasCommandHandler()).toBe(false);
        expect(fake.calls.unregister).toEqual([undefined]);
        expect(fake.replies()).toEqual([{ type: 'error', requestId: 'g1', message: 'The operation was aborted', aborted: true }]);
    });
});

describe('invalid payloads', () => {
    test('are ignored without touching the host or replying', async () => {
        const { fake } = start();
        const bad: unknown[] = [
            null,
            undefined,
            'load_settings',
            42,
            [],
            {},
            { type: 'load_settings' },
            { type: 'nope', requestId: 'r' },
            { type: 'generate', requestId: 'r', prompt: 'p' },
            { type: 'hello' },
        ];
        for (const payload of bad) await fake.deliver(payload);
        expect(fake.sent).toHaveLength(1); // only the hello
        expect(fake.calls.getJson).toHaveLength(0);
        expect(fake.generateCalls).toHaveLength(0);
        expect(fake.logs).toHaveLength(bad.length);
        expect(fake.logs[0]).toMatch(/ignored an invalid frontend payload/);
    });

    test('fall back to console when the host has no log API', async () => {
        const fake = makeFake();
        const { log: _log, ...noLog } = fake.api;
        const seen: string[] = [];
        const original = console.info;
        console.info = (...args: unknown[]) => void seen.push(args.join(' '));
        try {
            initBackend(noLog);
            await fake.deliver({ type: 'nope', requestId: 'r' });
        } finally {
            console.info = original;
        }
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatch(/ignored an invalid frontend payload/);
    });
});

describe('reply routing', () => {
    test('every reply carries the sender userId and, when present, its frontendSessionId', async () => {
        const { fake } = start();
        await fake.deliver({ type: 'load_settings', requestId: 'a' }, 'user-7', 'session-3');
        await fake.deliver({ type: 'load_settings', requestId: 'b' }, 'user-7');
        expect(fake.sent[1]).toMatchObject({ userId: 'user-7', options: { frontendSessionId: 'session-3' } });
        expect(fake.sent[2]).toMatchObject({ userId: 'user-7', options: undefined });
    });
});

describe('settings', () => {
    test('load_settings reads settings.json with the defaults as fallback', async () => {
        const { fake } = start();
        await fake.deliver({ type: 'load_settings', requestId: 'r1' });
        expect(fake.calls.getJson).toEqual([['settings.json', { fallback: DEFAULT_SETTINGS, userId: 'u1' }]]);
        expect(fake.replies()).toEqual([{ type: 'settings', requestId: 'r1', settings: { ...DEFAULT_SETTINGS } }]);
    });

    test('load_settings normalises whatever is stored', async () => {
        const { fake } = start((f) => {
            f.host.stored = {
                enabled: 'yes',
                autoSend: true,
                numChoices: '99',
                maxTokens: -3,
                historyDepth: '6',
                profileId: '',
                promptTemplate: LEGACY_DEFAULT_PROMPT_TEMPLATE,
                junk: 1,
            };
        });
        await fake.deliver({ type: 'load_settings', requestId: 'r1' });
        const [reply] = fake.replies();
        expect(reply).toEqual({
            type: 'settings',
            requestId: 'r1',
            settings: {
                ...DEFAULT_SETTINGS,
                autoSend: true,
                numChoices: 10,
                maxTokens: DEFAULT_SETTINGS.maxTokens,
                historyDepth: 6,
                profileId: 'current',
            },
        });
        expect(reply).not.toHaveProperty('settings.junk');
    });

    test('load_settings still answers with defaults when storage throws', async () => {
        const { fake } = start((f) => {
            f.host.getJsonError = new Error('disk on fire');
        });
        await fake.deliver({ type: 'load_settings', requestId: 'r1' });
        expect(fake.replies()).toEqual([{ type: 'settings', requestId: 'r1', settings: { ...DEFAULT_SETTINGS } }]);
        expect(fake.logs).toEqual(['error [next_choices] could not read settings.json (disk on fire); using defaults']);
    });

    test('save_settings stores the normalised settings and replies with them', async () => {
        const { fake } = start();
        const dirty = { ...DEFAULT_SETTINGS, numChoices: 99, maxTokens: 0, profileId: '', enabled: false, extra: 'x' };
        await fake.deliver({ type: 'save_settings', requestId: 's1', settings: dirty });
        const expected = normalizeSettings(dirty);
        expect(expected).toMatchObject({ numChoices: 10, maxTokens: DEFAULT_SETTINGS.maxTokens, profileId: 'current', enabled: false });
        expect(fake.calls.setJson).toEqual([['settings.json', expected]]);
        expect(fake.replies()).toEqual([{ type: 'settings', requestId: 's1', settings: expected }]);
    });

    test('save_settings reports a storage failure as an error reply', async () => {
        const { fake } = start((f) => {
            f.host.setJsonError = new Error('read-only storage');
        });
        await fake.deliver({ type: 'save_settings', requestId: 's1', settings: { ...DEFAULT_SETTINGS } });
        expect(fake.replies()).toEqual([{ type: 'error', requestId: 's1', message: 'read-only storage', aborted: false }]);
    });
});

describe('get_context', () => {
    const chat = [
        msg({ role: 'system', name: 'System', content: 'sys prompt' }),
        msg({ role: 'user', is_user: true, name: 'Alice', content: 'hi' }),
        msg({ name: 'Bob', content: 'hello' }),
        msg({ name: 'Bob', content: 'secret', hidden: true }),
        msg({ name: 'Bob', content: 'secret too', hidden: false, extra: { hidden: true } }),
        msg({ role: 'user', is_user: true, name: 'Alice', content: 'my move' }),
        msg({ name: 'Bob', content: 'your move' }),
    ];
    const request = { type: 'get_context', requestId: 'c1', chatId: 'chat-1', characterId: 'char-1', historyDepth: 3 };

    test('drops system and hidden messages, keeps the last historyDepth and derives the names', async () => {
        const { fake } = start((f) => {
            f.host.messages = chat;
            f.host.persona = { name: 'Persona Name', description: 'A weary traveller' };
        });
        await fake.deliver(request);
        expect(fake.replies()).toEqual([
            {
                type: 'context',
                requestId: 'c1',
                history: [
                    { name: 'Bob', text: 'hello', isUser: false },
                    { name: 'Alice', text: 'my move', isUser: true },
                    { name: 'Bob', text: 'your move', isUser: false },
                ],
                userName: 'Persona Name',
                charName: 'Bob',
                persona: 'A weary traveller',
                lastIsUser: false,
            },
        ]);
    });

    test('asks the host for a light tail of historyDepth + 10, capped at 1000', async () => {
        const { fake } = start();
        await fake.deliver(request);
        await fake.deliver({ ...request, requestId: 'c2', historyDepth: 4000 });
        expect(fake.calls.getMessages).toEqual([
            ['chat-1', { tail: 13, light: true }],
            ['chat-1', { tail: 1000, light: true }],
        ]);
    });

    test('falls back to the active persona being absent: userName from the last user message, persona empty', async () => {
        const { fake } = start((f) => {
            f.host.messages = chat;
            f.host.persona = new Error('personas permission missing');
        });
        await fake.deliver(request);
        expect(fake.replies()[0]).toMatchObject({ type: 'context', userName: 'Alice', persona: '', charName: 'Bob' });
    });

    test('a persona without a name or description falls back too', async () => {
        const { fake } = start((f) => {
            f.host.messages = chat;
            f.host.persona = { name: '' };
        });
        await fake.deliver(request);
        expect(fake.replies()[0]).toMatchObject({ userName: 'Alice', persona: '' });
    });

    test('an empty chat yields "User", no character name and lastIsUser false', async () => {
        const { fake } = start();
        await fake.deliver(request);
        expect(fake.replies()).toEqual([
            { type: 'context', requestId: 'c1', history: [], userName: 'User', charName: '', persona: '', lastIsUser: false },
        ]);
    });

    test('lastIsUser reflects the last visible message', async () => {
        const { fake } = start((f) => {
            f.host.messages = [msg({ name: 'Bob' }), msg({ role: 'user', is_user: true, name: 'Alice' }), msg({ role: 'system' })];
        });
        await fake.deliver(request);
        expect(fake.replies()[0]).toMatchObject({ lastIsUser: true });
    });

    test('derives isUser from the role when is_user is missing', async () => {
        const { fake } = start((f) => {
            f.host.messages = [
                { role: 'assistant', name: 'Bob', content: 'a' },
                { role: 'user', name: 'Alice', content: 'b' },
            ];
        });
        await fake.deliver(request);
        expect(fake.replies()[0]).toMatchObject({
            history: [
                { name: 'Bob', text: 'a', isUser: false },
                { name: 'Alice', text: 'b', isUser: true },
            ],
            lastIsUser: true,
        });
    });

    test('retries without options when the host rejects them, then slices to the tail', async () => {
        const big = Array.from({ length: 30 }, (_, i) => msg({ name: 'Bob', content: `m${i}` }));
        const { fake } = start((f) => {
            f.host.getMessages = (_chatId, options) => {
                if (options !== undefined) throw new Error('unknown option: light');
                return big;
            };
        });
        await fake.deliver({ ...request, historyDepth: 2 });
        expect(fake.calls.getMessages).toEqual([['chat-1', { tail: 12, light: true }], ['chat-1']]);
        expect(fake.replies()[0]).toMatchObject({
            history: [
                { name: 'Bob', text: 'm28', isUser: false },
                { name: 'Bob', text: 'm29', isUser: false },
            ],
        });
    });

    test('replies with an error when the history cannot be read at all', async () => {
        const { fake } = start((f) => {
            f.host.getMessages = () => {
                throw new Error('chat_mutation not granted');
            };
        });
        await fake.deliver(request);
        expect(fake.replies()).toEqual([
            { type: 'error', requestId: 'c1', message: 'chat_mutation not granted', aborted: false },
        ]);
    });
});

describe('resolve_macros', () => {
    test('resolves through the host without committing and maps a null characterId to undefined', async () => {
        const { fake } = start((f) => {
            f.host.macros = (template) => template.replace('{{description}}', 'DESC');
        });
        await fake.deliver({ type: 'resolve_macros', requestId: 'm1', template: 'a {{description}}', chatId: 'chat-1', characterId: null });
        await fake.deliver({ type: 'resolve_macros', requestId: 'm2', template: 'b', chatId: 'chat-1', characterId: 'char-1' });
        expect(fake.calls.macros).toEqual([
            ['a {{description}}', { chatId: 'chat-1', characterId: undefined, commit: false, userId: 'u1' }],
            ['b', { chatId: 'chat-1', characterId: 'char-1', commit: false, userId: 'u1' }],
        ]);
        expect(fake.replies()).toEqual([
            { type: 'macros', requestId: 'm1', text: 'a DESC' },
            { type: 'macros', requestId: 'm2', text: 'b' },
        ]);
    });

    test('falls back to the unexpanded template when the macro engine fails', async () => {
        const { fake } = start(); // host.macros unset: resolve() throws
        await fake.deliver({ type: 'resolve_macros', requestId: 'm1', template: 'Hi {{user}}', chatId: 'c', characterId: null });
        expect(fake.replies()).toEqual([{ type: 'macros', requestId: 'm1', text: 'Hi {{user}}' }]);
    });
});

describe('generate', () => {
    const request = (overrides: Record<string, unknown> = {}) => ({
        type: 'generate',
        requestId: 'g1',
        prompt: 'Suggest replies',
        connectionId: null,
        maxTokens: 321,
        ...overrides,
    });

    test('"Current connection" (null) uses generate.quiet with the prompt, max_tokens, reasoning off and a signal', async () => {
        const { fake } = start((f) => {
            f.host.generate = async () => 'done';
        });
        await fake.deliver(request());
        expect(fake.generateCalls).toHaveLength(1);
        const [{ kind, input }] = fake.generateCalls;
        expect(kind).toBe('quiet');
        expect(input).toMatchObject({
            type: 'quiet',
            messages: [{ role: 'user', content: 'Suggest replies' }],
            parameters: { max_tokens: 321 },
            reasoning: { source: 'off' },
        });
        expect(input.signal).toBeInstanceOf(AbortSignal);
        expect(input).not.toHaveProperty('connection_id');
    });

    test('a saved profile uses generate.raw with its connection_id', async () => {
        const { fake } = start();
        await fake.deliver(request({ connectionId: 'conn-9' }));
        expect(fake.generateCalls).toHaveLength(1);
        const [{ kind, input }] = fake.generateCalls;
        expect(kind).toBe('raw');
        expect(input).toMatchObject({
            type: 'raw',
            connection_id: 'conn-9',
            messages: [{ role: 'user', content: 'Suggest replies' }],
            parameters: { max_tokens: 321 },
            reasoning: { source: 'off' },
        });
    });

    describe('result normalisation', () => {
        const cases: [string, unknown, string][] = [
            ['a plain string', 'hello', 'hello'],
            ['an empty string', '', ''],
            ['{ content: string }', { content: 'from content', finish_reason: 'stop' }, 'from content'],
            [
                'content parts (only text parts are joined)',
                {
                    content: [
                        { type: 'text', text: 'one ' },
                        { type: 'image', data: 'x', mime_type: 'image/png' },
                        { type: 'text', text: 'two' },
                    ],
                },
                'one two',
            ],
        ];
        for (const [label, result, text] of cases) {
            test(`accepts ${label}`, async () => {
                const { fake } = start((f) => {
                    f.host.generate = async () => result;
                });
                await fake.deliver(request());
                expect(fake.replies()).toEqual([{ type: 'result', requestId: 'g1', text }]);
            });
        }

        for (const [label, result] of [['null', null], ['an object without content', { foo: 1 }], ['a number', 5]] as const) {
            test(`rejects ${label} as an unrecognized response`, async () => {
                const { fake } = start((f) => {
                    f.host.generate = async () => result;
                });
                await fake.deliver(request());
                const [reply] = fake.replies();
                expect(reply).toMatchObject({ type: 'error', requestId: 'g1', aborted: false });
                expect((reply as { message: string }).message).toMatch(/unrecognized/i);
            });
        }
    });

    test('a host failure becomes an error reply that is not marked aborted', async () => {
        const { fake } = start((f) => {
            f.host.generate = async () => {
                throw new Error('provider exploded');
            };
        });
        await fake.deliver(request());
        expect(fake.replies()).toEqual([{ type: 'error', requestId: 'g1', message: 'provider exploded', aborted: false }]);
    });

    test('cancel aborts the matching generation, which replies aborted: true', async () => {
        const { fake } = start((f) => {
            f.host.generate = (_kind, input) =>
                new Promise((_resolve, reject) => input.signal!.addEventListener('abort', () => reject(abortError())));
        });
        const running = fake.deliver(request());
        expect(fake.replies()).toEqual([]);
        await fake.deliver({ type: 'cancel', requestId: 'x1', targetRequestId: 'g1' });
        await running;
        // Cancel itself never replies.
        expect(fake.replies()).toEqual([
            { type: 'error', requestId: 'g1', message: 'The operation was aborted', aborted: true },
        ]);
    });

    test('cancel only aborts its target', async () => {
        const { fake } = start((f) => {
            f.host.generate = (_kind, input) =>
                new Promise((resolve, reject) => {
                    input.signal!.addEventListener('abort', () => reject(abortError()));
                    if (input.messages![0]!.content === 'finish me') setTimeout(() => resolve('finished'), 0);
                });
        });
        const victim = fake.deliver(request({ requestId: 'victim', prompt: 'wait forever' }));
        const survivor = fake.deliver(request({ requestId: 'survivor', prompt: 'finish me' }));
        await fake.deliver({ type: 'cancel', requestId: 'x1', targetRequestId: 'victim' });
        await Promise.all([victim, survivor]);
        expect(fake.replies()).toContainEqual({ type: 'error', requestId: 'victim', message: 'The operation was aborted', aborted: true });
        expect(fake.replies()).toContainEqual({ type: 'result', requestId: 'survivor', text: 'finished' });
    });

    test('cancel for an unknown or finished request is a silent no-op', async () => {
        const { fake } = start();
        await fake.deliver(request());
        const before = fake.sent.length;
        await fake.deliver({ type: 'cancel', requestId: 'x1', targetRequestId: 'g1' }); // already finished
        await fake.deliver({ type: 'cancel', requestId: 'x2', targetRequestId: 'never-existed' });
        expect(fake.sent).toHaveLength(before);
    });

    test('a request id can be reused once the earlier generation has finished', async () => {
        const { fake } = start();
        await fake.deliver(request());
        await fake.deliver(request());
        expect(fake.replies().map((r) => r.type)).toEqual(['result', 'result']);
    });

    test('an abort reported with a non-AbortError is still marked aborted once cancel was requested', async () => {
        const { fake } = start((f) => {
            f.host.generate = (_kind, input) =>
                new Promise((_resolve, reject) => input.signal!.addEventListener('abort', () => reject(new Error('socket closed'))));
        });
        const running = fake.deliver(request());
        await fake.deliver({ type: 'cancel', requestId: 'x1', targetRequestId: 'g1' });
        await running;
        expect(fake.replies()).toEqual([{ type: 'error', requestId: 'g1', message: 'socket closed', aborted: true }]);
    });

    describe('reasoning override', () => {
        test('an error that mentions reasoning retries once without it, on the same signal', async () => {
            let attempt = 0;
            const { fake } = start((f) => {
                f.host.generate = async () => {
                    attempt += 1;
                    if (attempt === 1) throw new Error('Unknown field: reasoning');
                    return 'second try';
                };
            });
            await fake.deliver(request({ connectionId: 'conn-9' }));
            expect(fake.generateCalls).toHaveLength(2);
            const [first, second] = fake.generateCalls;
            expect(first!.input.reasoning).toEqual({ source: 'off' });
            expect(second!.input).not.toHaveProperty('reasoning');
            expect(second!.kind).toBe('raw');
            expect(second!.input).toMatchObject({ connection_id: 'conn-9', parameters: { max_tokens: 321 } });
            expect(second!.input.signal).toBe(first!.input.signal);
            expect(fake.replies()).toEqual([{ type: 'result', requestId: 'g1', text: 'second try' }]);
        });

        test('retries at most once', async () => {
            const { fake } = start((f) => {
                f.host.generate = async () => {
                    throw new Error('reasoning is not supported');
                };
            });
            await fake.deliver(request());
            expect(fake.generateCalls).toHaveLength(2);
            expect(fake.replies()).toEqual([
                { type: 'error', requestId: 'g1', message: 'reasoning is not supported', aborted: false },
            ]);
        });

        test('unrelated errors are not retried', async () => {
            const { fake } = start((f) => {
                f.host.generate = async () => {
                    throw new Error('rate limited');
                };
            });
            await fake.deliver(request());
            expect(fake.generateCalls).toHaveLength(1);
        });

        test('an AbortError is never retried, even if its message mentions reasoning', async () => {
            const { fake } = start((f) => {
                f.host.generate = async () => {
                    throw Object.assign(new Error('aborted while reasoning'), { name: 'AbortError' });
                };
            });
            await fake.deliver(request());
            expect(fake.generateCalls).toHaveLength(1);
            expect(fake.replies()).toEqual([
                { type: 'error', requestId: 'g1', message: 'aborted while reasoning', aborted: true },
            ]);
        });
    });
});

describe('commands', () => {
    test('an invoked command is forwarded to the invoking user, never to a specific document', async () => {
        const { fake } = start();
        await fake.invokeCommand('guided', { userId: 'user-2', frontendSessionId: 'tab-5' });
        await fake.invokeCommand('generate', { userId: 'user-2' });
        expect(fake.sent[1]).toEqual({ payload: { type: 'command', id: 'guided' }, userId: 'user-2', options: undefined });
        expect(fake.sent[2]).toEqual({ payload: { type: 'command', id: 'generate' }, userId: 'user-2', options: undefined });
    });

    test('hosts that supply no origin get an untargeted message', async () => {
        const { fake } = start();
        await fake.invokeCommand('generate');
        expect(fake.sent[1]).toEqual({ payload: { type: 'command', id: 'generate' }, userId: undefined, options: undefined });
    });
});
