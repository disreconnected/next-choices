import type {
    GenerationRequestDTO,
    SpindleAPI,
    SpindleCommandContextDTO,
    SpindleCommandDTO,
    SpindleCommandOriginDTO,
} from 'lumiverse-spindle-types';
import { errorMessage } from '../shared/error';
import { DEFAULT_SETTINGS, normalizeSettings } from '../shared/settings';
import { isFrontendMessage } from './rpc';
import type { BackendMessage, FrontendMessage, HistoryEntry } from './rpc';

declare const spindle: SpindleAPI | undefined;

export interface BackendApi {
    onFrontendMessage(
        handler: (payload: unknown, userId: string, frontendSessionId?: string) => void | Promise<void>,
    ): () => void;
    sendToFrontend(payload: unknown, userId?: string, options?: { frontendSessionId?: string }): void;
    userStorage: {
        getJson(path: string, options?: { fallback?: unknown; userId?: string }): Promise<unknown>;
        setJson(path: string, value: unknown, options?: { userId?: string }): Promise<void>;
    };
    chat: {
        getMessages(chatId: string, options?: { tail?: number; light?: boolean }): Promise<unknown[]>;
    };
    personas: {
        getActive(userId?: string): Promise<{ name?: string; description?: string } | null>;
    };
    macros: {
        resolve(
            template: string,
            options?: { chatId?: string; characterId?: string; commit?: boolean; userId?: string },
        ): Promise<{ text: string }>;
    };
    generate: {
        raw(input: GenerationRequestDTO): Promise<unknown>;
        quiet(input: GenerationRequestDTO): Promise<unknown>;
    };
    commands: {
        register(commands: SpindleCommandDTO[]): void;
        unregister(commandIds?: string[]): void;
        onInvoked(
            handler: (
                commandId: string,
                context: SpindleCommandContextDTO,
                origin?: SpindleCommandOriginDTO,
            ) => void | Promise<void>,
        ): () => void;
    };
    log?: {
        info(msg: string): void;
        warn(msg: string): void;
        error(msg: string): void;
    };
}

const LOG_PREFIX = '[next_choices]';
const SETTINGS_PATH = 'settings.json';

const MAX_TAIL = 1000;
const TAIL_MARGIN = 10;

const COMMANDS: SpindleCommandDTO[] = [
    {
        id: 'generate',
        label: 'Next Choices: Generate choices',
        description: 'Suggest reply choices for the current chat',
        keywords: ['choices', 'suggest', 'reply'],
        scope: 'chat-idle',
    },
    {
        id: 'guided',
        label: 'Next Choices: Generate choices (guided)',
        description: 'Suggest reply choices around a theme you enter',
        keywords: ['choices', 'guided', 'theme'],
        scope: 'chat-idle',
    },
];

interface HostMessage {
    role?: string;
    hidden?: boolean;
    is_user?: boolean;
    name?: unknown;
    content?: unknown;
    extra?: { hidden?: unknown } | null;
}

function isAbortError(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

function asMessages(value: unknown): HostMessage[] {
    return Array.isArray(value) ? value.filter((m): m is HostMessage => typeof m === 'object' && m !== null) : [];
}

const isHidden = (m: HostMessage): boolean => m.hidden === true || m.extra?.hidden === true;
const isUserMessage = (m: HostMessage): boolean => m.is_user ?? m.role === 'user';
const nameOf = (m: HostMessage | undefined): string => (typeof m?.name === 'string' ? m.name : '');

function extractText(result: unknown): string {
    if (typeof result === 'string') return result;
    const content = (result as { content?: unknown } | null | undefined)?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                const p = part as { type?: unknown; text?: unknown } | null;
                return p?.type === 'text' && typeof p.text === 'string' ? p.text : '';
            })
            .join('');
    }
    throw new Error('Unrecognized generation response');
}

export function initBackend(api: BackendApi): () => void {
    const pending = new Map<string, AbortController>();

    const log = (level: 'info' | 'warn' | 'error', msg: string): void => {
        const text = `${LOG_PREFIX} ${msg}`;
        if (api.log) api.log[level](text);
        else console[level](text);
    };

    async function fetchMessages(chatId: string, historyDepth: number): Promise<HostMessage[]> {
        const tail = Math.max(1, Math.min(MAX_TAIL, Math.floor(historyDepth) + TAIL_MARGIN));
        try {
            return asMessages(await api.chat.getMessages(chatId, { tail, light: true }));
        } catch (err) {
            log('warn', `chat.getMessages with options failed (${errorMessage(err)}); retrying without options`);
            return asMessages(await api.chat.getMessages(chatId)).slice(-tail);
        }
    }

    async function getContext(
        msg: Extract<FrontendMessage, { type: 'get_context' }>,
        userId: string,
    ): Promise<Extract<BackendMessage, { type: 'context' }>> {
        const messages = await fetchMessages(msg.chatId, msg.historyDepth);
        const visible = messages.filter((m) => m.role !== 'system' && !isHidden(m));

        const history: HistoryEntry[] = visible.slice(-Math.max(1, Math.floor(msg.historyDepth))).map((m) => ({
            name: nameOf(m),
            text: typeof m.content === 'string' ? m.content : '',
            isUser: isUserMessage(m),
        }));

        let persona: Awaited<ReturnType<BackendApi['personas']['getActive']>> = null;
        try {
            persona = await api.personas.getActive(userId);
        } catch (err) {
            log('warn', `personas.getActive failed (${errorMessage(err)}); continuing without a persona`);
        }

        const lastAssistant = visible.findLast((m) => !isUserMessage(m));
        const lastUser = visible.findLast(isUserMessage);
        const last = visible[visible.length - 1];
        return {
            type: 'context',
            requestId: msg.requestId,
            history,
            userName: persona?.name || nameOf(lastUser) || 'User',
            charName: nameOf(lastAssistant),
            persona: persona?.description ?? '',
            lastIsUser: last !== undefined && isUserMessage(last),
        };
    }

    function dispatchGenerate(
        msg: Extract<FrontendMessage, { type: 'generate' }>,
        signal: AbortSignal,
        userId: string,
    ): Promise<unknown> {
        const base = {
            messages: [{ role: 'user' as const, content: msg.prompt }],
            parameters: { max_tokens: Math.max(1, Math.floor(msg.maxTokens)) },
            signal,
            userId,
        };
        const dispatch = (extra: Pick<GenerationRequestDTO, 'reasoning'>): Promise<unknown> =>
            msg.connectionId
                ? api.generate.raw({ type: 'raw', connection_id: msg.connectionId, ...base, ...extra })
                : api.generate.quiet({ type: 'quiet', ...base, ...extra });

        return dispatch({ reasoning: { source: 'off' } }).catch((err: unknown) => {
            if (signal.aborted || isAbortError(err) || !/reasoning/i.test(errorMessage(err))) throw err;
            log('warn', `host rejected reasoning override (${errorMessage(err)}); retrying without it`);
            return dispatch({});
        });
    }

    async function generate(
        msg: Extract<FrontendMessage, { type: 'generate' }>,
        reply: (message: BackendMessage) => void,
        userId: string,
    ): Promise<void> {
        const ctrl = new AbortController();
        pending.set(msg.requestId, ctrl);
        try {
            const text = extractText(await dispatchGenerate(msg, ctrl.signal, userId));
            reply({ type: 'result', requestId: msg.requestId, text });
        } catch (err) {
            reply({
                type: 'error',
                requestId: msg.requestId,
                message: errorMessage(err),
                aborted: isAbortError(err) || ctrl.signal.aborted,
            });
        } finally {
            if (pending.get(msg.requestId) === ctrl) pending.delete(msg.requestId);
        }
    }

    async function handle(msg: FrontendMessage, reply: (message: BackendMessage) => void, userId: string): Promise<void> {
        switch (msg.type) {
            case 'load_settings': {
                let stored: unknown = DEFAULT_SETTINGS;
                try {
                    stored = await api.userStorage.getJson(SETTINGS_PATH, { fallback: DEFAULT_SETTINGS, userId });
                } catch (err) {
                    log('error', `could not read ${SETTINGS_PATH} (${errorMessage(err)}); using defaults`);
                }
                reply({ type: 'settings', requestId: msg.requestId, settings: normalizeSettings(stored) });
                return;
            }
            case 'save_settings': {
                const settings = normalizeSettings(msg.settings);
                await api.userStorage.setJson(SETTINGS_PATH, settings, { userId });
                reply({ type: 'settings', requestId: msg.requestId, settings });
                return;
            }
            case 'get_context':
                reply(await getContext(msg, userId));
                return;
            case 'resolve_macros': {
                let text = msg.template;
                try {
                    const resolved = await api.macros.resolve(msg.template, {
                        chatId: msg.chatId,
                        characterId: msg.characterId ?? undefined,
                        commit: false,
                        userId,
                    });
                    if (typeof resolved?.text === 'string') text = resolved.text;
                } catch (err) {
                    log('warn', `macros.resolve failed (${errorMessage(err)}); returning the template unexpanded`);
                }
                reply({ type: 'macros', requestId: msg.requestId, text });
                return;
            }
            case 'generate':
                await generate(msg, reply, userId);
                return;
            case 'cancel':
                pending.get(msg.targetRequestId)?.abort();
                return;
        }
    }

    const offMessage = api.onFrontendMessage(async (payload, userId, frontendSessionId) => {
        if (!isFrontendMessage(payload)) {
            log('info', 'ignored an invalid frontend payload');
            return;
        }
        const reply = (message: BackendMessage): void =>
            api.sendToFrontend(message, userId, frontendSessionId ? { frontendSessionId } : undefined);
        try {
            await handle(payload, reply, userId);
        } catch (err) {
            log('error', `${payload.type} failed: ${errorMessage(err)}`);
            try {
                reply({ type: 'error', requestId: payload.requestId, message: errorMessage(err), aborted: false });
            } catch (sendErr) {
                log('error', `could not report the failure: ${errorMessage(sendErr)}`);
            }
        }
    });

    api.sendToFrontend({ type: 'hello' } satisfies BackendMessage);

    try {
        api.commands.register(COMMANDS);
    } catch (err) {
        log('warn', `could not register commands: ${errorMessage(err)}`);
    }
    const offCommand = api.commands.onInvoked((id, _context, origin) => {
        api.sendToFrontend({ type: 'command', id } satisfies BackendMessage, origin?.userId);
    });

    return () => {
        offMessage();
        offCommand();
        for (const ctrl of pending.values()) ctrl.abort();
        pending.clear();
        try {
            api.commands.unregister();
        } catch (err) {
            log('warn', `could not unregister commands: ${errorMessage(err)}`);
        }
    };
}

if (typeof spindle !== 'undefined') initBackend(spindle);
