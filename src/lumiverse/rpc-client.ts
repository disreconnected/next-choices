import { errorMessage } from '../shared/error';
import type { NextChoicesSettings } from '../shared/settings';
import { isBackendMessage, type BackendMessage, type FrontendMessage, type HistoryEntry } from './rpc';

export interface RpcTransport {
    sendToBackend(payload: unknown): void;
    onBackendMessage(handler: (payload: unknown) => void): () => void;
}

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
    newId?: () => string;
    requestTimeoutMs?: number;
}

export interface RpcClient {
    loadSettings(): Promise<NextChoicesSettings | null>;
    saveSettings(settings: NextChoicesSettings): Promise<NextChoicesSettings>;
    getContext(chatId: string, characterId: string | null, historyDepth: number): Promise<ContextReply>;
    resolveMacros(template: string, chatId: string, characterId: string | null): Promise<string>;
    generate(prompt: string, connectionId: string | null, maxTokens: number, signal?: AbortSignal): Promise<string>;
    onCommand(handler: (id: string) => void): () => void;
    dispose(): void;
}

type ReplyType = Exclude<BackendMessage['type'], 'hello' | 'command' | 'error'>;

interface Pending {
    expect: ReplyType;
    resolve(message: BackendMessage): void;
    reject(error: RpcError): void;
    resend?: () => void;
    cleanup(): void;
}

interface RequestOptions {
    timeoutMs?: number;
    signal?: AbortSignal;
    resendOnHello?: boolean;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const LOAD_SETTINGS_TIMEOUT_MS = 10_000;

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
    let disposed = false;

    function post(message: FrontendMessage): void {
        transport.sendToBackend(message);
    }

    function handleMessage(payload: unknown): void {
        if (disposed || !isBackendMessage(payload)) return;
        if (payload.type === 'hello') {
            for (const entry of [...pending.values()]) entry.resend?.();
            return;
        }
        if (payload.type === 'command') {
            for (const handler of [...commandHandlers]) safely(() => handler(payload.id));
            return;
        }
        const entry = pending.get(payload.requestId);
        if (!entry) return;
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

    function request<T extends ReplyType>(
        build: (requestId: string) => FrontendMessage,
        expect: T,
        { timeoutMs = requestTimeoutMs, signal, resendOnHello = false }: RequestOptions = {},
    ): Promise<Extract<BackendMessage, { type: T }>> {
        if (disposed) return Promise.reject(new RpcError('RPC client was disposed', true));
        if (signal?.aborted) return Promise.reject(new RpcError('Aborted', true));
        const requestId = newId();
        return new Promise((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const onAbort = () => {
                if (!pending.delete(requestId)) return;
                entry.cleanup();
                try {
                    post({ type: 'cancel', requestId: newId(), targetRequestId: requestId });
                } catch {}
                reject(new RpcError('Aborted', true));
            };
            const entry: Pending = {
                expect,
                resolve: (message) => resolve(message as Extract<BackendMessage, { type: T }>),
                reject,
                cleanup: () => {
                    clearTimeout(timer);
                    signal?.removeEventListener('abort', onAbort);
                },
            };
            if (resendOnHello) {
                entry.resend = () => {
                    try {
                        post(build(requestId));
                    } catch {}
                };
            }
            pending.set(requestId, entry);
            signal?.addEventListener('abort', onAbort, { once: true });
            if (timeoutMs > 0) {
                timer = setTimeout(() => {
                    if (!pending.delete(requestId)) return;
                    entry.cleanup();
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
        async loadSettings() {
            try {
                const reply = await request((requestId) => ({ type: 'load_settings', requestId }), 'settings', {
                    timeoutMs: LOAD_SETTINGS_TIMEOUT_MS,
                    resendOnHello: true,
                });
                return reply.settings;
            } catch {
                return null;
            }
        },

        async saveSettings(settings) {
            const reply = await request((requestId) => ({ type: 'save_settings', requestId, settings }), 'settings');
            return reply.settings;
        },

        getContext(chatId, characterId, historyDepth) {
            return request(
                (requestId) => ({ type: 'get_context', requestId, chatId, characterId, historyDepth }),
                'context',
            );
        },

        async resolveMacros(template, chatId, characterId) {
            const reply = await request(
                (requestId) => ({ type: 'resolve_macros', requestId, template, chatId, characterId }),
                'macros',
            );
            return reply.text;
        },

        async generate(prompt, connectionId, maxTokens, signal) {
            const reply = await request(
                (requestId) => ({ type: 'generate', requestId, prompt, connectionId, maxTokens }),
                'result',
                { timeoutMs: 0, signal },
            );
            return reply.text;
        },

        onCommand(handler) {
            commandHandlers.add(handler);
            return () => void commandHandlers.delete(handler);
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
        },
    };
}

function safely(fn: () => void): void {
    try {
        fn();
    } catch (err) {
        console.error('[nextChoices] RPC listener failed:', err);
    }
}
