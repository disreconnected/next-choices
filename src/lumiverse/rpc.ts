import type { NextChoicesSettings } from '../shared/settings';

export interface HistoryEntry {
    name: string;
    text: string;
    isUser: boolean;
}

export type FrontendMessage =
    | { type: 'load_settings'; requestId: string }
    | { type: 'save_settings'; requestId: string; settings: NextChoicesSettings }
    | { type: 'get_context'; requestId: string; chatId: string; characterId: string | null; historyDepth: number }
    | { type: 'resolve_macros'; requestId: string; template: string; chatId: string; characterId: string | null }
    | { type: 'generate'; requestId: string; prompt: string; connectionId: string | null; maxTokens: number }
    | { type: 'cancel'; requestId: string; targetRequestId: string };

export type BackendMessage =
    | { type: 'hello' }
    | { type: 'settings'; requestId: string; settings: NextChoicesSettings }
    | {
          type: 'context';
          requestId: string;
          history: HistoryEntry[];
          userName: string;
          charName: string;
          persona: string;
          lastIsUser: boolean;
      }
    | { type: 'macros'; requestId: string; text: string }
    | { type: 'result'; requestId: string; text: string }
    | { type: 'error'; requestId: string; message: string; aborted: boolean }
    | { type: 'command'; id: string };

const FRONTEND_TYPES = new Set<string>([
    'load_settings',
    'save_settings',
    'get_context',
    'resolve_macros',
    'generate',
    'cancel',
] satisfies FrontendMessage['type'][]);

const BACKEND_TYPES = new Set<string>([
    'hello',
    'settings',
    'context',
    'macros',
    'result',
    'error',
    'command',
] satisfies BackendMessage['type'][]);

function hasKnownType(value: unknown, types: ReadonlySet<string>): value is Record<string, unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { type?: unknown }).type === 'string' &&
        types.has((value as { type: string }).type)
    );
}

export function isFrontendMessage(value: unknown): value is FrontendMessage {
    return hasKnownType(value, FRONTEND_TYPES) && typeof value.requestId === 'string';
}

export function isBackendMessage(value: unknown): value is BackendMessage {
    if (!hasKnownType(value, BACKEND_TYPES)) return false;
    return value.type === 'hello' || value.type === 'command' || typeof value.requestId === 'string';
}
