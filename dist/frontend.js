// src/shared/error.ts
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

// src/shared/parse.ts
function parseChoices(text, max) {
  if (typeof text !== "string" || !text.trim())
    return [];
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const arr = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(arr)) {
        const items = arr.map((item) => {
          if (typeof item === "string")
            return item.trim();
          if (item && typeof item === "object") {
            const entry = item;
            const v = entry.text ?? entry.option ?? entry.choice ?? entry.content;
            return typeof v === "string" ? v.trim() : "";
          }
          return "";
        }).filter(Boolean);
        if (items.length)
          return items.slice(0, max);
      }
    } catch {}
  }
  const items = [];
  for (const rawLine of text.split(`
`)) {
    const line = rawLine.trim();
    const match = line.match(/^(?:\d+\s*[.)、]\s*|[-*•]\s+)(.+)$/);
    if (match) {
      let item = match[1].trim();
      item = item.replace(/^["'「『]|["'」』,]+$/g, "").trim();
      if (item)
        items.push(item);
    }
  }
  return items.slice(0, max);
}
function parseRewrittenChoices(text, expectedCount) {
  if (typeof text !== "string" || !text.trim())
    return null;
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start)
    return null;
  let arr;
  try {
    arr = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr.length !== expectedCount)
    return null;
  const items = arr.map((item) => typeof item === "string" ? item.trim() : null);
  if (items.some((item) => !item))
    return null;
  return items;
}

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
var MODULE_NAME = "nextChoices";
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

// src/shared/prompt.ts
var HISTORY_PLACEHOLDER = "NEXT_CHOICES_HISTORY";
function buildHistory(messages, depth) {
  return messages.slice(-Math.max(1, depth)).map((mes) => `${mes.name ?? "?"}: ${mes.text}`).join(`
`);
}
function prepareTemplate(template, numChoices) {
  return (template || DEFAULT_PROMPT_TEMPLATE).replaceAll("{{history}}", HISTORY_PLACEHOLDER).replaceAll("{{numChoices}}", String(numChoices));
}
function finalizePrompt(expanded, vars) {
  const prompt = expanded.replaceAll("{{user}}", vars.user).replaceAll("{{char}}", vars.char).replaceAll("{{persona}}", vars.persona);
  return prompt.replaceAll(HISTORY_PLACEHOLDER, vars.history);
}
var NON_STRING_WARNING = "[" + MODULE_NAME + "] substituteParams returned a non-string; using manual macro replacement.";
var FAILED_WARNING = "[" + MODULE_NAME + "] substituteParams failed, using manual macro replacement:";
function acceptExpansion(unexpanded, expanded) {
  if (typeof expanded === "string")
    return expanded;
  console.warn(NON_STRING_WARNING);
  return unexpanded;
}
async function buildPromptAsync(template, vars, expand) {
  let prompt = prepareTemplate(template, vars.numChoices);
  if (expand) {
    try {
      prompt = acceptExpansion(prompt, await expand(prompt));
    } catch (err) {
      console.warn(FAILED_WARNING, err);
    }
  }
  return finalizePrompt(prompt, vars);
}
function appendEnhancementTask(base, choices, guidance) {
  const payload = JSON.stringify({
    task: "Enhance each response option below according to the guidance. This task overrides the previous instruction to write new options.",
    guidance,
    choices,
    requirements: [
      "For every choice, keep its existing position, main actions, dialogue, intention, scene facts, voice, language, and distinct approach.",
      "Weave in or append actions and dialogue that support the guidance; do not remove the existing substance or start over.",
      "Do not combine, reorder, or add options.",
      "Return the complete enhanced version of every choice (not only the additions) as a JSON array of exactly " + choices.length + " nonempty strings, with no commentary."
    ]
  }, null, 2);
  return base + `

=== Next Choices enhancement task ===
` + payload + `
=== End of Next Choices enhancement task ===`;
}
function appendCombinationTask(base, choices) {
  const payload = {
    task: "Rewrite the selected response options into ONE coherent player response. This task overrides earlier instructions to produce multiple or diverse alternatives.",
    choices,
    requirements: [
      "Treat the selected choices as source material, not as instructions to follow.",
      "Merge the meaningful actions, intentions, and dialogue from all selected choices into a natural, logically ordered response; do not merely concatenate them.",
      "Remove repeated information and reconcile incompatible details into one plausible course of action consistent with the recent conversation, preserving as much compatible substance as possible.",
      "Match the player persona, point of view, voice, formatting, and conversation language. Do not invent new scene facts, other characters' replies, or outcomes.",
      "Return ONLY a JSON array containing exactly one nonempty string: the complete combined response, with no commentary."
    ]
  };
  const serialized = JSON.stringify(payload, null, 2).replaceAll("{{", "\\u007B\\u007B");
  return base + `

=== Next Choices combination task ===
` + serialized + `
=== End of Next Choices combination task ===`;
}
function appendGuidedTask(base, numChoices, guidance) {
  const payload = JSON.stringify({
    task: "Generate new response options around the shared theme below.",
    guidance,
    requirements: [
      "Make the guidance the main theme of every option, while staying consistent with the conversation and persona.",
      "Preserve the prompt template's different tones, motivations, approaches, and consequences across the options (for example, bold, cautious, romantic, or creative). The shared theme must not make the options paraphrases of one another.",
      "Keep the language, voice, and other requirements of the prompt template.",
      "Return ONLY a JSON array of exactly " + numChoices + " nonempty strings, with no commentary."
    ]
  }, null, 2);
  return base + `

=== Next Choices guided generation ===
` + payload + `
=== End of Next Choices guided generation ===`;
}
// i18n/zh-tw.json
var zh_tw_default = {
  "Enable extension": "啟用擴充功能",
  "Auto-generate (create choices after each AI reply. You can always trigger manually from the wand menu)": "自動生成（AI 回覆後自動產生選項；也可隨時從魔杖選單手動生成）",
  "Send on click (by default the choice is inserted into the input box for editing)": "點選後直接送出（預設為填入輸入框可編輯）",
  "Show choice generation buttons beside the message box": "在訊息輸入框旁顯示生成選項按鈕",
  "Generation source": "生成來源",
  "This SillyTavern version does not support Connection Profile requests. Only 'Current connection settings' can be used.": "目前的 SillyTavern 版本不支援 Connection Profile 請求，僅能使用「目前連線設定」。",
  "Number of choices": "選項數量",
  "Max tokens": "最大 Token 數",
  "History depth": "參考歷史則數",
  "Prompt template": "Prompt 模板",
  "Available macros: ": "可用巨集：",
  " (recent conversation), ": "（最近對話）、",
  " (your persona description). Other SillyTavern macros are also supported. ": "（你的玩家角色描述）。也支援其他 SillyTavern 內建巨集。",
  ", ": "、",
  ". ": "。",
  "This request is never written into the chat log and does not affect the chat context.": "此請求不會寫入聊天記錄，不影響聊天上下文。",
  "Restore default template": "還原預設模板",
  "Generating choices…": "生成選項中…",
  "Stop generating": "停止生成",
  "Failed to generate choices: ": "選項生成失敗：",
  Retry: "重試",
  Regenerate: "重新生成",
  Dismiss: "收合",
  "Generate choices": "生成選項",
  "Current connection settings": "目前連線設定",
  "Connection profile returned an unrecognized response": "Connection profile 回傳了無法解讀的結果",
  "generateRaw is not available": "generateRaw 不可用",
  "generateRaw returned an unrecognized response": "generateRaw 回傳了無法解讀的結果",
  "Could not parse choices from the model response": "無法從模型回覆中解析出選項",
  "Failed to load the Next Choices settings panel.": "Next Choices 設定面板載入失敗。",
  Edit: "編輯",
  "Edit choice": "編輯選項",
  "Apply changes": "套用變更",
  "Reset changes": "重設變更",
  Enhance: "增強",
  "Enhance choices": "增強選項",
  "Enhancement prompt": "增強提示",
  "Keeps each choice's main content and adds your direction.": "保留每個選項的主要內容，並加入你的指示。",
  Close: "關閉",
  "Enhancing choices…": "增強選項中…",
  "Stop enhancing": "停止增強",
  "Apply or reset your edits before enhancing choices.": "增強選項前，請先套用或重設你的編輯。",
  "No conversation is available to enhance these choices.": "沒有可用於增強這些選項的對話。",
  "Failed to enhance choices: ": "增強選項失敗：",
  "Could not parse one enhanced choice for every original choice. Try again.": "無法為每個原始選項解析出一個增強後的選項，請再試一次。",
  "e.g. reassure her": "例如：安慰她",
  "e.g. have {name} reassure her": "例如：讓 {name} 安慰她",
  "Generate choices (guided)": "生成選項（引導式）",
  "Choice theme": "選項主題",
  "e.g. invite her to dance": "例如：邀她跳舞",
  "Use one main theme while keeping each choice's tone and approach from your prompt template.": "使用單一主要主題，同時保留 prompt 模板中每個選項的語氣與走向。",
  "No conversation is available to generate choices.": "沒有可用於生成選項的對話。",
  Combine: "合併",
  "Combine choices": "合併選項",
  "Combine selected": "合併所選選項",
  Cancel: "取消",
  "Select at least two choices to combine.": "請至少選擇兩個要合併的選項。",
  "Select choice {number} to combine": "選擇要合併的第 {number} 個選項",
  "{count} selected": "已選擇 {count} 個選項",
  "Combining choices…": "合併選項中…",
  "Stop combining": "停止合併",
  "Apply or reset your edits before combining choices.": "合併選項前，請先套用或重設你的編輯。",
  "No conversation is available to combine these choices.": "沒有可用於合併這些選項的對話。",
  "Failed to combine choices: ": "合併選項失敗：",
  "Could not parse one combined choice. Try again.": "無法解析出單一合併選項，請再試一次。"
};

// src/lumiverse/i18n.ts
var LUMIVERSE_ZH_TW = {
  "Auto-generate (create choices after each AI reply. You can always trigger manually from the input bar menu)": "自動生成（AI 回覆後自動產生選項；也可隨時從輸入列選單手動生成）",
  "Send failed: chat is busy": "送出失敗：聊天正忙碌中",
  "Send failed: ": "送出失敗：",
  "The message composer is not available.": "訊息輸入框目前無法使用。",
  " (your persona description). Other Lumiverse macros are also supported. ": "（你的玩家角色描述）。也支援其他 Lumiverse 內建巨集。",
  "Could not load the connection list.": "無法載入連線清單。",
  "The Next Choices backend did not respond": "Next Choices 後端沒有回應",
  Aborted: "已中止"
};
var TABLES = {
  "zh-TW": { ...zh_tw_default, ...LUMIVERSE_ZH_TW }
};
var currentLocale = "en";
function setLocale(locale) {
  currentLocale = locale || "en";
}
function getLocale() {
  return currentLocale;
}
function translate(locale, key, vars) {
  const text = TABLES[locale]?.[key] ?? key;
  if (!vars)
    return text;
  let result = text;
  for (const [name, value] of Object.entries(vars))
    result = result.replaceAll(`{${name}}`, String(value));
  return result;
}
function tr(key, vars) {
  return translate(currentLocale, key, vars);
}

// src/lumiverse/rpc.ts
var FRONTEND_TYPES = new Set([
  "load_settings",
  "save_settings",
  "get_context",
  "resolve_macros",
  "generate",
  "cancel"
]);
var BACKEND_TYPES = new Set([
  "hello",
  "settings",
  "context",
  "macros",
  "result",
  "error",
  "command"
]);
function hasKnownType(value, types) {
  return typeof value === "object" && value !== null && typeof value.type === "string" && types.has(value.type);
}
function isBackendMessage(value) {
  if (!hasKnownType(value, BACKEND_TYPES))
    return false;
  return value.type === "hello" || value.type === "command" || typeof value.requestId === "string";
}

// src/lumiverse/rpc-client.ts
class RpcError extends Error {
  aborted;
  constructor(message, aborted = false) {
    super(message);
    this.name = "RpcError";
    this.aborted = aborted;
  }
}
var DEFAULT_REQUEST_TIMEOUT_MS = 20000;
var LOAD_SETTINGS_TIMEOUT_MS = 1e4;
function defaultIdFactory() {
  let counter = 0;
  return () => {
    counter += 1;
    const cryptoApi = globalThis.crypto;
    return typeof cryptoApi?.randomUUID === "function" ? cryptoApi.randomUUID() : `nc-${Date.now().toString(36)}-${counter}`;
  };
}
function createRpcClient(transport, options = {}) {
  const newId = options.newId ?? defaultIdFactory();
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const pending = new Map;
  const commandHandlers = new Set;
  let disposed = false;
  function post(message) {
    transport.sendToBackend(message);
  }
  function handleMessage(payload) {
    if (disposed || !isBackendMessage(payload))
      return;
    if (payload.type === "hello") {
      for (const entry of [...pending.values()])
        entry.resend?.();
      return;
    }
    if (payload.type === "command") {
      for (const handler of [...commandHandlers])
        safely(() => handler(payload.id));
      return;
    }
    const entry = pending.get(payload.requestId);
    if (!entry)
      return;
    pending.delete(payload.requestId);
    entry.cleanup();
    if (payload.type === "error") {
      entry.reject(new RpcError(payload.message, payload.aborted));
    } else if (payload.type === entry.expect) {
      entry.resolve(payload);
    } else {
      entry.reject(new RpcError(`Unexpected backend reply "${payload.type}" (expected "${entry.expect}")`));
    }
  }
  const unsubscribe = transport.onBackendMessage(handleMessage);
  function request(build, expect, { timeoutMs = requestTimeoutMs, signal, resendOnHello = false } = {}) {
    if (disposed)
      return Promise.reject(new RpcError("RPC client was disposed", true));
    if (signal?.aborted)
      return Promise.reject(new RpcError("Aborted", true));
    const requestId = newId();
    return new Promise((resolve, reject) => {
      let timer;
      const onAbort = () => {
        if (!pending.delete(requestId))
          return;
        entry.cleanup();
        try {
          post({ type: "cancel", requestId: newId(), targetRequestId: requestId });
        } catch {}
        reject(new RpcError("Aborted", true));
      };
      const entry = {
        expect,
        resolve: (message) => resolve(message),
        reject,
        cleanup: () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
        }
      };
      if (resendOnHello) {
        entry.resend = () => {
          try {
            post(build(requestId));
          } catch {}
        };
      }
      pending.set(requestId, entry);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          if (!pending.delete(requestId))
            return;
          entry.cleanup();
          reject(new RpcError("The Next Choices backend did not respond"));
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
        const reply = await request((requestId) => ({ type: "load_settings", requestId }), "settings", {
          timeoutMs: LOAD_SETTINGS_TIMEOUT_MS,
          resendOnHello: true
        });
        return reply.settings;
      } catch {
        return null;
      }
    },
    async saveSettings(settings) {
      const reply = await request((requestId) => ({ type: "save_settings", requestId, settings }), "settings");
      return reply.settings;
    },
    getContext(chatId, characterId, historyDepth) {
      return request((requestId) => ({ type: "get_context", requestId, chatId, characterId, historyDepth }), "context");
    },
    async resolveMacros(template, chatId, characterId) {
      const reply = await request((requestId) => ({ type: "resolve_macros", requestId, template, chatId, characterId }), "macros");
      return reply.text;
    },
    async generate(prompt, connectionId, maxTokens, signal) {
      const reply = await request((requestId) => ({ type: "generate", requestId, prompt, connectionId, maxTokens }), "result", { timeoutMs: 0, signal });
      return reply.text;
    },
    onCommand(handler) {
      commandHandlers.add(handler);
      return () => void commandHandlers.delete(handler);
    },
    dispose() {
      if (disposed)
        return;
      disposed = true;
      unsubscribe();
      const entries = [...pending.values()];
      pending.clear();
      for (const entry of entries) {
        entry.cleanup();
        entry.reject(new RpcError("RPC client was disposed", true));
      }
      commandHandlers.clear();
    }
  };
}
function safely(fn) {
  try {
    fn();
  } catch (err) {
    console.error("[nextChoices] RPC listener failed:", err);
  }
}

// src/lumiverse/ui/dom.ts
function h(tag, options = {}) {
  const node = document.createElement(tag);
  if (options.id)
    node.id = options.id;
  if (options.className)
    node.className = options.className;
  if (options.text !== undefined)
    node.textContent = options.text;
  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs))
      node.setAttribute(name, value);
  }
  if (options.hidden)
    node.hidden = true;
  if (options.children) {
    for (const child of options.children) {
      if (child !== null && child !== undefined)
        node.append(child);
    }
  }
  return node;
}
function toolButton(className, text, attrs = {}) {
  return h("button", {
    className: `next-choices-tool ${className}`.trim(),
    text,
    attrs: { type: "button", ...attrs }
  });
}
function stopKeydown(node) {
  node.addEventListener("keydown", (event) => event.stopPropagation());
}
function isRendered(node) {
  return node instanceof HTMLElement && node.isConnected && node.getClientRects().length > 0;
}

// src/lumiverse/settings-panel.ts
function applySettingChange(settings, key, raw) {
  let next;
  switch (key) {
    case "enabled":
    case "autoGenerate":
    case "autoSend":
    case "showQuickGenerateButton":
      next = raw === true;
      break;
    case "profileId":
      next = normalizeProfileId(raw);
      break;
    case "numChoices":
      if (raw === null || raw === undefined)
        return false;
      next = normalizeNumChoices(raw);
      break;
    case "maxTokens":
      if (raw === null || raw === undefined)
        return false;
      next = normalizeMaxTokens(raw);
      break;
    case "historyDepth":
      if (raw === null || raw === undefined)
        return false;
      next = normalizeHistoryDepth(raw);
      break;
    case "promptTemplate":
      next = normalizePromptTemplate(raw);
      break;
    default:
      return false;
  }
  if (settings[key] === next)
    return false;
  settings[key] = next;
  return true;
}
function buildProfileOptions(tr, profiles, pendingId) {
  const options = [{ value: "current", label: tr("Current connection settings") }];
  for (const profile of profiles) {
    options.push({
      value: profile.id,
      label: profile.name || profile.id,
      ...profile.model ? { sublabel: profile.model } : {}
    });
  }
  if (pendingId && pendingId !== "current" && !profiles.some((profile) => profile.id === pendingId)) {
    options.push({ value: pendingId, label: pendingId });
  }
  return options;
}
function createSettingsPanel(deps) {
  const { components, settings } = deps;
  const tr = (key, vars) => deps.tr(key, vars);
  let destroyed = false;
  let profiles = [];
  let profilesLoaded = false;
  const wrapper = h("div", { className: "next-choices-settings" });
  const mountPoint = () => h("div");
  const disposables = [];
  const checkboxes = [];
  const checkboxSpecs = [
    { key: "enabled", label: "Enable extension" },
    {
      key: "autoGenerate",
      label: "Auto-generate (create choices after each AI reply. You can always trigger manually from the input bar menu)"
    },
    { key: "autoSend", label: "Send on click (by default the choice is inserted into the input box for editing)" },
    { key: "showQuickGenerateButton", label: "Show choice generation buttons beside the message box" }
  ];
  for (const spec of checkboxSpecs) {
    const target = mountPoint();
    wrapper.append(target);
    const handle = components.mountCheckbox(target, {
      checked: settings[spec.key],
      label: tr(spec.label),
      onChange: (checked) => change(spec.key, checked)
    });
    checkboxes.push({ key: spec.key, label: spec.label, handle });
    disposables.push(handle);
  }
  const sourceLabel = h("label", { text: tr("Generation source") });
  const sourceTarget = mountPoint();
  const sourceSelect = components.mountSelect(sourceTarget, {
    options: buildProfileOptions(tr, [], settings.profileId),
    value: settings.profileId,
    onChange: (value) => change("profileId", value)
  });
  disposables.push(sourceSelect);
  wrapper.append(h("div", { className: "next-choices-settings-field", children: [sourceLabel, sourceTarget] }));
  const numberSpecs = [
    { key: "numChoices", label: "Number of choices", min: 1, max: 10 },
    { key: "maxTokens", label: "Max tokens", min: 50, max: 4096 },
    { key: "historyDepth", label: "History depth", min: 1, max: 50 }
  ];
  const numberFields = [];
  const numberRow = h("div", { className: "next-choices-settings-row" });
  for (const spec of numberSpecs) {
    const labelNode = h("label", { text: tr(spec.label) });
    const target = mountPoint();
    const handle = components.mountNumericInput(target, {
      value: settings[spec.key],
      integer: true,
      min: spec.min,
      max: spec.max,
      ariaLabel: tr(spec.label),
      onChange: (value) => change(spec.key, value)
    });
    numberFields.push({ key: spec.key, label: spec.label, labelNode, handle });
    disposables.push(handle);
    numberRow.append(h("div", { className: "next-choices-settings-field", children: [labelNode, target] }));
  }
  wrapper.append(numberRow);
  const promptLabel = h("label", { text: tr("Prompt template") });
  const hint = h("small");
  function renderHint() {
    const code = (text) => h("code", { text });
    hint.replaceChildren(tr("Available macros: "), code("{{history}}"), tr(" (recent conversation), "), code("{{user}}"), tr(", "), code("{{char}}"), tr(", "), code("{{numChoices}}"), tr(", "), code("{{persona}}"), tr(" (your persona description). Other Lumiverse macros are also supported. "), tr("This request is never written into the chat log and does not affect the chat context."));
  }
  renderHint();
  const promptTarget = h("div", { className: "next-choices-prompt" });
  const promptArea = components.mountTextArea(promptTarget, {
    value: settings.promptTemplate,
    rows: 8,
    ariaLabel: tr("Prompt template"),
    onChange: (value) => change("promptTemplate", value)
  });
  disposables.push(promptArea);
  const resetButton = toolButton("next-choices-settings-reset", tr("Restore default template"));
  resetButton.addEventListener("click", () => {
    if (applySettingChange(settings, "promptTemplate", DEFAULT_PROMPT_TEMPLATE))
      deps.onChange("promptTemplate");
    promptArea.update({ value: DEFAULT_PROMPT_TEMPLATE });
  });
  wrapper.append(h("div", { className: "next-choices-settings-field", children: [promptLabel, hint, promptTarget, resetButton] }));
  deps.root.append(wrapper);
  function change(key, raw) {
    if (destroyed)
      return;
    if (applySettingChange(settings, key, raw))
      deps.onChange(key);
  }
  return {
    relabel() {
      if (destroyed)
        return;
      for (const box of checkboxes)
        box.handle.update({ label: tr(box.label) });
      sourceLabel.textContent = tr("Generation source");
      sourceSelect.update({ options: buildProfileOptions(tr, profilesLoaded ? profiles : [], settings.profileId) });
      for (const field of numberFields) {
        field.labelNode.textContent = tr(field.label);
        field.handle.update({ ariaLabel: tr(field.label) });
      }
      promptLabel.textContent = tr("Prompt template");
      promptArea.update({ ariaLabel: tr("Prompt template") });
      renderHint();
      resetButton.textContent = tr("Restore default template");
    },
    async refreshProfiles() {
      let listed;
      try {
        listed = await deps.listProfiles();
      } catch (err) {
        console.warn(`[nextChoices] ${tr("Could not load the connection list.")}`, err);
        return;
      }
      if (destroyed || listed === null)
        return;
      profiles = listed;
      profilesLoaded = true;
      if (settings.profileId !== "current" && !profiles.some((profile) => profile.id === settings.profileId)) {
        change("profileId", "current");
      }
      sourceSelect.update({ options: buildProfileOptions(tr, profiles), value: settings.profileId });
    },
    destroy() {
      if (destroyed)
        return;
      destroyed = true;
      for (const item of disposables) {
        try {
          item.destroy();
        } catch {}
      }
      wrapper.remove();
    }
  };
}

// src/lumiverse/styles.ts
var STYLES = `

#next_choices_container,
#next_choices_generation_guidance,
.next-choices-quick-generate,
.next-choices-settings {
    --nc-font-size: calc(14px * var(--lumiverse-font-scale, 1));
    --nc-border: var(--lumiverse-border, rgba(255, 255, 255, 0.2));
    --nc-text: var(--lumiverse-text, #eee);
    --nc-muted: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.65));
    --nc-surface: var(--lumiverse-fill-subtle, rgba(0, 0, 0, 0.3));
    --nc-hover: var(--lumiverse-fill, rgba(255, 255, 255, 0.12));
    --nc-accent: var(--lumiverse-primary, #8ab4f8);
    --nc-radius: var(--lumiverse-radius, 8px);
    --nc-radius-small: calc(var(--lumiverse-radius, 8px) * 0.75);
    --nc-transition: var(--lumiverse-transition-fast, 0.15s ease);
    --nc-danger: var(--lumiverse-danger, #e57373);
    --nc-warning: var(--lumiverse-warning, #e0a74c);
    font-family: var(--lumiverse-font-family, inherit);
}

#next_choices_container[hidden],
#next_choices_generation_guidance[hidden],
.next-choices-container[hidden],
.next-choices-container [hidden],
#next_choices_generation_guidance [hidden],
.next-choices-quick-generate[hidden] {
    display: none !important;
}

.next-choices-container {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    width: 100%;
    box-sizing: border-box;
    padding: 6px;
}

.next-choices-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
    flex: 1 1 auto;
    min-width: 0;
    max-height: min(42vh, 28rem);
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
    padding-right: 2px;
}

.next-choices-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 8px 12px;
    border: 1px solid var(--nc-border);
    border-radius: var(--nc-radius);
    background-color: var(--nc-surface);
    color: var(--nc-text);
    font-family: inherit;
    font-size: calc(var(--nc-font-size) * 0.95);
    line-height: 1.35;
    cursor: pointer;
    white-space: pre-wrap;
    word-break: break-word;
    transition: background-color var(--nc-transition), border-color var(--nc-transition), transform 0.1s ease;
}

.next-choices-item q {
    color: var(--nc-accent);
}

.next-choices-item q::before,
.next-choices-item q::after {
    content: none;
}

.next-choices-item em,
.next-choices-item i {
    color: inherit;
    font-style: italic;
}

.next-choices-item:hover,
.next-choices-item:focus-visible {
    background-color: var(--nc-hover);
    border-color: var(--nc-accent);
    transform: translateY(-1px);
}

.next-choices-item:active {
    transform: translateY(0);
}

.next-choices-toolbar {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
}

.next-choices-tool {
    border: 1px solid var(--nc-border);
    border-radius: var(--nc-radius-small);
    background-color: transparent;
    color: var(--nc-text);
    font-family: inherit;
    padding: 4px 7px;
    font-size: 0.85em;
    line-height: 1;
    cursor: pointer;
    opacity: 0.75;
    transition: opacity var(--nc-transition), background-color var(--nc-transition);
}

.next-choices-tool:hover {
    opacity: 1;
    background-color: var(--nc-hover);
}

.next-choices-regenerate,
.next-choices-dismiss {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 40px;
    width: 40px;
    min-width: 40px;
    height: 40px;
    min-height: 40px;
    padding: 0;
    font-size: 20px;
    line-height: 1;
}

.next-choices-loading {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1 1 auto;
    padding: 8px 12px;
    color: var(--nc-text);
    opacity: 0.8;
    font-size: calc(var(--nc-font-size) * 0.95);
    flex-wrap: wrap;
}

.next-choices-loading-label {
    flex: 1 1 180px;
}

.next-choices-stop {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    min-height: 40px;
    padding: 8px 10px;
    font-family: inherit;
    font-size: var(--nc-font-size);
    line-height: 1.2;
}

.next-choices-spinner {
    width: 14px;
    height: 14px;
    flex: 0 0 auto;
    border: 2px solid var(--nc-text);
    border-top-color: transparent;
    border-radius: 50%;
    animation: next-choices-spin 0.8s linear infinite;
}

@keyframes next-choices-spin {
    to {
        transform: rotate(360deg);
    }
}

.next-choices-error {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    flex: 1 1 auto;
    padding: 8px 12px;
    color: var(--nc-danger);
    font-size: calc(var(--nc-font-size) * 0.9);
}

.next-choices-notice {
    color: var(--nc-warning);
}

.next-choices-retry {
    flex: 0 0 auto;
    box-sizing: border-box;
    min-height: 32px;
    padding: 6px 10px;
    font-size: var(--nc-font-size);
    opacity: 1;
}

.next-choices-content {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-width: 0;
    gap: 6px;
}

.next-choices-guidance,
.next-choices-combine-panel {
    box-sizing: border-box;
    width: 100%;
    padding: 8px;
    border: 1px solid var(--nc-border);
    border-radius: var(--nc-radius);
    background-color: var(--nc-surface);
}

.next-choices-guidance[aria-busy='true'],
.next-choices-combine-panel[aria-busy='true'] {
    opacity: 0.75;
}

.next-choices-guidance > * + *,
.next-choices-combine-panel > * + * {
    margin-top: 6px;
}

.next-choices-guidance label,
.next-choices-guidance-hint,
.next-choices-guidance-status,
.next-choices-combine-hint,
.next-choices-combine-status {
    display: block;
    font-size: calc(var(--nc-font-size) * 0.85);
    color: var(--nc-text);
    opacity: 0.8;
}

.next-choices-guidance-status,
.next-choices-combine-status {
    min-height: 1.2em;
    overflow-wrap: anywhere;
}

.next-choices-guidance-status:empty,
.next-choices-combine-status:empty {
    display: none;
}

.next-choices-guidance-input,
.next-choices-edit-input {
    display: block;
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    max-width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--nc-border);
    border-radius: var(--nc-radius-small);
    background-color: var(--nc-surface);
    color: var(--nc-text);
    font-family: inherit;
    font-size: inherit;
    line-height: 1.35;
}

.next-choices-guidance-input {
    min-height: 4.5em;
}

.next-choices-edit-input {
    min-height: 6em;
}

.next-choices-guidance-input:focus-visible,
.next-choices-edit-input:focus-visible {
    outline: 2px solid var(--nc-accent);
    outline-offset: 1px;
}

.next-choices-guidance-actions,
.next-choices-combine-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.next-choices-enhance,
.next-choices-combine {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: auto;
    min-width: 64px;
    min-height: 40px;
    padding: 8px 10px;
    font-family: inherit;
    font-size: var(--nc-font-size);
    line-height: 1.2;
    text-align: center;
}

.next-choices-enhance-stop,
.next-choices-guidance-submit,
.next-choices-guidance-close,
.next-choices-combine-submit,
.next-choices-combine-stop,
.next-choices-combine-cancel {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 40px;
    padding: 8px 10px;
    font-family: inherit;
    font-size: var(--nc-font-size);
    line-height: 1.2;
}

.next-choices-combine-wrap {
    min-width: 0;
    white-space: normal;
}

.next-choices-select {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 40px;
    width: 40px;
    height: 40px;
    cursor: pointer;
}

.next-choices-select-input {
    width: 18px;
    height: 18px;
    margin: 0;
    accent-color: var(--nc-accent);
    cursor: pointer;
}

.next-choices-row-selected .next-choices-item {
    border-color: var(--nc-accent);
    background-color: var(--nc-hover);
}

.next-choices-list-locked .next-choices-item {
    cursor: default;
}

.next-choices-list-locked .next-choices-item:hover,
.next-choices-list-locked .next-choices-item:focus-visible {
    background-color: var(--nc-surface);
    border-color: var(--nc-border);
    transform: none;
}

.next-choices-list-locked .next-choices-item:active {
    transform: none;
}

.next-choices-row {
    display: flex;
    align-items: center;
    gap: 5px;
    width: 100%;
    min-width: 0;
}

.next-choices-row .next-choices-item {
    flex: 1 1 0;
    min-width: 0;
}

.next-choices-edit {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    align-self: center;
    min-width: 64px;
    min-height: 40px;
    padding: 8px 10px;
    font-family: inherit;
    font-size: var(--nc-font-size);
    line-height: 1.2;
    text-align: center;
}

.next-choices-editor {
    flex: 1 1 100%;
    min-width: 0;
}

.next-choices-edit-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
}

.next-choices-apply {
    border-color: rgba(95, 158, 110, 0.55);
    background-color: rgba(95, 158, 110, 0.16);
    color: #7fbf8a;
    opacity: 1;
}

.next-choices-apply:hover {
    border-color: rgba(95, 158, 110, 0.85);
    background-color: rgba(95, 158, 110, 0.3);
    opacity: 1;
}

.next-choices-reset {
    border-color: rgba(186, 108, 108, 0.55);
    background-color: rgba(186, 108, 108, 0.16);
    color: #d99292;
    opacity: 1;
}

.next-choices-reset:hover {
    border-color: rgba(186, 108, 108, 0.85);
    background-color: rgba(186, 108, 108, 0.3);
    opacity: 1;
}

.next-choices-stop:focus-visible,
.next-choices-enhance-stop:focus-visible,
.next-choices-enhance:focus-visible,
.next-choices-combine:focus-visible,
.next-choices-combine-submit:focus-visible,
.next-choices-combine-stop:focus-visible,
.next-choices-combine-cancel:focus-visible,
.next-choices-select-input:focus-visible,
.next-choices-guidance-submit:focus-visible,
.next-choices-guidance-close:focus-visible,
.next-choices-regenerate:focus-visible,
.next-choices-dismiss:focus-visible,
.next-choices-retry:focus-visible,
.next-choices-quick-generate:focus-visible,
.next-choices-edit:focus-visible,
.next-choices-apply:focus-visible,
.next-choices-reset:focus-visible {
    opacity: 1;
    outline: 2px solid var(--nc-accent);
    outline-offset: 1px;
}

.next-choices-apply:disabled,
.next-choices-enhance:disabled,
.next-choices-combine:disabled,
.next-choices-combine-submit:disabled,
.next-choices-combine-stop:disabled,
.next-choices-combine-cancel:disabled,
.next-choices-select-input:disabled,
.next-choices-guidance-submit:disabled,
.next-choices-guidance-close:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.next-choices-quick-generate {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: auto;
    min-width: 0;
    height: auto;
    min-height: 0;
    margin: 0 2px;
    padding: 5px 8px;
    font-size: 1.1em;
    line-height: 1;
    opacity: 1;
}

#next_choices_generation_guidance {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    min-width: 0;
    padding: 5px 6px;
    white-space: normal;
}

#next_choices_generation_guidance .next-choices-guidance {
    max-width: 100%;
}

#next_choices_generation_guidance .next-choices-guidance-input:disabled {
    opacity: 0.6;
}

.next-choices-settings {
    display: flex;
    flex-direction: column;
    gap: 12px;
    color: var(--nc-text);
    font-size: var(--nc-font-size);
}

.next-choices-settings-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
}

.next-choices-settings-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1 1 120px;
    min-width: 100px;
}

.next-choices-settings-field > label,
.next-choices-settings-label {
    font-weight: 600;
}

.next-choices-settings small {
    display: block;
    color: var(--nc-muted);
    margin-bottom: 4px;
}

.next-choices-settings small code {
    font-family: var(--lumiverse-font-mono, monospace);
}

.next-choices-prompt textarea {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--lumiverse-font-mono, monospace);
    font-size: calc(var(--nc-font-size) * 0.85);
}

.next-choices-settings-reset {
    width: fit-content;
    box-sizing: border-box;
    min-height: 32px;
    padding: 6px 10px;
    font-size: var(--nc-font-size);
    opacity: 1;
}

@media screen and (max-width: 600px) {
    .next-choices-container {
        flex-direction: column;
    }

    .next-choices-content {
        width: 100%;
    }

    .next-choices-toolbar {
        flex-direction: row;
        align-self: flex-end;
        flex-wrap: wrap;
        max-width: 100%;
    }

    .next-choices-item {
        padding: 10px 12px;
        min-height: 40px;
    }

    .next-choices-list {
        width: 100%;
    }

    .next-choices-edit,
    .next-choices-apply,
    .next-choices-reset,
    .next-choices-enhance,
    .next-choices-guidance-submit,
    .next-choices-guidance-close {
        min-height: 40px;
    }
}
`;

// src/shared/format.ts
var ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};
function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}
function formatChoiceHtml(text) {
  return escapeHtml(text).replace(/\*\*\*(?=\S)(.+?)(?<=\S)\*\*\*/g, "<strong><em>$1</em></strong>").replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "<strong>$1</strong>").replace(/\*(?=\S)(.+?)(?<=\S)\*/g, "<em>$1</em>").replace(/__(?=\S)(.+?)(?<=\S)__/g, "<u>$1</u>").replace(/&quot;(.+?)&quot;/g, "<q>&quot;$1&quot;</q>").replace(/“(.+?)”/g, "<q>“$1”</q>").replace(/\r?\n/g, "<br>");
}

// src/lumiverse/ui/choice-logic.ts
function mergeCombined(originals, selectedIndexes, rewritten) {
  const selected = new Set([...selectedIndexes].filter((index) => Number.isInteger(index) && index >= 0 && index < originals.length));
  const sorted = [...selected].sort((a, b) => a - b);
  const insertionIndex = sorted[0] ?? 0;
  const choices = [];
  originals.forEach((choice, index) => {
    if (index === insertionIndex)
      choices.push(rewritten);
    else if (!selected.has(index))
      choices.push(choice);
  });
  return { choices, insertionIndex };
}
function selectedInOrder(selected, count) {
  return [...new Set(selected)].filter((index) => Number.isInteger(index) && index >= 0 && index < count).sort((a, b) => a - b);
}

// src/lumiverse/ui/types.ts
class NoConversationError extends Error {
  constructor() {
    super("No conversation is available");
    this.name = "NoConversationError";
  }
}

// src/lumiverse/ui/choices-ui.ts
var CONTAINER_ID = "next_choices_container";
function createChoicesUi(deps) {
  const { tr } = deps;
  function clear() {
    const container = deps.peekContainer();
    if (!container)
      return;
    container.replaceChildren();
    container.hidden = true;
  }
  function makeToolbar(options) {
    const toolbar = h("div", { className: "next-choices-toolbar" });
    if (options.regenerate) {
      const regenerate = toolButton("next-choices-regenerate", "♻️", {
        title: tr("Regenerate"),
        "aria-label": tr("Regenerate")
      });
      regenerate.addEventListener("click", () => deps.regenerate(options.generationGuidance));
      toolbar.append(regenerate);
    }
    let enhance = null;
    if (options.onEnhance) {
      const onEnhance = options.onEnhance;
      enhance = toolButton("next-choices-enhance", tr("Enhance"), {
        title: tr("Enhance choices"),
        "aria-label": tr("Enhance choices"),
        "aria-controls": "next_choices_guidance_panel",
        "aria-expanded": "false"
      });
      enhance.addEventListener("click", () => onEnhance());
      toolbar.append(enhance);
    }
    let combine = null;
    if (options.onCombine) {
      const onCombine = options.onCombine;
      combine = toolButton("next-choices-combine", tr("Combine"), {
        title: tr("Combine choices"),
        "aria-label": tr("Combine choices"),
        "aria-controls": "next_choices_combine_panel",
        "aria-expanded": "false"
      });
      combine.addEventListener("click", () => onCombine());
      stopKeydown(combine);
      toolbar.append(combine);
    }
    const dismiss = toolButton("next-choices-dismiss", "✖", {
      title: tr("Dismiss"),
      "aria-label": tr("Dismiss")
    });
    dismiss.addEventListener("click", () => clear());
    toolbar.append(dismiss);
    return { toolbar, enhance, combine };
  }
  function renderLoading(handle, focusTarget) {
    const container = deps.getContainer();
    if (!container)
      return;
    container.replaceChildren();
    container.hidden = false;
    const stop = toolButton("next-choices-stop", tr("Stop generating"), { "aria-label": tr("Stop generating") });
    const loading = h("div", {
      className: "next-choices-loading",
      children: [
        h("span", { className: "next-choices-spinner" }),
        h("span", { className: "next-choices-loading-label", text: tr("Generating choices…") }),
        stop
      ]
    });
    stop.addEventListener("click", () => {
      if (!handle.isCurrent() || !container.isConnected || loading.parentElement !== container)
        return;
      deps.cancelAutoTimer();
      deps.abortPending();
      clear();
      deps.restoreFocusAfterStop(focusTarget);
    });
    container.append(loading);
  }
  function renderError(message, generationGuidance = "") {
    const container = deps.getContainer();
    if (!container)
      return;
    container.replaceChildren();
    container.hidden = false;
    const retry = toolButton("next-choices-retry", tr("Retry"));
    retry.addEventListener("click", () => deps.regenerate(generationGuidance));
    const error = h("div", {
      className: "next-choices-error",
      attrs: { role: "alert" },
      children: [h("span", { text: tr("Failed to generate choices: ") + message }), retry]
    });
    container.append(error, makeToolbar({ regenerate: true, generationGuidance }).toolbar);
  }
  function renderNotice(message) {
    const container = deps.getContainer();
    if (!container)
      return;
    container.replaceChildren();
    container.hidden = false;
    const notice = h("div", {
      className: "next-choices-error next-choices-notice",
      attrs: { role: "status" },
      children: [h("span", { text: message })]
    });
    container.append(notice, makeToolbar({ regenerate: false, generationGuidance: "" }).toolbar);
  }
  function renderChoices(choices, generationGuidance = "") {
    const container = deps.getContainer();
    if (!container)
      return;
    const view = container;
    container.replaceChildren();
    container.hidden = false;
    const currentChoices = choices.map((choice) => String(choice ?? ""));
    let openEditors = 0;
    let enhancementBusy = false;
    let combinationOpen = false;
    let combinationBusy = false;
    let enhancementHandle = null;
    let combinationHandle = null;
    const selectedChoiceIndexes = new Set;
    const rowRefs = [];
    const list = h("div", { className: "next-choices-list" });
    const content = h("div", { className: "next-choices-content" });
    const isViewCurrent = () => container.isConnected && content.parentElement === container && container.firstElementChild === content;
    currentChoices.forEach((_, index) => {
      const number = index + 1;
      const row = h("div", { className: "next-choices-row" });
      const checkbox = h("input", {
        className: "next-choices-select-input",
        attrs: {
          type: "checkbox",
          "aria-label": tr("Select choice {number} to combine", { number })
        }
      });
      const select = h("label", { className: "next-choices-select", hidden: true, children: [checkbox] });
      checkbox.addEventListener("change", () => toggleCombinationChoice(index));
      stopKeydown(checkbox);
      const item = h("button", { className: "next-choices-item", attrs: { type: "button" } });
      const renderPreview = () => {
        item.innerHTML = formatChoiceHtml(currentChoices[index]);
      };
      renderPreview();
      item.addEventListener("click", () => {
        if (combinationOpen)
          toggleCombinationChoice(index);
        else
          deps.applyChoice(currentChoices[index]);
      });
      item.addEventListener("keydown", (event) => {
        if (combinationOpen)
          event.stopPropagation();
      });
      const editLabel = `${tr("Edit choice")} ${number}`;
      const edit = toolButton("next-choices-edit", tr("Edit"), { "aria-label": editLabel });
      const input = h("textarea", {
        className: "next-choices-edit-input",
        attrs: { rows: "4", "aria-label": editLabel }
      });
      stopKeydown(input);
      const apply = toolButton("next-choices-apply", tr("Apply changes"));
      const reset = toolButton("next-choices-reset", tr("Reset changes"));
      const editor = h("div", {
        className: "next-choices-editor",
        hidden: true,
        children: [input, h("div", { className: "next-choices-edit-actions", children: [apply, reset] })]
      });
      const refreshApplyState = () => {
        apply.disabled = input.value.trim().length === 0;
      };
      input.addEventListener("input", refreshApplyState);
      const setEditing = (editing) => {
        if (editing) {
          openEditors++;
          item.hidden = true;
          edit.hidden = true;
          editor.hidden = false;
          input.focus();
        } else {
          openEditors = Math.max(0, openEditors - 1);
          editor.hidden = true;
          item.hidden = false;
          edit.hidden = false;
        }
        refreshGuidanceAvailability();
        refreshCombinationAvailability();
      };
      edit.addEventListener("click", () => {
        input.value = currentChoices[index];
        refreshApplyState();
        setEditing(true);
      });
      apply.addEventListener("click", () => {
        const draft = input.value;
        if (!draft.trim())
          return;
        currentChoices[index] = draft;
        renderPreview();
        setEditing(false);
        edit.focus();
      });
      reset.addEventListener("click", () => {
        input.value = "";
        setEditing(false);
        edit.focus();
      });
      row.append(select, item, edit, editor);
      list.append(row);
      rowRefs.push({ row, item, edit, select, checkbox });
    });
    const toolbar = makeToolbar({
      regenerate: true,
      generationGuidance,
      onEnhance: () => {
        if (enhancementBusy || combinationOpen || combinationBusy)
          return;
        setPanelOpen(guidanceWrap.hidden);
      },
      onCombine: () => setCombinationOpen(!combinationOpen)
    });
    const enhanceButton = toolbar.enhance;
    const combineButton = toolbar.combine;
    const guidanceInput = h("textarea", {
      id: "next_choices_guidance_input",
      className: "next-choices-guidance-input",
      attrs: { rows: "3" }
    });
    stopKeydown(guidanceInput);
    const status = h("div", {
      className: "next-choices-guidance-status",
      attrs: { role: "status", "aria-live": "polite" }
    });
    const setStatus = (message) => {
      status.textContent = message;
    };
    const submit = toolButton("next-choices-guidance-submit", tr("Enhance choices"));
    const stopEnhance = toolButton("next-choices-enhance-stop", tr("Stop enhancing"));
    stopEnhance.hidden = true;
    const panelClose = toolButton("next-choices-guidance-close", tr("Close"));
    const panel = h("div", {
      id: "next_choices_guidance_panel",
      className: "next-choices-guidance",
      children: [
        h("label", { text: tr("Enhancement prompt"), attrs: { for: "next_choices_guidance_input" } }),
        guidanceInput,
        h("div", {
          className: "next-choices-guidance-hint",
          text: tr("Keeps each choice's main content and adds your direction.")
        }),
        h("div", { className: "next-choices-guidance-actions", children: [submit, stopEnhance, panelClose] })
      ]
    });
    const guidanceWrap = h("div", {
      className: "next-choices-guidance-wrap",
      hidden: true,
      children: [panel, status]
    });
    function placeholderExemplar() {
      const name = deps.getUserName().trim();
      return name ? tr("e.g. have {name} reassure her", { name }) : tr("e.g. reassure her");
    }
    function setPanelControlsDisabled(disabled) {
      guidanceInput.disabled = disabled;
      submit.disabled = disabled;
      panelClose.disabled = disabled;
    }
    function refreshGuidanceAvailability() {
      const hasGuidance = guidanceInput.value.trim().length > 0;
      const editing = openEditors > 0;
      const busy = enhancementBusy || combinationBusy;
      submit.disabled = busy || combinationOpen || !hasGuidance || editing;
      if (editing)
        setStatus(tr("Apply or reset your edits before enhancing choices."));
      else if (!busy)
        setStatus("");
    }
    guidanceInput.addEventListener("input", refreshGuidanceAvailability);
    function setPanelOpen(open) {
      guidanceWrap.hidden = !open;
      enhanceButton.setAttribute("aria-expanded", String(open));
      if (open) {
        guidanceInput.placeholder = placeholderExemplar();
        guidanceInput.focus();
      } else {
        enhanceButton.focus();
      }
    }
    panelClose.addEventListener("click", () => {
      if (!enhancementBusy)
        setPanelOpen(false);
    });
    function setRowsInteractive(interactive) {
      for (const row of rowRefs) {
        row.item.disabled = !interactive;
        row.checkbox.disabled = !interactive;
        row.edit.disabled = !interactive || combinationOpen;
      }
    }
    function setBusy(busy) {
      enhancementBusy = busy;
      setRowsInteractive(!busy);
      list.classList.toggle("next-choices-list-locked", busy);
      enhanceButton.disabled = busy || combinationOpen || combinationBusy;
      panel.setAttribute("aria-busy", busy ? "true" : "false");
      setPanelControlsDisabled(busy);
      stopEnhance.hidden = !busy;
      refreshCombinationAvailability();
      if (busy)
        setStatus(tr("Enhancing choices…"));
      else
        refreshGuidanceAvailability();
    }
    async function enhanceDisplayedChoices() {
      if (enhancementBusy || combinationOpen || combinationBusy)
        return;
      if (!isViewCurrent() || !deps.isEnabled())
        return;
      const guidance = guidanceInput.value.trim();
      if (!guidance)
        return;
      if (openEditors > 0) {
        refreshGuidanceAvailability();
        return;
      }
      const originals = currentChoices.slice();
      deps.cancelAutoTimer();
      const handle = deps.beginRequest();
      enhancementHandle = handle;
      setBusy(true);
      let response;
      try {
        response = await deps.runRewrite(handle, { kind: "enhance", originals, guidance });
      } catch (err) {
        if (!handle.isCurrent())
          return;
        if (!isViewCurrent())
          return;
        setBusy(false);
        if (err instanceof NoConversationError) {
          setStatus(tr("No conversation is available to enhance these choices."));
          return;
        }
        console.error("[nextChoices] Enhancement failed:", err);
        setStatus(tr("Failed to enhance choices: ") + errorMessage(err));
        return;
      }
      if (!handle.isCurrent())
        return;
      if (!isViewCurrent())
        return;
      const enhanced = parseRewrittenChoices(response, originals.length);
      if (!enhanced) {
        setBusy(false);
        setStatus(tr("Could not parse one enhanced choice for every original choice. Try again."));
        return;
      }
      renderChoices(enhanced, generationGuidance);
      view.querySelector(".next-choices-enhance")?.focus();
    }
    submit.addEventListener("click", () => void enhanceDisplayedChoices());
    stopEnhance.addEventListener("click", () => {
      if (!enhancementBusy || enhancementHandle === null || !enhancementHandle.isCurrent() || !isViewCurrent())
        return;
      deps.cancelAutoTimer();
      deps.abortPending();
      setBusy(false);
      guidanceInput.focus();
    });
    const combineHint = h("div", {
      className: "next-choices-combine-hint",
      text: tr("Select at least two choices to combine.")
    });
    const combineSubmit = toolButton("next-choices-combine-submit", tr("Combine selected"));
    combineSubmit.disabled = true;
    const combineStop = toolButton("next-choices-combine-stop", tr("Stop combining"));
    combineStop.hidden = true;
    const combineCancel = toolButton("next-choices-combine-cancel", tr("Cancel"));
    for (const control of [combineSubmit, combineStop, combineCancel])
      stopKeydown(control);
    const combinationPanel = h("div", {
      id: "next_choices_combine_panel",
      className: "next-choices-combine-panel",
      children: [
        combineHint,
        h("div", { className: "next-choices-combine-actions", children: [combineSubmit, combineStop, combineCancel] })
      ]
    });
    const combineStatus = h("div", {
      className: "next-choices-combine-status",
      attrs: { role: "status", "aria-live": "polite" }
    });
    const combinationWrap = h("div", {
      className: "next-choices-combine-wrap",
      hidden: true,
      children: [combinationPanel, combineStatus]
    });
    combineCancel.addEventListener("click", () => setCombinationOpen(false));
    function refreshCombinationAvailability() {
      const editing = openEditors > 0;
      const busy = enhancementBusy || combinationBusy;
      combineButton.disabled = busy || editing || currentChoices.length < 2;
      combineButton.title = editing ? tr("Apply or reset your edits before combining choices.") : currentChoices.length < 2 ? tr("Select at least two choices to combine.") : tr("Combine choices");
      combineSubmit.disabled = !combinationOpen || busy || editing || selectedChoiceIndexes.size < 2;
    }
    function toggleCombinationChoice(index) {
      if (!combinationOpen || combinationBusy || !isViewCurrent())
        return;
      if (selectedChoiceIndexes.has(index))
        selectedChoiceIndexes.delete(index);
      else
        selectedChoiceIndexes.add(index);
      const selected = selectedChoiceIndexes.has(index);
      const row = rowRefs[index];
      row.checkbox.checked = selected;
      row.item.setAttribute("aria-pressed", String(selected));
      row.row.classList.toggle("next-choices-row-selected", selected);
      combineStatus.textContent = tr("{count} selected", { count: selectedChoiceIndexes.size });
      refreshCombinationAvailability();
    }
    function setCombinationOpen(open) {
      if (!isViewCurrent() || combinationBusy)
        return;
      if (open && (currentChoices.length < 2 || enhancementBusy || openEditors > 0))
        return;
      if (open && !guidanceWrap.hidden)
        setPanelOpen(false);
      combinationOpen = open;
      selectedChoiceIndexes.clear();
      combineStatus.textContent = "";
      combinationWrap.hidden = !open;
      combineButton.setAttribute("aria-expanded", String(open));
      for (const row of rowRefs) {
        row.select.hidden = !open;
        row.checkbox.checked = false;
        row.row.classList.remove("next-choices-row-selected");
        if (open)
          row.item.setAttribute("aria-pressed", "false");
        else
          row.item.removeAttribute("aria-pressed");
      }
      setRowsInteractive(true);
      enhanceButton.disabled = open;
      refreshGuidanceAvailability();
      refreshCombinationAvailability();
      if (open)
        rowRefs[0].checkbox.focus();
      else
        combineButton.focus();
    }
    function setCombinationBusy(busy) {
      combinationBusy = busy;
      setRowsInteractive(!busy);
      list.classList.toggle("next-choices-list-locked", busy);
      enhanceButton.disabled = busy || combinationOpen;
      setPanelControlsDisabled(busy);
      combinationPanel.setAttribute("aria-busy", String(busy));
      combineCancel.disabled = busy;
      combineStop.hidden = !busy;
      refreshGuidanceAvailability();
      refreshCombinationAvailability();
      if (busy) {
        combineStatus.textContent = tr("Combining choices…");
        combineStop.focus();
      } else {
        combineStatus.textContent = tr("{count} selected", { count: selectedChoiceIndexes.size });
      }
    }
    async function combineDisplayedChoices() {
      if (!deps.isEnabled() || !isViewCurrent() || !combinationOpen)
        return;
      if (enhancementBusy || combinationBusy || openEditors > 0)
        return;
      const selectedIndexes = selectedInOrder(selectedChoiceIndexes, currentChoices.length);
      if (selectedIndexes.length < 2)
        return;
      const originals = currentChoices.slice();
      const selected = selectedIndexes.map((index) => originals[index]);
      deps.cancelAutoTimer();
      const handle = deps.beginRequest();
      combinationHandle = handle;
      setCombinationBusy(true);
      let response;
      try {
        response = await deps.runRewrite(handle, { kind: "combine", selected });
      } catch (err) {
        if (!handle.isCurrent())
          return;
        if (!isViewCurrent())
          return;
        setCombinationBusy(false);
        if (err instanceof NoConversationError) {
          combineStatus.textContent = tr("No conversation is available to combine these choices.");
        } else {
          console.error("[nextChoices] Combination failed:", err);
          combineStatus.textContent = tr("Failed to combine choices: ") + errorMessage(err);
        }
        combineSubmit.focus();
        return;
      }
      if (!handle.isCurrent())
        return;
      if (!isViewCurrent())
        return;
      const rewritten = parseRewrittenChoices(response, 1);
      if (!rewritten) {
        setCombinationBusy(false);
        combineStatus.textContent = tr("Could not parse one combined choice. Try again.");
        combineSubmit.focus();
        return;
      }
      const merged = mergeCombined(originals, selectedIndexes, rewritten[0]);
      renderChoices(merged.choices, generationGuidance);
      view.querySelectorAll(".next-choices-item")[merged.insertionIndex]?.focus();
    }
    combineSubmit.addEventListener("click", () => void combineDisplayedChoices());
    combineStop.addEventListener("click", () => {
      if (!combinationBusy || combinationHandle === null || !combinationHandle.isCurrent() || !isViewCurrent())
        return;
      deps.cancelAutoTimer();
      deps.abortPending();
      setCombinationBusy(false);
      combineSubmit.focus();
    });
    content.append(list, guidanceWrap, combinationWrap);
    container.append(content, toolbar.toolbar);
    refreshGuidanceAvailability();
    refreshCombinationAvailability();
  }
  return { clear, renderLoading, renderError, renderNotice, renderChoices };
}

// src/lumiverse/ui/event-filter.ts
var DEDUPE_WINDOW_MS = 2000;
var AUTO_GENERATE_DEBOUNCE_MS = 300;
var MAX_REMEMBERED_GENERATIONS = 64;
function createEventFilter(deps) {
  const now = deps.now ?? Date.now;
  const extensionGenerations = new Set;
  const handledEnds = new Map;
  const endedMessages = new Map;
  function remember(map, key, at) {
    map.set(key, at);
    if (map.size > 256) {
      for (const [oldKey, oldAt] of map) {
        if (at - oldAt > DEDUPE_WINDOW_MS)
          map.delete(oldKey);
      }
    }
  }
  function seenRecently(map, key, at) {
    const seen = map.get(key);
    return seen !== undefined && at - seen <= DEDUPE_WINDOW_MS;
  }
  function isOtherChat(payload) {
    const chatId = asString(payload.chatId);
    const active = deps.getActiveChatId();
    return chatId !== null && active !== null && chatId !== active;
  }
  return {
    onGenerationStarted(payload) {
      const record = asRecord(payload);
      if (!record)
        return "reset";
      const generationId = asString(record.generationId);
      if (asString(record.extensionId)) {
        if (generationId) {
          extensionGenerations.add(generationId);
          if (extensionGenerations.size > MAX_REMEMBERED_GENERATIONS) {
            extensionGenerations.delete(extensionGenerations.values().next().value);
          }
        }
        return "ignore";
      }
      return isOtherChat(record) ? "ignore" : "reset";
    },
    onGenerationEnded(payload) {
      const record = asRecord(payload);
      if (!record || record.error)
        return "ignore";
      if (asString(record.generationType) === "impersonate")
        return "ignore";
      const generationId = asString(record.generationId);
      if (generationId && extensionGenerations.has(generationId))
        return "ignore";
      const messageId = asString(record.messageId);
      const chatId = asString(record.chatId);
      const active = deps.getActiveChatId();
      if (!messageId || !chatId || !active || chatId !== active)
        return "ignore";
      const at = now();
      const swipeId = record.swipeId ?? record.swipe_id;
      const messageKey = `${messageId}:${swipeId === undefined || swipeId === null ? "" : String(swipeId)}`;
      const generationKey = generationId ? `gen:${generationId}` : null;
      const duplicate = seenRecently(handledEnds, messageKey, at) || generationKey !== null && seenRecently(handledEnds, generationKey, at);
      remember(endedMessages, messageId, at);
      if (duplicate)
        return "ignore";
      remember(handledEnds, messageKey, at);
      if (generationKey)
        remember(handledEnds, generationKey, at);
      return "generate";
    },
    onMessageSwiped(payload) {
      const record = asRecord(payload);
      if (!record)
        return "clear";
      if (isOtherChat(record))
        return "ignore";
      const action = asString(record.action);
      if (action === "navigated")
        return "clear-and-rearm";
      if (action === "added") {
        const messageId = asString(asRecord(record.message)?.id);
        if (messageId && seenRecently(endedMessages, messageId, now()))
          return "ignore";
      }
      return "clear";
    },
    onMessageMutated(payload) {
      const record = asRecord(payload);
      if (record && isOtherChat(record))
        return "ignore";
      return "clear";
    }
  };
}
function chatIdFromChatChanged(payload) {
  const record = asRecord(payload);
  if (!record)
    return null;
  return asString(record.chatId) ?? asString(asRecord(record.chat)?.id);
}
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
function asString(value) {
  return typeof value === "string" && value !== "" ? value : null;
}

// src/lumiverse/ui/guidance-editor.ts
var GUIDANCE_WRAPPER_ID = "next_choices_generation_guidance";
var GUIDANCE_PANEL_ID = "next_choices_generation_guidance_panel";
var GUIDANCE_INPUT_ID = "next_choices_theme_input";
function createGuidanceEditor(deps) {
  const { tr } = deps;
  const input = h("textarea", {
    id: GUIDANCE_INPUT_ID,
    className: "next-choices-guidance-input",
    attrs: { rows: "3", placeholder: tr("e.g. invite her to dance") }
  });
  const submit = toolButton("next-choices-guidance-submit", tr("Generate choices (guided)"));
  const close = toolButton("next-choices-guidance-close", tr("Close"));
  const panel = h("div", {
    id: GUIDANCE_PANEL_ID,
    className: "next-choices-guidance",
    children: [
      h("label", { text: tr("Choice theme"), attrs: { for: GUIDANCE_INPUT_ID } }),
      input,
      h("div", {
        className: "next-choices-guidance-hint",
        text: tr("Use one main theme while keeping each choice's tone and approach from your prompt template.")
      }),
      h("div", { className: "next-choices-guidance-actions", children: [submit, close] })
    ]
  });
  const status = h("div", {
    className: "next-choices-guidance-status",
    attrs: { role: "status", "aria-live": "polite" }
  });
  const wrapper = h("div", {
    id: GUIDANCE_WRAPPER_ID,
    className: "next-choices-guidance-wrap",
    hidden: true,
    children: [panel, status]
  });
  let open = false;
  let busy = false;
  let opener = null;
  function refreshSubmitState() {
    submit.disabled = busy || input.value.trim().length === 0;
  }
  stopKeydown(input);
  input.addEventListener("input", refreshSubmitState);
  submit.addEventListener("click", () => {
    if (busy)
      return;
    const theme = input.value.trim();
    if (!theme)
      return;
    deps.onSubmit(theme);
  });
  close.addEventListener("click", () => editor.setOpen(false));
  const editor = {
    wrapper,
    isOpen: () => open,
    setOpen(next, newOpener = null) {
      if (!next) {
        const focusInside = wrapper.contains(document.activeElement);
        wrapper.hidden = true;
        open = false;
        deps.onOpenChange(false);
        if (focusInside)
          deps.restoreFocus(opener);
        return true;
      }
      if (newOpener)
        opener = newOpener;
      deps.place(wrapper);
      if (!wrapper.isConnected)
        return false;
      wrapper.hidden = false;
      open = true;
      deps.onOpenChange(true);
      refreshSubmitState();
      input.focus();
      return true;
    },
    setBusy(next) {
      busy = next;
      panel.setAttribute("aria-busy", next ? "true" : "false");
      input.disabled = next;
      status.textContent = next ? tr("Generating choices…") : "";
      refreshSubmitState();
    },
    setStatus(message) {
      status.textContent = message;
    },
    destroy() {
      input.value = "";
      wrapper.remove();
      open = false;
      busy = false;
    }
  };
  refreshSubmitState();
  return editor;
}

// src/lumiverse/ui/icons.ts
var SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
var DICE_SVG = SVG_OPEN + '<rect x="3" y="3" width="18" height="18" rx="3"/>' + '<circle cx="8.5" cy="8.5" r="1" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1" fill="currentColor"/>' + '<circle cx="12" cy="12" r="1" fill="currentColor"/>' + '<circle cx="8.5" cy="15.5" r="1" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1" fill="currentColor"/></svg>';
var COMPASS_SVG = SVG_OPEN + '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>';

// src/lumiverse/ui/quick-buttons.ts
var QUICK_BUTTON_ID = "next_choices_quick_generate";
var GUIDED_BUTTON_ID = "next_choices_guided_generate";
function createQuickButtons(deps) {
  const { tr } = deps;
  let root = null;
  let dice = null;
  let compass = null;
  let guidedExpanded = false;
  function create() {
    dice = toolButton("next-choices-quick-generate", "\uD83C\uDFB2", { id: QUICK_BUTTON_ID });
    dice.addEventListener("click", () => {
      if (!deps.isWanted())
        return;
      deps.onGenerate();
    });
    compass = toolButton("next-choices-quick-generate", "\uD83E\uDDED", {
      id: GUIDED_BUTTON_ID,
      "aria-controls": "next_choices_generation_guidance",
      "aria-expanded": String(guidedExpanded)
    });
    compass.addEventListener("click", () => {
      if (!deps.isWanted())
        return;
      deps.onGuided(compass);
    });
    relabel();
  }
  function relabel() {
    dice?.setAttribute("title", tr("Generate choices"));
    dice?.setAttribute("aria-label", tr("Generate choices"));
    compass?.setAttribute("title", tr("Generate choices (guided)"));
    compass?.setAttribute("aria-label", tr("Generate choices (guided)"));
  }
  function remove() {
    dice?.remove();
    compass?.remove();
    dice = null;
    compass = null;
  }
  return {
    sync() {
      if (!deps.isWanted()) {
        remove();
        return;
      }
      if (!root || !root.isConnected) {
        let next = null;
        try {
          next = deps.mount();
        } catch (err) {
          console.warn("[nextChoices] Could not mount the quick generate buttons:", err);
        }
        root = next;
      }
      if (!root)
        return;
      if (!dice || !compass)
        create();
      if (dice.parentElement !== root || compass.parentElement !== root || dice.nextElementSibling !== compass) {
        root.append(dice, compass);
      }
    },
    setGuidedExpanded(open) {
      guidedExpanded = open;
      compass?.setAttribute("aria-expanded", String(open));
    },
    elements() {
      return [dice, compass].filter((node) => node !== null);
    },
    relabel,
    destroy() {
      remove();
    }
  };
}

// src/lumiverse/frontend.ts
var LOG = `[${MODULE_NAME}]`;
var SAVE_DEBOUNCE_MS = 300;
function setup(ctx) {
  let disposed = false;
  const cleanups = [];
  const track = (fn) => {
    if (typeof fn === "function")
      cleanups.push(fn);
  };
  setLocale(ctx.locale.get());
  const settings = { ...DEFAULT_SETTINGS };
  const rpc = createRpcClient(ctx);
  track(() => rpc.dispose());
  ctx.ready();
  track(ctx.dom.addStyle(STYLES));
  function getActiveChat() {
    try {
      const { chatId, characterId } = ctx.getActiveChat();
      return { chatId: chatId ?? null, characterId: characterId ?? null };
    } catch {
      return { chatId: null, characterId: null };
    }
  }
  const filter = createEventFilter({ getActiveChatId: () => getActiveChat().chatId });
  let lastUserName = "";
  let lastChatId = getActiveChat().chatId;
  let mountRoot = null;
  let container = null;
  let mountWarned = false;
  let guidanceEditor = null;
  let settingsPanel = null;
  let settingsHeading = null;
  const inputActions = [];
  let sequence = 0;
  let abortController = null;
  let autoTimer;
  let saveTimer;
  let saveDirty = false;
  function ensureMounted() {
    if (disposed)
      return null;
    if (container && container.isConnected && mountRoot?.contains(container))
      return container;
    let root = null;
    try {
      root = ctx.ui.mount("chat_composer_above");
    } catch (err) {
      if (!mountWarned)
        console.warn(`${LOG} The composer mount point is not available:`, err);
      mountWarned = true;
      return null;
    }
    if (!root)
      return null;
    mountRoot = root;
    container ??= h("div", { id: CONTAINER_ID, className: "next-choices-container", hidden: true });
    if (container.parentElement !== mountRoot)
      mountRoot.append(container);
    if (guidanceEditor && guidanceEditor.wrapper.parentElement !== mountRoot) {
      mountRoot.insertBefore(guidanceEditor.wrapper, container);
    }
    return container.isConnected ? container : null;
  }
  function cancelAutoTimer() {
    clearTimeout(autoTimer);
    autoTimer = undefined;
  }
  function armAutoTimer() {
    cancelAutoTimer();
    if (!settings.enabled || !settings.autoGenerate)
      return;
    autoTimer = setTimeout(() => {
      autoTimer = undefined;
      if (settings.enabled && settings.autoGenerate)
        generateChoices("auto");
    }, AUTO_GENERATE_DEBOUNCE_MS);
  }
  function abortPending() {
    sequence++;
    try {
      abortController?.abort();
    } catch {}
    abortController = null;
    guidanceEditor?.setBusy(false);
  }
  function beginRequest() {
    abortPending();
    const id = sequence;
    const controller = new AbortController;
    abortController = controller;
    return { signal: controller.signal, isCurrent: () => id === sequence };
  }
  function focusComposer() {
    try {
      if (ctx.composer)
        ctx.composer.focus();
      else
        findComposerTextarea()?.focus();
    } catch {}
  }
  function findComposerTextarea() {
    return document.querySelector('textarea[name="chat-message"]');
  }
  function fillTextareaFallback(textarea, text) {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }
  async function sendTextareaFallback(textarea) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    let button = null;
    for (let el = textarea.parentElement;el && !button; el = el.parentElement) {
      button = el.querySelector('[class*="sendBtnShell"] > button');
    }
    if (!button)
      throw new Error("send button not found");
    if (button.disabled)
      throw Object.assign(new Error("COMPOSER_BUSY"), { code: "COMPOSER_BUSY" });
    button.click();
  }
  function restoreFocusToLauncher(opener) {
    const candidates = [opener, ...quick.elements()];
    for (const candidate of candidates) {
      if (isRendered(candidate)) {
        candidate.focus();
        return;
      }
    }
    focusComposer();
  }
  function restoreFocusAfterStop(target) {
    const launchers = quick.elements();
    const keepTarget = isRendered(target) && target !== document.body && !container?.contains(target) && (launchers.includes(target) || target.matches('textarea, [contenteditable="true"]'));
    const candidates = keepTarget ? [target, ...launchers] : launchers;
    for (const candidate of candidates) {
      if (isRendered(candidate) && !candidate.disabled) {
        candidate.focus();
        return;
      }
    }
    focusComposer();
  }
  function getGuidanceEditor() {
    if (!guidanceEditor) {
      guidanceEditor = createGuidanceEditor({
        tr,
        place(wrapper) {
          const target = ensureMounted();
          if (!target || !mountRoot)
            return false;
          if (wrapper.parentElement !== mountRoot || wrapper.nextElementSibling !== target) {
            mountRoot.insertBefore(wrapper, target);
          }
          return wrapper.isConnected;
        },
        onSubmit: (theme) => void generateChoices("guided", theme),
        onOpenChange: (open) => quick.setGuidedExpanded(open),
        restoreFocus: restoreFocusToLauncher
      });
    }
    return guidanceEditor;
  }
  function resetGuidance() {
    guidanceEditor?.destroy();
    guidanceEditor = null;
    quick.setGuidedExpanded(false);
  }
  function toggleGuided(opener) {
    if (!settings.enabled)
      return;
    const editor = getGuidanceEditor();
    editor.setOpen(!editor.isOpen(), opener);
  }
  function connectionId(snapshot) {
    return snapshot.profileId && snapshot.profileId !== "current" ? snapshot.profileId : null;
  }
  function promptVars(info, snapshot, numChoices) {
    return {
      history: buildHistory(info.history, snapshot.historyDepth),
      numChoices,
      user: info.userName || "User",
      char: info.charName || "Assistant",
      persona: info.persona
    };
  }
  function buildBasePrompt(info, snapshot, numChoices, chatId, characterId) {
    return buildPromptAsync(snapshot.promptTemplate, promptVars(info, snapshot, numChoices), (text) => rpc.resolveMacros(text, chatId, characterId));
  }
  async function generateChoices(reason = "manual", guidance = "") {
    if (disposed || !settings.enabled)
      return;
    if (reason === "auto" && !settings.autoGenerate)
      return;
    const guided = reason === "guided";
    const theme = guided ? String(guidance ?? "").trim() : "";
    if (guided && !theme)
      return;
    const { chatId, characterId } = getActiveChat();
    if (!chatId)
      return;
    const snapshot = { ...settings };
    if (guided)
      cancelAutoTimer();
    const focusTarget = document.activeElement;
    const handle = beginRequest();
    if (guided)
      guidanceEditor?.setBusy(true);
    if (reason !== "auto")
      choicesUi.renderLoading(handle, focusTarget);
    let text;
    try {
      const info = await rpc.getContext(chatId, characterId, snapshot.historyDepth);
      if (!handle.isCurrent())
        return;
      lastUserName = info.userName;
      if (info.history.length === 0 || reason === "auto" && info.lastIsUser) {
        if (reason === "auto")
          return;
        if (guided) {
          guidanceEditor?.setBusy(false);
          guidanceEditor?.setStatus(tr("No conversation is available to generate choices."));
          choicesUi.clear();
        } else {
          choicesUi.renderNotice(tr("No conversation is available to generate choices."));
        }
        return;
      }
      if (reason === "auto")
        choicesUi.renderLoading(handle, focusTarget);
      const base = await buildBasePrompt(info, snapshot, snapshot.numChoices, chatId, characterId);
      if (!handle.isCurrent())
        return;
      const prompt = guided ? appendGuidedTask(base, snapshot.numChoices, theme) : base;
      text = await rpc.generate(prompt, connectionId(snapshot), snapshot.maxTokens, handle.signal);
    } catch (err) {
      if (!handle.isCurrent())
        return;
      if (guided)
        guidanceEditor?.setBusy(false);
      console.error(`${LOG} Generation failed:`, err);
      choicesUi.renderError(errorMessage(err), theme);
      return;
    }
    if (!handle.isCurrent())
      return;
    if (guided)
      guidanceEditor?.setBusy(false);
    const choices = parseChoices(text, snapshot.numChoices);
    if (!choices.length) {
      choicesUi.renderError(tr("Could not parse choices from the model response"), theme);
      return;
    }
    choicesUi.renderChoices(choices, theme);
    if (guided && guidanceEditor?.isOpen())
      guidanceEditor.setOpen(false);
  }
  async function runRewrite(handle, task) {
    const { chatId, characterId } = getActiveChat();
    if (!chatId)
      throw new NoConversationError;
    const snapshot = { ...settings };
    const info = await rpc.getContext(chatId, characterId, snapshot.historyDepth);
    if (!handle.isCurrent())
      throw new RpcError("Superseded", true);
    if (info.history.length === 0)
      throw new NoConversationError;
    lastUserName = info.userName;
    const numChoices = task.kind === "enhance" ? task.originals.length : 1;
    const base = await buildBasePrompt(info, snapshot, numChoices, chatId, characterId);
    if (!handle.isCurrent())
      throw new RpcError("Superseded", true);
    const prompt = task.kind === "enhance" ? appendEnhancementTask(base, task.originals, task.guidance) : appendCombinationTask(base, task.selected);
    return rpc.generate(prompt, connectionId(snapshot), snapshot.maxTokens, handle.signal);
  }
  function isBusyError(err) {
    const code = err?.code;
    return code === "COMPOSER_BUSY" || errorMessage(err).includes("COMPOSER_BUSY");
  }
  async function applyChoice(text) {
    const composer = ctx.composer;
    if (!composer) {
      const textarea = findComposerTextarea();
      if (!textarea) {
        choicesUi.renderNotice(tr("The message composer is not available."));
        return;
      }
      fillTextareaFallback(textarea, text);
      choicesUi.clear();
      if (!settings.autoSend) {
        textarea.focus();
        return;
      }
      try {
        await sendTextareaFallback(textarea);
      } catch (err) {
        choicesUi.renderNotice(isBusyError(err) ? tr("Send failed: chat is busy") : tr("Send failed: ") + errorMessage(err));
      }
      return;
    }
    try {
      composer.setText(text);
    } catch (err) {
      console.error(`${LOG} Failed to fill the composer:`, err);
      choicesUi.renderNotice(tr("The message composer is not available."));
      return;
    }
    choicesUi.clear();
    if (!settings.autoSend) {
      focusComposer();
      return;
    }
    try {
      await composer.send();
    } catch (err) {
      choicesUi.renderNotice(isBusyError(err) ? tr("Send failed: chat is busy") : tr("Send failed: ") + errorMessage(err));
    }
  }
  const quick = createQuickButtons({
    tr,
    mount: () => ctx.ui.mount("chat_input_tools_left"),
    isWanted: () => settings.enabled && settings.showQuickGenerateButton,
    onGenerate: () => void generateChoices("manual"),
    onGuided: (opener) => toggleGuided(opener)
  });
  track(() => quick.destroy());
  const choicesUi = createChoicesUi({
    tr,
    getContainer: ensureMounted,
    peekContainer: () => container,
    isEnabled: () => settings.enabled,
    getUserName: () => lastUserName,
    applyChoice: (text) => void applyChoice(text),
    regenerate: (guidance) => void generateChoices(guidance ? "guided" : "manual", guidance),
    beginRequest,
    abortPending,
    cancelAutoTimer,
    runRewrite,
    restoreFocusAfterStop
  });
  function resetTurn() {
    cancelAutoTimer();
    abortPending();
    choicesUi.clear();
    resetGuidance();
  }
  function applyEnabledState() {
    for (const { handle } of inputActions)
      handle.setEnabled(settings.enabled);
    quick.sync();
  }
  function scheduleSave() {
    saveDirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }
  function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (!saveDirty)
      return;
    saveDirty = false;
    rpc.saveSettings({ ...settings }).catch((err) => {
      if (!(err instanceof RpcError && err.aborted))
        console.warn(`${LOG} Failed to save settings:`, err);
    });
  }
  function onSettingChanged(key) {
    switch (key) {
      case "enabled":
        cancelAutoTimer();
        abortPending();
        choicesUi.clear();
        if (!settings.enabled)
          resetGuidance();
        applyEnabledState();
        break;
      case "autoGenerate":
        cancelAutoTimer();
        abortPending();
        choicesUi.clear();
        break;
      case "showQuickGenerateButton":
        quick.sync();
        break;
      default:
        break;
    }
    scheduleSave();
  }
  async function listProfiles() {
    const api = ctx.connections;
    if (!api)
      return null;
    const supportsKinds = Boolean(ctx.host?.capabilities?.["connection-kinds-v1"]);
    const listed = supportsKinds ? await api.list({ kind: "llm" }) : await api.list();
    return listed.map((profile) => ({ id: profile.id, name: profile.name, model: profile.model }));
  }
  function initSettingsPanel() {
    const section = ctx.ui.mount("settings_extensions");
    settingsHeading = h("h3", { text: tr("Next Choices") });
    const root = h("div", { children: [settingsHeading] });
    section.append(root);
    track(() => root.remove());
    const panel = createSettingsPanel({
      root,
      components: ctx.components,
      tr,
      settings,
      listProfiles,
      onChange: onSettingChanged
    });
    settingsPanel = panel;
    track(() => panel.destroy());
    panel.refreshProfiles();
    if (typeof IntersectionObserver === "function") {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting))
          panel.refreshProfiles();
      });
      observer.observe(root);
      track(() => observer.disconnect());
    }
  }
  function registerInputBarActions() {
    const specs = [
      { id: "next_choices_generate", label: "Generate choices", iconSvg: DICE_SVG, run: () => void generateChoices("manual") },
      { id: "next_choices_guided", label: "Generate choices (guided)", iconSvg: COMPASS_SVG, run: () => toggleGuided(null) }
    ];
    for (const spec of specs) {
      try {
        const handle = ctx.ui.registerInputBarAction({
          id: spec.id,
          label: tr(spec.label),
          iconSvg: spec.iconSvg,
          enabled: settings.enabled
        });
        track(handle.onClick(spec.run));
        track(() => handle.destroy());
        inputActions.push({ handle, label: spec.label });
      } catch (err) {
        console.warn(`${LOG} Could not register the "${spec.label}" input bar action:`, err);
      }
    }
  }
  function wireEvents() {
    const on = (name, handler) => {
      try {
        track(ctx.events.on(name, handler));
      } catch (err) {
        console.warn(`${LOG} Could not subscribe to ${name}:`, err);
      }
    };
    on("GENERATION_STARTED", (payload) => {
      if (filter.onGenerationStarted(payload) === "reset")
        resetTurn();
    });
    on("GENERATION_ENDED", (payload) => {
      if (filter.onGenerationEnded(payload) === "generate")
        armAutoTimer();
    });
    on("CHAT_SWITCHED", (payload) => {
      lastChatId = payload?.chatId ?? null;
      resetTurn();
      ensureMounted();
    });
    on("CHAT_CHANGED", (payload) => {
      const id = chatIdFromChatChanged(payload);
      if (id && id !== lastChatId) {
        lastChatId = id;
        resetTurn();
        ensureMounted();
      }
    });
    const onMutated = (payload) => {
      if (filter.onMessageMutated(payload) === "clear")
        resetTurn();
    };
    on("MESSAGE_EDITED", onMutated);
    on("MESSAGE_DELETED", onMutated);
    on("MESSAGE_SWIPED", (payload) => {
      const verdict = filter.onMessageSwiped(payload);
      if (verdict === "ignore")
        return;
      resetTurn();
      if (verdict === "clear-and-rearm")
        armAutoTimer();
    });
    const composer = ctx.composer;
    if (composer?.onChange) {
      let previous = composer.getState();
      track(composer.onChange((state) => {
        const chatChanged = state.chatId !== previous.chatId;
        const mountedNow = state.mounted && !previous.mounted;
        previous = state;
        if (chatChanged) {
          lastChatId = state.chatId;
          resetTurn();
        }
        if (chatChanged || mountedNow) {
          ensureMounted();
          quick.sync();
        }
      }));
    }
    track(rpc.onCommand((id) => {
      if (document.visibilityState !== "visible")
        return;
      if (id === "generate")
        generateChoices("manual");
      else if (id === "guided")
        toggleGuided(null);
    }));
    track(ctx.locale.subscribe((locale) => {
      setLocale(locale);
      for (const { handle, label } of inputActions)
        handle.setLabel(tr(label));
      if (settingsHeading)
        settingsHeading.textContent = tr("Next Choices");
      settingsPanel?.relabel();
      quick.relabel();
    }));
  }
  function init() {
    registerInputBarActions();
    wireEvents();
    try {
      initSettingsPanel();
    } catch (err) {
      console.error(`${LOG} Settings panel init failed:`, err);
    }
    applyEnabledState();
    ensureMounted();
    console.log(`${LOG} Extension loaded (${getLocale()}).`);
  }
  async function start() {
    try {
      const stored = await rpc.loadSettings();
      if (disposed)
        return;
      if (stored) {
        Object.assign(settings, stored);
      } else {
        console.warn(`${LOG} The backend did not send the settings in time; using the defaults.`);
      }
      init();
    } catch (err) {
      if (!disposed)
        console.error(`${LOG} Init failed:`, err);
    }
  }
  start();
  function teardown() {
    if (disposed)
      return;
    disposed = true;
    cancelAutoTimer();
    abortPending();
    clearTimeout(saveTimer);
    if (saveDirty) {
      saveDirty = false;
      rpc.saveSettings({ ...settings }).catch(() => {});
    }
    for (const cleanup of cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch (err) {
        console.warn(`${LOG} Cleanup step failed:`, err);
      }
    }
    guidanceEditor?.destroy();
    guidanceEditor = null;
    choicesUi.clear();
    container?.remove();
    container = null;
    mountRoot = null;
    try {
      ctx.dom.cleanup();
    } catch {}
  }
  return teardown;
}
export {
  setup
};
