# Next Choices

[English](#next-choices) · [繁體中文](#next-choices-繁體中文)

Suggested player replies for AI roleplay chats, for **SillyTavern** and **Lumiverse**.

After each AI message, Next Choices asks a model for a few in-persona reply options and shows them
above the message box. Click one to put it in the message box (or send it straight away). The
request runs outside the chat, so nothing is written into the chat log or the chat context.

The interface follows the host's UI language: Traditional Chinese for zh-TW, English otherwise.

## Features

- **Auto-generate** choices after each AI reply, or trigger them manually from the wand menu
  (SillyTavern), the composer Extras menu or command palette (Lumiverse), or an optional 🎲 button
  beside the message box.
- **Click to fill or send.** By default a choice is placed in the message box for editing;
  **Send on click** sends it immediately.
- **Edit** any choice inline before using it.
- **Enhance** rewrites every choice in a direction you type (for example "reassure her"), keeping
  each choice's main content.
- **Combine** merges two or more selected choices into one coherent reply. Unselected choices stay
  as they are.
- **Guided** generation creates a fresh set around one theme (for example "invite her to dance").
- **Stop** cancels a pending generate, enhance or combine request. Your choices and drafts are kept.
- **Choice of model.** Use the current connection, or any saved connection profile so a cheap, fast
  model handles choices without tying up your main one.
- **Persona-aware prompt.** The default template includes your persona description, so choices match
  your character's voice. The template is fully editable.
- **Tolerant parsing.** JSON array output is preferred, with a fallback to numbered or bulleted
  lists. If parsing fails, an error with a **Retry** button is shown.
- Stale choices are cleared, and in-flight requests aborted, on swipe, edit, delete and chat switch.

## Installation

### SillyTavern

1. Open **Extensions** → **Install extension**.
2. Paste this repository URL:

   ```
   https://github.com/kikyoicecream/next-choices
   ```

3. Refresh the page. **Next Choices** appears in the Extensions settings panel.

### Lumiverse

1. Open **Extensions** → install from source, and paste the same repository URL.
2. Grant the requested permissions:
   - `generation`: generating choices.
   - `chats` and `chat_mutation`: reading the recent messages.
   - `personas`: filling `{{persona}}`.
3. Enable the extension. Settings are under **Settings → Extensions → Next Choices**.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| Enable extension | On | Master switch. |
| Auto-generate | On | Generate choices after each AI reply. Manual triggers always work. |
| Send on click | Off | Send a clicked choice immediately instead of placing it in the message box. |
| Show choice generation buttons beside the message box | Off | Adds 🎲 (generate) and guided-generate buttons next to the message box. |
| Generation source | Current connection settings | The current connection, or any saved connection profile. |
| Number of choices | 3 | How many choices to generate each time. |
| Max tokens | 500 | Token limit for the generation request. |
| History depth | 4 | How many recent chat messages to include as context. |
| Prompt template | Built-in template | Editable. See the macros below. **Restore default template** resets it. |

### Prompt template macros

| Macro | Replaced with |
| --- | --- |
| `{{history}}` | The last N chat messages (N = History depth), as `Name: text` lines. |
| `{{numChoices}}` | The Number of choices setting. |
| `{{user}}` | Your (player) name. |
| `{{char}}` | The AI character's name. |
| `{{persona}}` | Your persona description, or empty if none is set. |

In SillyTavern, other built-in macros such as `{{description}}` and `{{scenario}}` are expanded too.
`{{history}}` is inserted after macro expansion, so macro-like text inside chat messages is left
alone.

If you still have the old built-in template, it is upgraded to include `{{persona}}`. Custom
templates are never changed: add `{{persona}}` yourself, or use **Restore default template**.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: edit `src/`, then run `bun run build`. The
generated `index.js` and `dist/` are committed so both hosts can install straight from GitHub.

## License

MIT

---

# Next Choices (繁體中文)

適用於 **SillyTavern** 與 **Lumiverse** 的 AI 角色扮演「玩家回覆建議」擴充功能。

每次 AI 回覆後，Next Choices 會請模型生成幾個符合你角色的回覆選項，顯示在訊息輸入框上方。點選後文字會填入輸入框（也可設定為直接送出）。選項請求在聊天之外進行，**不會寫入聊天記錄**，也不影響聊天上下文。

介面語言跟隨宿主程式的 UI 語言設定：zh-TW 顯示繁體中文，其餘顯示英文。

## 功能特色

- **自動生成**：每次 AI 回覆後自動產生選項；也可從魔杖選單（SillyTavern）、輸入框 Extras 選單或指令面板（Lumiverse），或輸入框旁可選的 🎲 按鈕手動生成。
- **點選填入或送出**：預設將選項填入輸入框供編輯；開啟「點選後直接送出」則立即送出。
- **編輯**：使用前可直接修改任一選項。
- **增強**：依你輸入的指示（例如「安慰她」）改寫所有選項，保留各選項的主要內容。
- **合併**：將兩個以上勾選的選項合併為一個連貫的回覆，未勾選的選項保持不變。
- **引導式生成**：圍繞單一主題（例如「邀她跳舞」）生成一組新選項。
- **停止**：可取消進行中的生成、增強或合併請求，現有選項與草稿都會保留。
- **生成來源可選**：使用目前連線，或任一已儲存的連線設定檔，用便宜快速的模型專門生成選項，不佔用主要模型。
- **貼合玩家人設**：預設模板帶入你的玩家角色描述，讓選項符合角色語氣；模板可自由編輯。
- **穩健解析**：優先解析 JSON 陣列，失敗時改解析編號或項目清單；仍失敗則顯示錯誤與「重試」按鈕。
- swipe、編輯、刪除訊息或切換聊天時，會清空過期選項並中止進行中的請求。

## 安裝方式

### SillyTavern

1. 開啟 **Extensions** → **Install extension**。
2. 貼上本 repo 的網址：

   ```
   https://github.com/kikyoicecream/next-choices
   ```

3. 重新整理頁面，即可在 Extensions 設定面板看到「Next Choices」。

### Lumiverse

1. 開啟 **Extensions** → 從原始碼安裝，貼上同一個 repo 網址。
2. 授予所需權限：
   - `generation`：生成選項。
   - `chats` 與 `chat_mutation`：讀取最近的訊息。
   - `personas`：帶入 `{{persona}}`。
3. 啟用擴充功能。設定位於 **Settings → Extensions → Next Choices**。

## 設定說明

| 設定 | 預設值 | 說明 |
| --- | --- | --- |
| 啟用擴充功能 | 開 | 總開關。 |
| 自動生成 | 開 | AI 回覆後自動產生選項；手動觸發隨時可用。 |
| 點選後直接送出 | 關 | 點選選項後立即送出，而不是填入輸入框。 |
| 在訊息輸入框旁顯示生成選項按鈕 | 關 | 在輸入框旁加入 🎲（生成）與引導式生成按鈕。 |
| 生成來源 | 目前連線設定 | 使用目前連線，或任一已儲存的連線設定檔。 |
| 選項數量 | 3 | 每次生成幾個選項。 |
| 最大 Token 數 | 500 | 生成請求的 token 上限。 |
| 參考歷史則數 | 4 | 帶入最近幾則對話作為參考。 |
| Prompt 模板 | 內建模板 | 可自由編輯，巨集見下表；「還原預設模板」可重設。 |

### Prompt 模板巨集

| 巨集 | 替換為 |
| --- | --- |
| `{{history}}` | 最近 N 則對話（N =「參考歷史則數」），格式為 `名字: 內容`。 |
| `{{numChoices}}` | 「選項數量」設定值。 |
| `{{user}}` | 你（玩家）的名字。 |
| `{{char}}` | AI 角色的名字。 |
| `{{persona}}` | 你的玩家角色描述；未設定時為空字串。 |

在 SillyTavern 中，其他內建巨集（例如 `{{description}}`、`{{scenario}}`）也會展開。`{{history}}` 一律在巨集展開後才插入，因此聊天訊息中類似巨集的文字不會被誤展開。

舊版內建模板會自動升級並加入 `{{persona}}`；自訂模板一律原樣保留，請自行加入 `{{persona}}`，或按「還原預設模板」。

## 開發

請見 [CONTRIBUTING.md](CONTRIBUTING.md)。簡單來說：修改 `src/` 後執行 `bun run build`。產生的 `index.js` 與 `dist/` 會一併提交，讓兩種宿主程式都能直接從 GitHub 安裝。

## 授權

MIT
