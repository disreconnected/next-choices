// @bun
// src/shared/templates.ts
var LEGACY_DEFAULT_PROMPT_TEMPLATE = `You are an assistant helping a roleplay player. Below is the recent conversation between {{user}} and {{char}}:

` + `{{history}}

` + `Write {{numChoices}} response options that {{user}} could say next, replying to the latest message from {{char}}.

` + `Requirements:
` + `- The motivation behind each option, and the consequences it would lead to, must differ drastically from the other options (e.g. one bold, one cautious, one creative).
` + `- Write the options in the same language as the conversation.
` + "- Respond ONLY with a JSON array of {{numChoices}} strings, no other text.";
var DEFAULT_PROMPT_TEMPLATE = `You are an assistant helping a roleplay player. Below is the recent conversation between {{user}} and {{char}}:

` + `{{history}}

` + `Persona of {{user}} (match their voice, writing style, and inner narration):
` + `{{persona}}

` + `Write {{numChoices}} response options that {{user}} could say next, replying to the latest message from {{char}}.

` + `Requirements:
` + `- The motivation behind each option, and the consequences it would lead to, must differ drastically from the other options (e.g. one bold, one cautious, one creative).
` + `- Write the options in the same language as the conversation.
` + "- Respond ONLY with a JSON array of {{numChoices}} strings, no other text.";

// src/shared/settings.ts
var DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  autoGenerate: true,
  autoSend: false,
  profileId: "current",
  showQuickGenerateButton: false,
  numChoices: 3,
  maxTokens: 500,
  historyDepth: 4,
  promptTemplate: DEFAULT_PROMPT_TEMPLATE
});
function upgradeLegacyTemplate(stored) {
  if (stored.promptTemplate === LEGACY_DEFAULT_PROMPT_TEMPLATE) {
    stored.promptTemplate = DEFAULT_PROMPT_TEMPLATE;
    return true;
  }
  return false;
}
function normalizeNumChoices(raw) {
  const value = parseInt(String(raw), 10);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 10) : DEFAULT_SETTINGS.numChoices;
}
function normalizeMaxTokens(raw) {
  const value = parseInt(String(raw), 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_SETTINGS.maxTokens;
}
function normalizeHistoryDepth(raw) {
  const value = parseInt(String(raw), 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_SETTINGS.historyDepth;
}
function normalizePromptTemplate(raw) {
  return String(raw ?? "") || DEFAULT_PROMPT_TEMPLATE;
}
function normalizeProfileId(raw) {
  return String(raw || "current");
}
function normalizeSettings(raw) {
  const source = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const bool = (value, fallback) => typeof value === "boolean" ? value : fallback;
  const text = (value) => typeof value === "string" ? value : undefined;
  const settings = {
    enabled: bool(source.enabled, DEFAULT_SETTINGS.enabled),
    autoGenerate: bool(source.autoGenerate, DEFAULT_SETTINGS.autoGenerate),
    autoSend: bool(source.autoSend, DEFAULT_SETTINGS.autoSend),
    profileId: normalizeProfileId(text(source.profileId)),
    showQuickGenerateButton: bool(source.showQuickGenerateButton, DEFAULT_SETTINGS.showQuickGenerateButton),
    numChoices: normalizeNumChoices(source.numChoices),
    maxTokens: normalizeMaxTokens(source.maxTokens),
    historyDepth: normalizeHistoryDepth(source.historyDepth),
    promptTemplate: normalizePromptTemplate(text(source.promptTemplate))
  };
  upgradeLegacyTemplate(settings);
  return settings;
}

// src/lumiverse/rpc.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var isString = (value) => typeof value === "string";
var isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
var isStringOrNull = (value) => value === null || typeof value === "string";
function isFrontendMessage(value) {
  if (!isRecord(value) || !isString(value.requestId))
    return false;
  switch (value.type) {
    case "load_settings":
      return true;
    case "save_settings":
      return isRecord(value.settings);
    case "get_context":
      return isString(value.chatId) && isStringOrNull(value.characterId) && isFiniteNumber(value.historyDepth);
    case "resolve_macros":
      return isString(value.template) && isString(value.chatId) && isStringOrNull(value.characterId);
    case "generate":
      return isString(value.prompt) && isStringOrNull(value.connectionId) && isFiniteNumber(value.maxTokens);
    case "cancel":
      return isString(value.targetRequestId);
    default:
      return false;
  }
}

// src/lumiverse/backend.ts
var LOG_PREFIX = "[next_choices]";
var SETTINGS_PATH = "settings.json";
var MAX_TAIL = 1000;
var TAIL_MARGIN = 10;
var COMMANDS = [
  {
    id: "generate",
    label: "Next Choices: Generate choices",
    description: "Suggest reply choices for the current chat",
    keywords: ["choices", "suggest", "reply"],
    scope: "chat-idle"
  },
  {
    id: "guided",
    label: "Next Choices: Generate choices (guided)",
    description: "Suggest reply choices around a theme you enter",
    keywords: ["choices", "guided", "theme"],
    scope: "chat-idle"
  }
];
function errorMessage(err) {
  if (err instanceof Error)
    return err.message;
  if (typeof err === "string")
    return err;
  if (typeof err === "object" && err !== null && typeof err.message === "string") {
    return err.message;
  }
  return String(err);
}
function isAbortError(err) {
  return typeof err === "object" && err !== null && err.name === "AbortError";
}
function asMessages(value) {
  return Array.isArray(value) ? value.filter((m) => typeof m === "object" && m !== null) : [];
}
var isHidden = (m) => m.hidden === true || m.extra?.hidden === true;
var isUserMessage = (m) => m.is_user ?? m.role === "user";
var nameOf = (m) => typeof m?.name === "string" ? m.name : "";
function extractText(result) {
  if (typeof result === "string")
    return result;
  const content = result?.content;
  if (typeof content === "string")
    return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      const p = part;
      return p?.type === "text" && typeof p.text === "string" ? p.text : "";
    }).join("");
  }
  throw new Error("Unrecognized generation response");
}
function initBackend(api) {
  const pending = new Map;
  const log = (level, msg) => {
    const text = `${LOG_PREFIX} ${msg}`;
    if (api.log)
      api.log[level](text);
    else
      console[level](text);
  };
  async function fetchMessages(chatId, historyDepth) {
    const tail = Math.max(1, Math.min(MAX_TAIL, Math.floor(historyDepth) + TAIL_MARGIN));
    try {
      return asMessages(await api.chat.getMessages(chatId, { tail, light: true }));
    } catch (err) {
      log("warn", `chat.getMessages with options failed (${errorMessage(err)}); retrying without options`);
      return asMessages(await api.chat.getMessages(chatId)).slice(-tail);
    }
  }
  async function getContext(msg) {
    const messages = await fetchMessages(msg.chatId, msg.historyDepth);
    const visible = messages.filter((m) => m.role !== "system" && !isHidden(m));
    const history = visible.slice(-Math.max(1, Math.floor(msg.historyDepth))).map((m) => ({
      name: nameOf(m),
      text: typeof m.content === "string" ? m.content : "",
      isUser: isUserMessage(m)
    }));
    let persona = null;
    try {
      persona = await api.personas.getActive();
    } catch (err) {
      log("warn", `personas.getActive failed (${errorMessage(err)}); continuing without a persona`);
    }
    const lastAssistant = visible.findLast((m) => !isUserMessage(m));
    const lastUser = visible.findLast(isUserMessage);
    const last = visible[visible.length - 1];
    return {
      type: "context",
      requestId: msg.requestId,
      history,
      userName: persona?.name || nameOf(lastUser) || "User",
      charName: nameOf(lastAssistant),
      persona: persona?.description ?? "",
      lastIsUser: last !== undefined && isUserMessage(last)
    };
  }
  function dispatchGenerate(msg, signal) {
    const base = {
      messages: [{ role: "user", content: msg.prompt }],
      parameters: { max_tokens: Math.max(1, Math.floor(msg.maxTokens)) },
      signal
    };
    const dispatch = (extra) => msg.connectionId ? api.generate.raw({ type: "raw", connection_id: msg.connectionId, ...base, ...extra }) : api.generate.quiet({ type: "quiet", ...base, ...extra });
    return dispatch({ reasoning: { source: "off" } }).catch((err) => {
      if (signal.aborted || isAbortError(err) || !/reasoning/i.test(errorMessage(err)))
        throw err;
      log("warn", `host rejected reasoning override (${errorMessage(err)}); retrying without it`);
      return dispatch({});
    });
  }
  async function generate(msg, reply) {
    const ctrl = new AbortController;
    pending.set(msg.requestId, ctrl);
    try {
      const text = extractText(await dispatchGenerate(msg, ctrl.signal));
      reply({ type: "result", requestId: msg.requestId, text });
    } catch (err) {
      reply({
        type: "error",
        requestId: msg.requestId,
        message: errorMessage(err),
        aborted: isAbortError(err) || ctrl.signal.aborted
      });
    } finally {
      if (pending.get(msg.requestId) === ctrl)
        pending.delete(msg.requestId);
    }
  }
  async function handle(msg, reply) {
    switch (msg.type) {
      case "load_settings": {
        let stored = DEFAULT_SETTINGS;
        try {
          stored = await api.userStorage.getJson(SETTINGS_PATH, { fallback: DEFAULT_SETTINGS });
        } catch (err) {
          log("error", `could not read ${SETTINGS_PATH} (${errorMessage(err)}); using defaults`);
        }
        reply({ type: "settings", requestId: msg.requestId, settings: normalizeSettings(stored) });
        return;
      }
      case "save_settings": {
        const settings = normalizeSettings(msg.settings);
        await api.userStorage.setJson(SETTINGS_PATH, settings);
        reply({ type: "settings", requestId: msg.requestId, settings });
        return;
      }
      case "get_context":
        reply(await getContext(msg));
        return;
      case "resolve_macros": {
        let text = msg.template;
        try {
          const resolved = await api.macros.resolve(msg.template, {
            chatId: msg.chatId,
            characterId: msg.characterId ?? undefined,
            commit: false
          });
          if (typeof resolved?.text === "string")
            text = resolved.text;
        } catch (err) {
          log("warn", `macros.resolve failed (${errorMessage(err)}); returning the template unexpanded`);
        }
        reply({ type: "macros", requestId: msg.requestId, text });
        return;
      }
      case "generate":
        await generate(msg, reply);
        return;
      case "cancel":
        pending.get(msg.targetRequestId)?.abort();
        return;
    }
  }
  const offMessage = api.onFrontendMessage(async (payload, userId, frontendSessionId) => {
    if (!isFrontendMessage(payload)) {
      log("info", "ignored an invalid frontend payload");
      return;
    }
    const reply = (message) => api.sendToFrontend(message, userId, frontendSessionId ? { frontendSessionId } : undefined);
    try {
      await handle(payload, reply);
    } catch (err) {
      log("error", `${payload.type} failed: ${errorMessage(err)}`);
      try {
        reply({ type: "error", requestId: payload.requestId, message: errorMessage(err), aborted: false });
      } catch (sendErr) {
        log("error", `could not report the failure: ${errorMessage(sendErr)}`);
      }
    }
  });
  api.sendToFrontend({ type: "hello" });
  try {
    api.commands.register(COMMANDS);
  } catch (err) {
    log("warn", `could not register commands: ${errorMessage(err)}`);
  }
  const offCommand = api.commands.onInvoked((id, _context, origin) => {
    api.sendToFrontend({ type: "command", id }, origin?.userId);
  });
  return () => {
    offMessage();
    offCommand();
    for (const ctrl of pending.values())
      ctrl.abort();
    pending.clear();
    try {
      api.commands.unregister();
    } catch (err) {
      log("warn", `could not unregister commands: ${errorMessage(err)}`);
    }
  };
}
if (typeof spindle !== "undefined")
  initBackend(spindle);
export {
  initBackend
};
