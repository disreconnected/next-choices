/**
 * Stylesheet of the Lumiverse build: a port of style.css onto the host's
 * --lumiverse-* theme variables (every use carries a fallback so the UI stays
 * readable if a variable is missing). The SillyTavern-only blocks
 * (Guided Generations toolbar hosting, #send_form placement, the ST settings
 * drawer) are intentionally left out.
 *
 * Elements are hidden with the `hidden` attribute, so an explicit `display`
 * on any of these classes must never win over it: see the [hidden] rule.
 */
export const STYLES = `
/* Next Choices */

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

/* An explicit display on a class must not override the hidden attribute. */
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
    /* Keep lengthy generated choices from covering the conversation. */
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

/* The shared formatter keeps the quote characters inside <q>. */
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

/* Base look of every small control (also the Retry button and the quick buttons). */
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

/* Regenerate / Dismiss keep the .next-choices-tool theme but get a full,
   tappable square target. Scoped so Apply/Reset keep their own sizing. */
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

/* A message that is not a failure of the generation itself (for example a refused send). */
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

/* --- Content wrapper and guidance panel ---------------------------------- */

/* Wraps the scrollable list plus the guidance panel; the toolbar stays its
   sibling so its vertical layout and the desktop/mobile orientations are
   untouched. */
.next-choices-content {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-width: 0;
    gap: 6px;
}

/* Hidden via the hidden attribute, so no permanent display:flex here. */
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

/* The host's own text-field classes do not exist here: style the fields ourselves. */
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

/* Toolbar transformations: text buttons with real targets, unlike the square
   icon buttons. */
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

/* While a rewrite request is in flight the rows stay visible but inert:
   no pointer affordance on the locked previews. */
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

/* --- Per-choice editing ------------------------------------------------- */

.next-choices-row {
    display: flex;
    /* Center every control against the preview: with flex-start the shorter
       preview is pinned to the top and the taller Edit control's center sits
       below it. */
    align-items: center;
    gap: 5px;
    width: 100%;
    min-width: 0;
}

.next-choices-row .next-choices-item {
    flex: 1 1 0;
    min-width: 0;
}

/* Sits vertically centered against the choice preview, which keeps its own
   text size: the control grows instead of the text shrinking. */
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

/* Accent variants for the editor controls: muted confirm (green) and
   discard (red) tints. */
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

/* Focus and disabled states so hover-only visibility is never the only affordance. */
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

/* --- Quick generate buttons (chat_input_tools_left) ---------------------- */

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

/* --- Composer theme editor (guided generation) --------------------------- */

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

/* --- Settings tab -------------------------------------------------------- */

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

/* Narrow screens: keep buttons tappable, stack the toolbar horizontally. */
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

    /* Keep editor controls comfortably tappable; the list stays full-width. */
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
