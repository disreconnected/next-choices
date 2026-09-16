# Next Choices

A third-party UI extension for SillyTavern. After each AI character reply, it generates 3 suggested player responses based on the recent conversation and shows them as a button row above the input area. Clicking a choice fills it into the input box so you can edit before sending.

Choice generation goes through a separate raw request channel — the prompt and result are **never written into the chat log**, so your chat context stays clean.

The UI language follows SillyTavern's **User Settings → UI Language** setting: with zh-TW the interface shows Traditional Chinese, otherwise it shows English.

## Features

- **Auto-generate**: choices appear automatically once an AI reply finishes rendering (switchable to a manual trigger button in the settings).
- **Click to fill**: by default the choice text is inserted into the input box for editing; "Send on click" can be enabled instead.
- **Language follows the conversation**: the prompt explicitly instructs the model to write choices in the same language as the chat.
- **Selectable generation source**:
  - "Current connection settings" — uses your currently selected API connection.
  - Any saved **Connection Profile** — dedicate a cheap, fast model to choice generation without occupying your main model.
  - (On older SillyTavern versions without Connection Profile request support, only "Current connection settings" is offered.)
- **Customizable prompt template**: supports the `{{history}}`, `{{user}}`, `{{char}}`, `{{numChoices}}`, and `{{persona}}` macros — plus other SillyTavern built-in macros — with a "Restore default template" button. See [Prompt template macros](#prompt-template-macros).
- **Persona-aware choices**: the default template includes your persona description (`{{persona}}`) so generated choices match your character's voice, writing style, and inner narration.
- **Robust parsing**: JSON array output is parsed first, with automatic fallback to numbered/bulleted lists; on failure an error message with a "Retry" button is shown.
- Stale choices are cleared (and in-flight requests aborted) on swipe, message edit, message delete, and chat switch.
- Styling uses SillyTavern theme variables and works in light/dark themes and on mobile.

## Installation

1. Open SillyTavern and click the **Extensions** panel at the top.
2. Click **Install extension**.
3. Paste this repo's git URL:

   ```
   https://github.com/pdatone/next-choices
   ```

4. After installation, refresh the page. "Next Choices" appears in the Extensions settings panel.

## Settings

Expand "Next Choices" in the Extensions panel:

| Setting | Default | Description |
| --- | --- | --- |
| Enable extension | On | Master switch. |
| Auto-generate | On | Generate choices automatically after each AI reply; when off, a "🎲 Generate choices" button appears above the input box for manual triggering. |
| Send on click | Off | When on, clicking a choice sends it immediately; by default it is only inserted into the input box for editing. |
| Generate choices button | Off | Show a "🎲 Generate choices" button in the composer toolbar, immediately before the person/impersonate buttons, so choices can be generated without opening the wand menu. Purely a display toggle: it never changes the choices list or auto-generation. |
| Generation source | Current connection settings | Generate choices with your current API connection or any saved Connection Profile. |
| Number of choices | 3 | How many choices to generate each time. |
| Max tokens | 500 | Token limit for the generation request. |
| History depth | 4 | Include the last N chat messages as generation context. |
| Prompt template | Built-in English template | Freely editable; see [Prompt template macros](#prompt-template-macros) below. A "Restore default template" button is provided. |

## Prompt template macros

The following macros are replaced when the prompt is built:

| Macro | Replaced with |
| --- | --- |
| `{{history}}` | The last N chat messages (N = "History depth"), as `Name: text` lines. |
| `{{numChoices}}` | The "Number of choices" setting. |
| `{{user}}` | Your (player) name. |
| `{{char}}` | The AI character's name. |
| `{{persona}}` | Your persona description from Persona Management, so choices can match your character's voice, writing style, and inner narration. Empty if no persona description is set. |

Other **SillyTavern built-in macros** (for example, `{{description}}` and `{{scenario}}`) are also expanded when supported by the running version. `{{history}}` is always inserted after macro expansion, so macro-like text inside chat messages is not expanded.

> Note: the old built-in template is automatically upgraded to include `{{persona}}`. Custom templates are preserved unchanged; add `{{persona}}` yourself or select "Restore default template" to include persona information.

## Usage

1. Chat with a character as usual.
2. When the AI reply finishes, a row of choice buttons appears above the input box (a spinner is shown while generating).
3. Click any choice; the text fills into the input box — edit and send.
4. On the right of the button row, ♻️ regenerates and ✖ dismisses the choices.

## License

MIT

---

# Next Choices

SillyTavern 第三方 UI 擴充功能：在每次 AI 角色回覆完成後，依據最近的對話自動生成 3 個「玩家可選的回應選項」，以按鈕列顯示在輸入框上方。點選後文字會填入輸入框，讓你編輯後再自行送出。

選項生成走獨立的 raw 請求通道——prompt 與結果**絕不寫入聊天記錄**，因此不會污染聊天上下文。

介面語言跟隨 SillyTavern 的 **User Settings → UI Language** 設定：選擇 zh-TW 時顯示繁體中文，其餘語言顯示英文。

## 功能特色

- **自動生成**：AI 回覆渲染完成後自動產生選項（可在設定切換為手動按鈕觸發）。
- **點選填入**：預設將選項文字填入輸入框供你編輯；也可開啟「點選後直接送出」。
- **語言跟隨對話**：prompt 中明確指示模型使用與對話相同的語言撰寫選項。
- **生成來源可選**：
  - 「目前連線設定」——使用你目前選用的 API 連線。
  - 任一已儲存的 **Connection Profile**——可用便宜快速的模型專門生成選項，不佔用主要模型。
  - （舊版 SillyTavern 若不支援 Connection Profile 請求，會自動只提供「目前連線設定」。）
- **可自訂 Prompt 模板**：支援 `{{history}}`、`{{user}}`、`{{char}}`、`{{numChoices}}`、`{{persona}}` 巨集，也支援其他 SillyTavern 內建巨集，附「還原預設模板」按鈕。詳見〈[Prompt 模板巨集](#prompt-模板巨集)〉。
- **貼合玩家人設**：預設模板會帶入你的玩家角色描述（`{{persona}}`），讓生成的選項符合你角色的語氣、文風與內心敘述。
- **穩健解析**：優先解析 JSON 陣列輸出，失敗時自動 fallback 解析編號清單；再失敗會顯示錯誤與「重試」按鈕。
- 支援 swipe／編輯／刪除訊息／切換聊天時自動清空過期選項，並中止進行中的請求。
- 樣式使用 SillyTavern 主題變數，深淺色主題與行動裝置皆可正常顯示。

## 安裝方式

1. 開啟 SillyTavern，點選上方的 **Extensions**（延伸功能）面板。
2. 點 **Install extension**（安裝擴充功能）。
3. 貼上本 repo 的 git URL：

   ```
   https://github.com/pdatone/next-choices
   ```

4. 安裝完成後重新整理頁面，即可在 Extensions 設定面板中看到「Next Choices」。

## 設定說明

在 Extensions 面板中展開「Next Choices」：

| 設定 | 預設值 | 說明 |
| --- | --- | --- |
| 啟用擴充功能 | 開 | 總開關。 |
| 自動生成 | 開 | AI 回覆後自動產生選項；關閉後輸入框上方會出現「🎲 生成選項」按鈕改為手動觸發。 |
| 點選後直接送出 | 關 | 開啟後點選項會立即送出；預設僅填入輸入框供編輯。 |
| 生成選項按鈕 | 關 | 在輸入框工具列顯示「🎲 生成選項」按鈕（位於人物／扮演按鈕左側），不必開啟魔杖選單即可生成選項。純粹是顯示開關：不會更動選項列或自動生成設定。 |
| 生成來源 | 目前連線設定 | 選擇用目前的 API 連線，或任一已儲存的 Connection Profile 來生成選項。 |
| 選項數量 | 3 | 每次生成幾個選項。 |
| 最大 Token 數 | 500 | 生成請求的 token 上限。 |
| 參考歷史則數 | 4 | 帶入最近 N 則對話作為生成參考。 |
| Prompt 模板 | 內建英文模板 | 可自由編輯；詳見下方〈[Prompt 模板巨集](#prompt-模板巨集)〉，並附「還原預設模板」按鈕。 |

## Prompt 模板巨集

組建 prompt 時會替換以下巨集：

| 巨集 | 替換為 |
| --- | --- |
| `{{history}}` | 最近 N 則對話（N =「參考歷史則數」），格式為 `名字: 內容`。 |
| `{{numChoices}}` | 「選項數量」設定值。 |
| `{{user}}` | 你（玩家）的名字。 |
| `{{char}}` | AI 角色的名字。 |
| `{{persona}}` | Persona Management 中的玩家角色描述，讓選項貼合你角色的語氣、文風與內心敘述。未設定人設時為空字串。 |

其他 **SillyTavern 內建巨集**（例如 `{{description}}`、`{{scenario}}`）在目前版本支援時也會透過 SillyTavern 自身的巨集引擎展開。`{{history}}` 一律在巨集展開後才插入，因此聊天訊息中出現的巨集字樣不會被誤展開。

> 注意：舊版內建模板會自動升級並加入 `{{persona}}`。已自訂的模板會原樣保留；請自行加入 `{{persona}}`，或按「還原預設模板」以帶入人設資訊。

## 使用方式

1. 與角色正常對話。
2. AI 回覆完成後，輸入框上方會出現選項按鈕列（生成中會顯示轉圈動畫）。
3. 點選任一選項，文字會填入輸入框，編輯後送出即可。
4. 按鈕列右側的 ♻️ 可重新生成，✖ 可收合選項列。

## 授權

MIT
