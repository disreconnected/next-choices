/**
 * Promise-based client for the frontend <-> backend protocol in ./rpc.
 *
 * It only needs `sendToBackend` / `onBackendMessage`, so `createRpcClient(ctx)`
 * works with the Spindle frontend context and tests can pass a fake. Replies
 * are matched to requests by `requestId`; every payload crossing the process
 * boundary is validated with `isBackendMessage` first.
 */
import type { NextChoicesSettings } from '../shared/settings';
import { isBackendMessage, type BackendMessage, type FrontendMessage, type HistoryEntry } from './rpc';

export interface RpcTransport {
    sendToBackend(payload: unknown): void;
    onBackendMessage(handler: (payload: unknown) => void): () => void;
}

/** Rejection type of every request. `aborted` is true for a local abort and for a backend-reported abort. */
export class RpcError extends Error {
    readonly aborted: boolean;

    constructor(message: string, aborted = false) {
        super(message);
        this.name = 'RpcError';
        this.aborted = aborted;
    }
}

export interface ContextReply {
    history: HistoryEntry[];
    userName: string;
    charName: string;
    persona: string;
    lastIsUser: boolean;
}

export interface RpcClientOptions {
    /** Request id factory; defaults to crypto.randomUUID with a counter fallback. */
    newId?: () => string;
    /** Reply timeout for every request except `generate` (which the caller aborts). 0 disables. Default 20 s. */
    requestTimeoutMs?: number;
}

export interface LoadSettingsOptions {
    /** Resend interval while no reply has arrived. Default 500 ms. */
    retryMs?: number;
    /** Give up after this long and resolve null. Default 10 s. */
    maxMs?: number;
}

export interface RpcClient {
    /**
     * Sends `load_settings` immediately, again every `retryMs` and whenever the
     * backend announces itself with `hello`, until a `settings` reply arrives.
     * Resolves null when nothing arrived within `maxMs`.
     */
    loadSettings(options?: LoadSettingsOptions): Promise<NextChoicesSettings | null>;
    saveSettings(settings: NextChoicesSettings): Promise<NextChoicesSettings>;
    getContext(chatId: string, characterId: string | null, historyDepth: number): Promise<ContextReply>;
    resolveMacros(template: string, chatId: string, characterId: string | null): Promise<string>;
    /**
     * Resolves with the generated text. Aborting `signal` rejects immediately
     * with `RpcError{aborted: true}` and tells the backend to cancel; whatever
     * the backend still sends for that request afterwards is ignored.
     */
    generate(prompt: string, connectionId: string | null, maxTokens: number, signal?: AbortSignal): Promise<string>;
    onCommand(handler: (id: string) => void): () => void;
    onHello(handler: () => void): () => void;
    /** Unsubscribes, stops all timers and rejects whatever is still pending. */
    dispose(): void;
}

type ReplyType = Exclude<BackendMessage['type'], 'hello' | 'command' | 'error'>;

interface Pending {
    expect: ReplyType;
    resolve(message: BackendMessage): void;
    reject(error: RpcError): void;
    /** Present for requests that are re-sent until answered. */
    resend?: () => void;
    cleanup(): void;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

function defaultIdFactory(): () => string {
    let counter = 0;
    return () => {
        counter += 1;
        const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
        return typeof cryptoApi?.randomUUID === 'function'
            ? cryptoApi.randomUUID()
            : `nc-${Date.now().toString(36)}-${counter}`;
    };
}

export function createRpcClient(transport: RpcTransport, options: RpcClientOptions = {}): RpcClient {
    const newId = options.newId ?? defaultIdFactory();
    const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const pending = new Map<string, Pending>();
    const commandHandlers = new Set<(id: string) => void>();
    const helloHandlers = new Set<() => void>();
    let disposed = false;

    function post(message: FrontendMessage): void {
        transport.sendToBackend(message);
    }

    function handleMessage(payload: unknown): void {
        if (disposed || !isBackendMessage(payload)) return;
        if (payload.type === 'hello') {
            for (const entry of [...pending.values()]) entry.resend?.();
            for (const handler of [...helloHandlers]) safely(() => handler());
            return;
        }
        if (payload.type === 'command') {
            for (const handler of [...commandHandlers]) safely(() => handler(payload.id));
            return;
        }
        const entry = pending.get(payload.requestId);
        if (!entry) return; // answered, aborted or timed out already
        pending.delete(payload.requestId);
        entry.cleanup();
        if (payload.type === 'error') {
            entry.reject(new RpcError(payload.message, payload.aborted));
        } else if (payload.type === entry.expect) {
            entry.resolve(payload);
        } else {
            entry.reject(new RpcError(`Unexpected backend reply "${payload.type}" (expected "${entry.expect}")`));
        }
    }

    const unsubscribe = transport.onBackendMessage(handleMessage);

    /** Registers a pending request, sends it and resolves with the matching reply. */
    function request<T extends ReplyType>(
        build: (requestId: string) => FrontendMessage,
        expect: T,
        timeoutMs: number = requestTimeoutMs,
    ): Promise<Extract<BackendMessage, { type: T }>> {
        if (disposed) return Promise.reject(new RpcError('RPC client was disposed', true));
        const requestId = newId();
        return new Promise((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const entry: Pending = {
                expect,
                resolve: (message) => resolve(message as Extract<BackendMessage, { type: T }>),
                reject,
                cleanup: () => clearTimeout(timer),
            };
            pending.set(requestId, entry);
            if (timeoutMs > 0) {
                timer = setTimeout(() => {
                    if (!pending.delete(requestId)) return;
                    reject(new RpcError('The Next Choices backend did not respond'));
                }, timeoutMs);
            }
            try {
                post(build(requestId));
            } catch (err) {
                pending.delete(requestId);
                entry.cleanup();
                reject(new RpcError(errorMessage(err)));
            }
        });
    }

    return {
        loadSettings({ retryMs = 500, maxMs = 10_000 } = {}) {
            if (disposed) return Promise.resolve(null);
            const requestId = newId();
            return new Promise((resolve) => {
                let retryTimer: ReturnType<typeof setInterval> | undefined;
                let giveUpTimer: ReturnType<typeof setTimeout> | undefined;
                const message: FrontendMessage = { type: 'load_settings', requestId };
                const send = () => {
                    try {
                        post(message);
                    } catch {
                        /* the next retry may succeed */
                    }
                };
                const cleanup = () => {
                    clearInterval(retryTimer);
                    clearTimeout(giveUpTimer);
                };
                pending.set(requestId, {
                    expect: 'settings',
                    resend: send,
                    cleanup,
                    resolve: (reply) => resolve(reply.type === 'settings' ? reply.settings : null),
                    reject: () => resolve(null),
                });
                send();
                retryTimer = setInterval(send, retryMs);
                giveUpTimer = setTimeout(() => {
                    if (!pending.delete(requestId)) return;
                    cleanup();
                    resolve(null);
                }, maxMs);
            });
        },

        async saveSettings(settings) {
            const reply = await request((requestId) => ({ type: 'save_settings', requestId, settings }), 'settings');
            return reply.settings;
        },

        async getContext(chatId, characterId, historyDepth) {
            const reply = await request(
                (requestId) => ({ type: 'get_context', requestId, chatId, characterId, historyDepth }),
                'context',
            );
            return {
                history: reply.history,
                userName: reply.userName,
                charName: reply.charName,
                persona: reply.persona,
                lastIsUser: reply.lastIsUser,
            };
        },

        async resolveMacros(template, chatId, characterId) {
            const reply = await request(
                (requestId) => ({ type: 'resolve_macros', requestId, template, chatId, characterId }),
                'macros',
            );
            return reply.text;
        },

        generate(prompt, connectionId, maxTokens, signal) {
            if (disposed) return Promise.reject(new RpcError('RPC client was disposed', true));
            if (signal?.aborted) return Promise.reject(new RpcError('Aborted', true));
            const requestId = newId();
            return new Promise<string>((resolve, reject) => {
                const onAbort = () => {
                    // Drop the entry first so a late reply for it can never surface.
                    if (!pending.delete(requestId)) return;
                    try {
                        post({ type: 'cancel', requestId: newId(), targetRequestId: requestId });
                    } catch {
                        /* the backend is unreachable anyway */
                    }
                    reject(new RpcError('Aborted', true));
                };
                pending.set(requestId, {
                    expect: 'result',
                    cleanup: () => signal?.removeEventListener('abort', onAbort),
                    resolve: (reply) => resolve(reply.type === 'result' ? reply.text : ''),
                    reject,
                });
                signal?.addEventListener('abort', onAbort, { once: true });
                try {
                    post({ type: 'generate', requestId, prompt, connectionId, maxTokens });
                } catch (err) {
                    pending.delete(requestId);
                    signal?.removeEventListener('abort', onAbort);
                    reject(new RpcError(errorMessage(err)));
                }
            });
        },

        onCommand(handler) {
            commandHandlers.add(handler);
            return () => void commandHandlers.delete(handler);
        },

        onHello(handler) {
            helloHandlers.add(handler);
            return () => void helloHandlers.delete(handler);
        },

        dispose() {
            if (disposed) return;
            disposed = true;
            unsubscribe();
            const entries = [...pending.values()];
            pending.clear();
            for (const entry of entries) {
                entry.cleanup();
                entry.reject(new RpcError('RPC client was disposed', true));
            }
            commandHandlers.clear();
            helloHandlers.clear();
        },
    };
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function safely(fn: () => void): void {
    try {
        fn();
    } catch (err) {
        console.error('[nextChoices] RPC listener failed:', err);
    }
}
