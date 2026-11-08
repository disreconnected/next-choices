/**
 * Messages exchanged between the Lumiverse frontend and backend modules
 * (ctx.sendToBackend / spindle.sendToFrontend). Every request carries a client
 * generated `requestId`; every reply to it echoes that id.
 *
 * `load_settings` and `save_settings` are both answered with `settings` (for a
 * save: the normalised settings that were stored). `command` and `hello` are
 * pushed by the backend and are not replies.
 */
import type { NextChoicesSettings } from '../shared/settings';

export type { NextChoicesSettings };

/** One visible chat message, oldest first, already stripped of system and hidden messages. */
export interface HistoryEntry {
    name: string;
    text: string;
    isUser: boolean;
}

// ---------------------------------------------------------------------------
// Frontend -> backend
// ---------------------------------------------------------------------------

export type FrontendMessage =
    | { type: 'load_settings'; requestId: string }
    | { type: 'save_settings'; requestId: string; settings: NextChoicesSettings }
    | { type: 'get_context'; requestId: string; chatId: string; characterId: string | null; historyDepth: number }
    | { type: 'resolve_macros'; requestId: string; template: string; chatId: string; characterId: string | null }
    /** `connectionId: null` means "Current connection". */
    | { type: 'generate'; requestId: string; prompt: string; connectionId: string | null; maxTokens: number }
    /** Aborts the `generate` request whose requestId is `targetRequestId`. */
    | { type: 'cancel'; requestId: string; targetRequestId: string };

// ---------------------------------------------------------------------------
// Backend -> frontend
// ---------------------------------------------------------------------------

export type BackendMessage =
    /** Broadcast once the backend is listening, so a frontend that loaded earlier can (re)send load_settings. */
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
    /** A registered Lumiverse command was invoked (ids are defined by the backend). */
    | { type: 'command'; id: string };

export type FrontendMessageType = FrontendMessage['type'];
export type BackendMessageType = BackendMessage['type'];

// ---------------------------------------------------------------------------
// Type guards (the payloads cross a process boundary, so check their shape)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isStringOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string';

function isHistoryEntry(value: unknown): value is HistoryEntry {
    return isRecord(value) && isString(value.name) && isString(value.text) && isBoolean(value.isUser);
}

/** True for a well-formed message sent by the frontend. */
export function isFrontendMessage(value: unknown): value is FrontendMessage {
    if (!isRecord(value) || !isString(value.requestId)) return false;
    switch (value.type) {
        case 'load_settings':
            return true;
        case 'save_settings':
            return isRecord(value.settings);
        case 'get_context':
            return isString(value.chatId) && isStringOrNull(value.characterId) && isFiniteNumber(value.historyDepth);
        case 'resolve_macros':
            return isString(value.template) && isString(value.chatId) && isStringOrNull(value.characterId);
        case 'generate':
            return isString(value.prompt) && isStringOrNull(value.connectionId) && isFiniteNumber(value.maxTokens);
        case 'cancel':
            return isString(value.targetRequestId);
        default:
            return false;
    }
}

/** True for a well-formed message sent by the backend. */
export function isBackendMessage(value: unknown): value is BackendMessage {
    if (!isRecord(value)) return false;
    switch (value.type) {
        case 'hello':
            return true;
        case 'command':
            return isString(value.id);
        default:
            break;
    }
    if (!isString(value.requestId)) return false;
    switch (value.type) {
        case 'settings':
            return isRecord(value.settings);
        case 'context':
            return (
                Array.isArray(value.history) &&
                value.history.every(isHistoryEntry) &&
                isString(value.userName) &&
                isString(value.charName) &&
                isString(value.persona) &&
                isBoolean(value.lastIsUser)
            );
        case 'macros':
        case 'result':
            return isString(value.text);
        case 'error':
            return isString(value.message) && isBoolean(value.aborted);
        default:
            return false;
    }
}
