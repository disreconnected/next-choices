/**
 * Next Choices
 * SillyTavern third-party UI extension.
 *
 * After each AI reply, generates N suggested player responses via a raw
 * (out-of-chat) generation request and shows them as buttons above the
 * input area. Nothing is ever written into the chat log / context.
 */

'use strict';

(() => {
    const MODULE_NAME = 'nextChoices';
    const CONTAINER_ID = 'next_choices_container';

    // =========================================================================
    // Settings
    // =========================================================================

    // Kept verbatim so existing users who never customized the old default can
    // be migrated without overwriting genuinely custom prompt templates.
    const LEGACY_DEFAULT_PROMPT_TEMPLATE =
        'You are an assistant helping a roleplay player. Below is the recent conversation between {{user}} and {{char}}:\n\n' +
        '{{history}}\n\n' +
        'Write {{numChoices}} response options that {{user}} could say next, replying to the latest message from {{char}}.\n\n' +
        'Requirements:\n' +
        '- The motivation behind each option, and the consequences it would lead to, must differ drastically from the other options (e.g. one bold, one cautious, one creative).\n' +
        '- Write the options in the same language as the conversation.\n' +
        '- Respond ONLY with a JSON array of {{numChoices}} strings, no other text.';

    const DEFAULT_PROMPT_TEMPLATE =
        'You are an assistant helping a roleplay player. Below is the recent conversation between {{user}} and {{char}}:\n\n' +
        '{{history}}\n\n' +
        'Persona of {{user}} (match their voice, writing style, and inner narration):\n' +
        '{{persona}}\n\n' +
        'Write {{numChoices}} response options that {{user}} could say next, replying to the latest message from {{char}}.\n\n' +
        'Requirements:\n' +
        '- The motivation behind each option, and the consequences it would lead to, must differ drastically from the other options (e.g. one bold, one cautious, one creative).\n' +
        '- Write the options in the same language as the conversation.\n' +
        '- Respond ONLY with a JSON array of {{numChoices}} strings, no other text.';

    // SillyTavern's macro engine must never see chat history: otherwise text in
    // a message such as "{{persona}}" could be expanded as prompt markup.
    const HISTORY_PLACEHOLDER = '\uE000NEXT_CHOICES_HISTORY\uE001';

    const DEFAULT_SETTINGS = Object.freeze({
        enabled: true,
        autoGenerate: true,      // auto (event-driven) / manual (button)
        autoSend: false,         // send immediately on click
        profileId: 'current',    // 'current' or a connection profile id
        showQuickGenerateButton: false, // composer toolbar shortcut (opt-in)
        numChoices: 3,
        maxTokens: 500,
        historyDepth: 4,
        promptTemplate: DEFAULT_PROMPT_TEMPLATE,
    });

    function getContext() {
        try {
            return globalThis.SillyTavern?.getContext?.() ?? null;
        } catch (err) {
            console.error(`[${MODULE_NAME}] Failed to get SillyTavern context:`, err);
            return null;
        }
    }

    function getSettings() {
        const ctx = getContext();
        if (!ctx?.extensionSettings) {
            // Fallback so callers can always read values even if ST is broken.
            return { ...DEFAULT_SETTINGS };
        }
        // Create once, then backfill missing keys in place. Never recreate the
        // object: UI handlers and callers must all share the same reference,
        // otherwise writes land on an orphaned copy and are never persisted.
        if (!ctx.extensionSettings[MODULE_NAME]) {
            ctx.extensionSettings[MODULE_NAME] = { ...DEFAULT_SETTINGS };
        }
        const stored = ctx.extensionSettings[MODULE_NAME];
        for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
            if (!(key in stored)) stored[key] = value;
        }
        // Upgrade only the exact former default. Custom templates are user
        // content and must never be silently rewritten.
        if (stored.promptTemplate === LEGACY_DEFAULT_PROMPT_TEMPLATE) {
            stored.promptTemplate = DEFAULT_PROMPT_TEMPLATE;
            saveSettings();
        }
        return stored;
    }

    function saveSettings() {
        const ctx = getContext();
        try {
            ctx?.saveSettingsDebounced?.();
        } catch (err) {
            console.error(`[${MODULE_NAME}] Failed to save settings:`, err);
        }
    }

    /**
     * Translates a UI string through SillyTavern's i18n if available.
     * Falls back to the original (English) text.
     */
    function tr(text) {
        const ctx = getContext();
        try {
            if (typeof ctx?.translate === 'function') return ctx.translate(text);
            if (typeof ctx?.t === 'function') return ctx.t`${text}`; // some versions only expose t
        } catch { /* ignore */ }
        return text;
    }

    // =========================================================================
    // Prompt building
    // =========================================================================

    /**
     * Returns the last `depth` non-system chat messages as "Name: text" lines.
     */
    function buildHistory(ctx, depth) {
        const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
        const visible = chat.filter((mes) => mes && !mes.is_system && typeof mes.mes === 'string');
        return visible
            .slice(-Math.max(1, depth))
            .map((mes) => `${mes.name ?? '?'}: ${mes.mes}`)
            .join('\n');
    }

    /**
     * Returns the last non-system message, or null.
     */
    function getLastMessage(ctx) {
        const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
        for (let i = chat.length - 1; i >= 0; i--) {
            if (chat[i] && !chat[i].is_system) return chat[i];
        }
        return null;
    }

    /**
     * Returns the player's persona description, or '' if none is set.
     */
    function getPersonaDescription(ctx) {
        const desc = ctx?.powerUserSettings?.persona_description;
        return typeof desc === 'string' ? desc.trim() : '';
    }

    function buildPrompt(ctx, settings) {
        const history = buildHistory(ctx, settings.historyDepth);
        const template = settings.promptTemplate || DEFAULT_PROMPT_TEMPLATE;

        let prompt = template
            .replaceAll('{{history}}', HISTORY_PLACEHOLDER)
            .replaceAll('{{numChoices}}', String(settings.numChoices));

        // Prefer SillyTavern's macro engine so {{persona}} and other built-in
        // macros such as {{description}} and {{scenario}} use native behavior.
        if (typeof ctx?.substituteParams === 'function') {
            try {
                const expanded = ctx.substituteParams(prompt);
                if (typeof expanded === 'string') {
                    prompt = expanded;
                } else {
                    console.warn('[' + MODULE_NAME + '] substituteParams returned a non-string; using manual macro replacement.');
                }
            } catch (err) {
                console.warn('[' + MODULE_NAME + '] substituteParams failed, using manual macro replacement:', err);
            }
        }

        // Fallback for older SillyTavern versions, failed macro expansion, and
        // any built-in macros left untouched by the running version.
        prompt = prompt
            .replaceAll('{{user}}', ctx?.name1 ?? 'User')
            .replaceAll('{{char}}', ctx?.name2 ?? 'Assistant')
            .replaceAll('{{persona}}', getPersonaDescription(ctx));

        return prompt.replaceAll(HISTORY_PLACEHOLDER, history);
    }

    /**
     * Builds a prompt that asks the model to enhance the already displayed
     * choices according to the user's guidance instead of inventing new ones.
     * Reuses buildPrompt (persona, history, custom template, native macros)
     * with numChoices pinned to the displayed list, then appends the
     * enhancement task as literal data AFTER macro expansion: JSON-encoded
     * originals and guidance can never be treated as prompt markup or leak
     * through substituteParams.
     */
    function buildEnhancementPrompt(ctx, settings, choices, guidance) {
        const base = buildPrompt(ctx, { ...settings, numChoices: choices.length });
        const payload = JSON.stringify(
            {
                task: 'Enhance each response option below according to the guidance. This task overrides the previous instruction to write new options.',
                guidance,
                choices,
                requirements: [
                    'For every choice, keep its existing position, main actions, dialogue, intention, scene facts, voice, language, and distinct approach.',
                    'Weave in or append actions and dialogue that support the guidance; do not remove the existing substance or start over.',
                    'Do not combine, reorder, or add options.',
                    'Return the complete enhanced version of every choice (not only the additions) as a JSON array of exactly ' + choices.length + ' nonempty strings, with no commentary.',
                ],
            },
            null,
            2,
        );
        return base + '\n\n=== Next Choices enhancement task ===\n' + payload + '\n=== End of Next Choices enhancement task ===';
    }

    /**
     * Builds a prompt that asks the model for brand-new options that all share
     * the player's one main theme, while the (possibly customized) template
     * keeps supplying the diversity of tones, motivations, and approaches.
     * Deliberately not an enhancement: buildEnhancementPrompt rewrites the
     * options already on screen, this one replaces them.
     * Reuses buildPrompt (persona, history, custom template, native macros)
     * and appends the task as literal data AFTER macro expansion, so theme text
     * can never be treated as prompt markup or leak through substituteParams.
     */
    function buildGuidedPrompt(ctx, settings, guidance) {
        const base = buildPrompt(ctx, settings);
        const payload = JSON.stringify(
            {
                task: 'Generate new response options around the shared theme below.',
                guidance,
                requirements: [
                    'Make the guidance the main theme of every option, while staying consistent with the conversation and persona.',
                    "Preserve the prompt template's different tones, motivations, approaches, and consequences across the options (for example, bold, cautious, romantic, or creative). The shared theme must not make the options paraphrases of one another.",
                    'Keep the language, voice, and other requirements of the prompt template.',
                    'Return ONLY a JSON array of exactly ' + settings.numChoices + ' nonempty strings, with no commentary.',
                ],
            },
            null,
            2,
        );
        return base + '\n\n=== Next Choices guided generation ===\n' + payload + '\n=== End of Next Choices guided generation ===';
    }

    // =========================================================================
    // Generation
    // =========================================================================

    let requestId = 0;              // generation counter to discard stale results
    let abortController = null;     // for requests that support signals
    let generating = false;

    function abortPending() {
        requestId++;
        generating = false;
        try {
            abortController?.abort();
        } catch { /* ignore */ }
        abortController = null;
        // The composer editor's submit control is locked only for the duration
        // of its own request, so anything that abandons a pending request
        // (newer request, chat change, settings toggle) must unlock it here.
        setGenerationGuidanceBusy(false);
    }

    /**
     * Sends the raw prompt through the configured backend and returns the
     * response text (string). Throws on failure.
     */
    async function sendRawRequest(ctx, settings, prompt, signal, ownedRequestId) {
        const profileId = settings.profileId;
        const cmrs = ctx?.ConnectionManagerRequestService;

        if (profileId && profileId !== 'current' && cmrs?.sendRequest) {
            const messages = [{ role: 'user', content: prompt }];
            const response = await cmrs.sendRequest(profileId, messages, settings.maxTokens, { signal });
            if (typeof response === 'string') return response;
            if (response && typeof response.content === 'string') return response.content;
            throw new Error(tr('Connection profile returned an unrecognized response'));
        }

        if (typeof ctx?.generateRaw !== 'function') {
            throw new Error(tr('generateRaw is not available'));
        }

        // Prefer the modern object-parameter form; fall back to positional args.
        try {
            const result = await ctx.generateRaw({ prompt, systemPrompt: '' });
            if (typeof result === 'string' && result.length > 0) return result;
            if (result && typeof result.content === 'string') return result.content;
            if (typeof result === 'string') return result;
            throw new Error('empty result');
        } catch (err) {
            // Do not start a legacy retry for a request already stopped or superseded.
            if (ownedRequestId !== requestId) throw err;
            console.warn(`[${MODULE_NAME}] generateRaw object form failed, trying legacy form:`, err);
            const legacy = await ctx.generateRaw(prompt, '', false, false, '');
            if (typeof legacy === 'string') return legacy;
            if (legacy && typeof legacy.content === 'string') return legacy.content;
            throw new Error(tr('generateRaw returned an unrecognized response'));
        }
    }

    async function generateChoices(reason = 'manual', guidance = '') {
        const ctx = getContext();
        // Snapshot before the first await: a preference changed while the
        // request is in flight must not change this request's prompt or the
        // number of choices this response is validated against.
        const settings = { ...getSettings() };
        if (!ctx || !settings.enabled) return;
        if (reason === 'auto' && !settings.autoGenerate) return;

        // Only the guided reason consumes the submitted theme. The dice, wand,
        // Retry, and auto callbacks are unguided by construction and send the
        // plain template prompt even when the theme box holds text.
        const guided = reason === 'guided';
        const theme = guided ? String(guidance ?? '').trim() : '';
        if (guided && !theme) return; // empty theme: no request
        if (guided && !document.getElementById('send_form')) return;

        const lastMes = getLastMessage(ctx);
        if (!lastMes) return;
        // In auto mode, only fire when the latest message is from the AI.
        if (reason === 'auto' && lastMes.is_user) return;

        // A pending auto-generation would otherwise fire mid-request and abort
        // the guided request it was submitted from.
        if (guided) clearTimeout(autoGenerateTimer);
        const focusReturnTarget = document.activeElement;

        abortPending();
        const myRequestId = requestId;
        const requestController = typeof AbortController !== 'undefined' ? new AbortController() : null;
        abortController = requestController;
        generating = true;

        if (guided) setGenerationGuidanceBusy(true);
        renderLoading(myRequestId, focusReturnTarget);

        let text;
        try {
            const prompt = guided ? buildGuidedPrompt(ctx, settings, theme) : buildPrompt(ctx, settings);
            text = await sendRawRequest(ctx, settings, prompt, requestController?.signal, myRequestId);
        } catch (err) {
            if (myRequestId !== requestId) return; // stale, ignore
            generating = false;
            if (guided) setGenerationGuidanceBusy(false);
            console.error(`[${MODULE_NAME}] Generation failed:`, err);
            renderError(err?.message ?? String(err), theme);
            return;
        }

        if (myRequestId !== requestId) return; // stale, ignore
        generating = false;
        if (guided) setGenerationGuidanceBusy(false);

        const choices = parseChoices(text, settings.numChoices);
        if (!choices.length) {
            renderError(tr('Could not parse choices from the model response'), theme);
            return;
        }
        renderChoices(choices, theme);
        // Success collapses the editor; the theme stays in the textarea so it
        // can be reopened and reused within the same conversation turn. Only an
        // editor that is actually open is collapsed, so this never recreates
        // UI that a reset has already discarded.
        if (guided && generationGuidanceUi?.open) setGenerationGuidanceOpen(false);
    }

    // =========================================================================
    // Response parsing
    // =========================================================================

    /**
     * Extracts up to `max` choice strings from the raw model output.
     * 1) Try JSON array between the first '[' and the last ']'.
     * 2) Fallback: numbered / bulleted list lines.
     * Returns [] if nothing usable was found.
     */
    function parseChoices(text, max) {
        if (typeof text !== 'string' || !text.trim()) return [];

        // Attempt 1: JSON array.
        const start = text.indexOf('[');
        const end = text.lastIndexOf(']');
        if (start !== -1 && end > start) {
            try {
                const arr = JSON.parse(text.slice(start, end + 1));
                if (Array.isArray(arr)) {
                    const items = arr
                        .map((item) => {
                            if (typeof item === 'string') return item.trim();
                            if (item && typeof item === 'object') {
                                const v = item.text ?? item.option ?? item.choice ?? item.content;
                                return typeof v === 'string' ? v.trim() : '';
                            }
                            return '';
                        })
                        .filter(Boolean);
                    if (items.length) return items.slice(0, max);
                }
            } catch { /* fall through */ }
        }

        // Attempt 2: numbered / bulleted list.
        const items = [];
        for (const rawLine of text.split('\n')) {
            const line = rawLine.trim();
            const match = line.match(/^(?:\d+\s*[.)、]\s*|[-*•]\s+)(.+)$/);
            if (match) {
                let item = match[1].trim();
                // Strip wrapping quotes and trailing comma left over from JSON-ish output.
                item = item.replace(/^["'「『]|["'」』,]+$/g, '').trim();
                if (item) items.push(item);
            }
        }
        return items.slice(0, max);
    }

    /**
     * Extracts exactly `expectedCount` enhanced choice strings from the raw
     * model output. Unlike parseChoices this is atomic: anything other than
     * a JSON array of exactly `expectedCount` nonempty strings rejects the
     * whole response (returns null). No filtering, truncation, object
     * aliases, or numbered-line fallback: those could silently map an
     * enhancement onto the wrong original choice.
     */
    function parseEnhancedChoices(text, expectedCount) {
        if (typeof text !== 'string' || !text.trim()) return null;
        const start = text.indexOf('[');
        const end = text.lastIndexOf(']');
        if (start === -1 || end <= start) return null;
        let arr;
        try {
            arr = JSON.parse(text.slice(start, end + 1));
        } catch {
            return null;
        }
        if (!Array.isArray(arr) || arr.length !== expectedCount) return null;
        const items = arr.map((item) => (typeof item === 'string' ? item.trim() : null));
        if (items.some((item) => !item)) return null;
        return items;
    }

    function getContainer() {
        let $container = $(`#${CONTAINER_ID}`);
        if ($container.length) return $container;

        $container = $(`<div id="${CONTAINER_ID}" class="next-choices-container"></div>`);
        const $sendForm = $('#send_form');
        if ($sendForm.length) {
            $container.insertBefore($sendForm);
        } else {
            const $formSheld = $('#form_sheld');
            if ($formSheld.length) {
                $formSheld.prepend($container);
            } else {
                return $(); // ST UI not ready; caller must handle empty selection
            }
        }
        return $container;
    }

    function clearChoicesUI() {
        const $container = $(`#${CONTAINER_ID}`);
        $container.empty().hide();
    }

    function makeToolbar(onEnhance = null, generationGuidance = '') {
        const $toolbar = $('<div class="next-choices-toolbar"></div>');
        const $regen = $('<button type="button" class="next-choices-tool next-choices-regenerate"></button>')
            .text('♻️')
            .attr('title', tr('Regenerate'))
            .attr('aria-label', tr('Regenerate'));
        // Regenerate repeats THIS render: a guided result regenerates from the
        // theme captured when it was rendered, not from whatever the composer
        // theme box holds now.
        $regen.on('click', () => generateChoices(generationGuidance ? 'guided' : 'manual', generationGuidance));

        let $enhance = $();
        if (typeof onEnhance === 'function') {
            $enhance = $('<button type="button" class="next-choices-tool next-choices-enhance"></button>')
                .text(tr('Enhance'))
                .attr('title', tr('Enhance choices'))
                .attr('aria-label', tr('Enhance choices'))
                .attr('aria-controls', 'next_choices_guidance_panel')
                .attr('aria-expanded', 'false');
            $enhance.on('click', () => onEnhance());
        }

        const $close = $('<button type="button" class="next-choices-tool next-choices-dismiss"></button>')
            .text('✖')
            .attr('title', tr('Dismiss'))
            .attr('aria-label', tr('Dismiss'));
        // Dismiss only hides the list. It is not a request cancellation control.
        $close.on('click', () => clearChoicesUI());
        $toolbar.append($regen, $enhance, $close);
        return { $toolbar, $enhance };
    }

    function renderLoading(ownedRequestId, focusTarget) {
        const $container = getContainer();
        if (!$container.length) return;
        $container.empty().show();
        const $loading = $('<div class="next-choices-loading"><span class="next-choices-spinner"></span></div>');
        $loading.append($('<span class="next-choices-loading-label"></span>').text(tr('Generating choices…')));
        const $stop = $('<button type="button" class="next-choices-tool next-choices-stop"></button>')
            .text(tr('Stop generating'))
            .attr('aria-label', tr('Stop generating'));
        $stop.on('click', () => {
            if (ownedRequestId !== requestId
                || document.getElementById(CONTAINER_ID) !== $container[0]
                || !$loading[0].isConnected
                || $loading.parent()[0] !== $container[0]) return;
            clearTimeout(autoGenerateTimer);
            abortPending();
            $container.empty().hide();
            restoreFocusAfterGenerationStop(focusTarget);
        });
        $loading.append($stop);
        $container.append($loading);
    }

    function renderError(message, generationGuidance = '') {
        const $container = getContainer();
        if (!$container.length) return;
        $container.empty().show();
        const $error = $('<div class="next-choices-error"></div>');
        $error.append($('<span></span>').text(tr('Failed to generate choices: ') + message));
        const $retry = $('<button type="button" class="next-choices-retry menu_button"></button>').text(tr('Retry'));
        // Retry resubmits the failed request, so it uses the same captured
        // theme as the render it belongs to rather than the live draft.
        $retry.on('click', () => generateChoices(generationGuidance ? 'guided' : 'manual', generationGuidance));
        $error.append($retry);
        $container.append($error, makeToolbar(null, generationGuidance).$toolbar);
    }

    /**
     * Runs `choiceText` through SillyTavern's own message formatting pipeline
     * (the same one used for chat messages) so markdown-ish markup such as
     * "quotes", *italics*, __underline__ and **bold** render with the same
     * styling/colors as regular chat messages. The pipeline also sanitizes
     * the output via DOMPurify, so the returned HTML is safe to inject.
     * Returns null if formatting is unavailable or fails, in which case the
     * caller should fall back to plain text.
     */
    function formatChoiceHtml(choiceText) {
        const ctx = getContext();
        if (typeof ctx?.messageFormatting !== 'function') return null;
        try {
            const formatted = ctx.messageFormatting(choiceText, ctx.name1 ?? '', false, true, -1);
            if (typeof formatted === 'string' && formatted.length > 0) return formatted;
            return null;
        } catch (err) {
            console.warn(`[${MODULE_NAME}] messageFormatting failed, falling back to plain text:`, err);
            return null;
        }
    }

    function renderChoices(choices, generationGuidance = '') {
        const $container = getContainer();
        if (!$container.length) return;
        // Shared committed text: preview, selection, editor init, Apply, and
        // enhancement requests all read/write this one render-local array.
        // Never reconstructed from rendered HTML.
        $container.empty().show();
        const currentChoices = choices.map((choice) => String(choice ?? ''));
        let openEditors = 0;
        let enhancementBusy = false;
        const rowRefs = [];
        const $list = $('<div class="next-choices-list"></div>');
        choices.forEach((choice, index) => {
            // Per-row editing state: currentChoices[index] is the last
            // applied text (initially the generated string); the textarea
            // owns the live draft while editing.
            const number = index + 1;
            const $row = $('<div class="next-choices-row"></div>');

            // --- Selection target: fills the composer with applied text ---
            const $btn = $('<button type="button" class="next-choices-item"></button>');
            const renderPreview = () => {
                const text = currentChoices[index];
                const formatted = formatChoiceHtml(text);
                if (formatted !== null) {
                    $btn.html(formatted);
                } else {
                    $btn.text(text);
                }
            };
            renderPreview();
            $btn.on('click', () => applyChoice(currentChoices[index]));

            // --- Edit control ---
            const $edit = $('<button type="button" class="next-choices-edit next-choices-tool"></button>');
            $edit.text(tr('Edit'));
            $edit.attr('aria-label', `${tr('Edit choice')} ${number}`);

            // --- Inline editor (hidden until Edit is pressed) ---
            const $editor = $('<div class="next-choices-editor"></div>').hide();
            const $input = $('<textarea class="text_pole next-choices-edit-input" rows="4"></textarea>');
            $input.attr('aria-label', `${tr('Edit choice')} ${number}`);
            // Keep Enter as a native newline; stop it from bubbling to host
            // shortcuts without interfering with native editing. No submit
            // shortcut: applying is explicit.
            $input.on('keydown', (event) => event.stopPropagation());

            const $apply = $('<button type="button" class="next-choices-apply next-choices-tool"></button>');
            $apply.text(tr('Apply changes'));
            const $reset = $('<button type="button" class="next-choices-reset next-choices-tool"></button>');
            $reset.text(tr('Reset changes'));

            const refreshApplyState = () => {
                const hasText = String($input.val() ?? '').trim().length > 0;
                $apply.prop('disabled', !hasText);
            };
            $input.on('input', refreshApplyState);

            const setEditing = (editing) => {
                if (editing) {
                    openEditors++;
                    $btn.hide();
                    $edit.hide();
                    $editor.show();
                    $input.trigger('focus');
                } else {
                    openEditors = Math.max(0, openEditors - 1);
                    $editor.hide();
                    $btn.show();
                    $edit.show();
                }
                refreshGuidanceAvailability();
            };
            $edit.on('click', () => {
                $input.val(currentChoices[index]);
                refreshApplyState();
                setEditing(true);
            });

            // Apply stores the exact draft (whitespace/newlines preserved);
            // trimming is for validation only. Unchanged nonempty text may be
            // applied so it just closes editing.
            $apply.on('click', () => {
                const draft = String($input.val() ?? '');
                if (!draft.trim()) return;
                currentChoices[index] = draft;
                renderPreview();
                setEditing(false);
                $edit.trigger('focus');
            });

            // Reset discards the draft; the committed text in currentChoices is
            // deliberately untouched, so a first-time reset restores the
            // original generated text and a later one restores the last
            // applied edit.
            $reset.on('click', () => {
                $input.val('');
                setEditing(false);
                $edit.trigger('focus');
            });

            const $actions = $('<div class="next-choices-edit-actions"></div>');
            $actions.append($apply, $reset);
            $editor.append($input, $actions);
            $row.append($btn, $edit, $editor);
            $list.append($row);
            rowRefs.push({ $btn, $edit });
        });

        // The toolbar's Enhance button exists only because a toggle callback
        // is supplied here; renderError passes none and gets no button. The
        // generation theme is forwarded so Regenerate repeats this render.
        const toolbar = makeToolbar(() => {
            if (enhancementBusy) return;
            setPanelOpen(!$panelWrap.is(':visible'));
        }, generationGuidance);

        // --- Guidance panel (hidden until the Enhance toolbar button) ---
        // The wrap is the disclosure unit: it carries the live status as a
        // sibling of the panel (outside its aria-busy subtree), so it — not
        // the bare panel — is what gets shown/hidden. Hiding only the panel
        // would leave error/edit notices rendered and announcing while the
        // panel is closed.
        const $panelWrap = $('<div class="next-choices-guidance-wrap"></div>').hide();
        const $panel = $('<div class="next-choices-guidance" id="next_choices_guidance_panel"></div>');
        const $panelLabel = $('<label for="next_choices_guidance_input"></label>').text(tr('Enhancement prompt'));
        const $guidanceInput = $('<textarea id="next_choices_guidance_input" class="text_pole next-choices-guidance-input" rows="3"></textarea>');
        const $panelHint = $('<div class="next-choices-guidance-hint"></div>')
            .text(tr("Keeps each choice's main content and adds your direction."));
        // Same keydown policy as the row editors: Enter stays a native
        // newline and host shortcuts never see this textarea. Submission is
        // explicit; there is no implicit shortcut.
        $guidanceInput.on('keydown', (event) => event.stopPropagation());

        const $status = $('<div class="next-choices-guidance-status" role="status" aria-live="polite"></div>');
        const setStatus = (message) => { $status.text(message ?? ''); };

        const $submit = $('<button type="button" class="next-choices-tool next-choices-guidance-submit"></button>')
            .text(tr('Enhance choices'));
        const $stopEnhance = $('<button type="button" class="next-choices-tool next-choices-enhance-stop"></button>')
            .text(tr('Stop enhancing'))
            .hide();
        let enhancementRequestId = null;
        $stopEnhance.on('click', () => {
            if (!enhancementBusy || enhancementRequestId !== requestId || !isViewCurrent()) return;
            abortPending();
            setBusy(false);
            $guidanceInput.trigger('focus');
        });

        // Localize the base exemplars first, then splice the persona name into
        // the translated template so host dictionaries only ever see stable keys.
        function placeholderExemplars() {
            const ctx = getContext();
            const name = (ctx?.name1 || '').trim();
            if (!name) return tr('e.g. reassure her');
            return tr('e.g. have {name} reassure her').replaceAll('{name}', name);
        }

        const $panelClose = $('<button type="button" class="next-choices-tool next-choices-guidance-close"></button>')
            .text(tr('Close'));

        const setPanelControlsDisabled = (disabled) => {
            $guidanceInput.prop('disabled', disabled);
            $submit.prop('disabled', disabled);
            $panelClose.prop('disabled', disabled);
        };

        const refreshGuidanceAvailability = () => {
            const hasGuidance = String($guidanceInput.val() ?? '').trim().length > 0;
            const editing = openEditors > 0;
            const busy = enhancementBusy;
            $submit.prop('disabled', busy || !hasGuidance || editing);
            if (editing) {
                setStatus(tr('Apply or reset your edits before enhancing choices.'));
            } else if (!busy) {
                setStatus('');
            }
            // While busy the panel keeps its busy notice; setBusy owns it.
        };
        $guidanceInput.on('input', refreshGuidanceAvailability);

        const setPanelOpen = (open) => {
            if (open) {
                $panelWrap.show();
                // Persona can change between openings; refresh the exemplar
                // each time so it stays current and localized.
                $guidanceInput.attr('placeholder', placeholderExemplars());
                toolbar.$enhance.attr('aria-expanded', 'true');
                $guidanceInput.trigger('focus');
            } else {
                // Closing keeps the draft for this displayed list; the draft
                // only dies with the list itself (dismiss / re-render).
                $panelWrap.hide();
                toolbar.$enhance.attr('aria-expanded', 'false');
                toolbar.$enhance.trigger('focus');
            }
        };
        $panelClose.on('click', () => {
            if (!enhancementBusy) setPanelOpen(false);
        });

        const setBusy = (busy) => {
            enhancementBusy = busy;
            setRowsInteractive(!busy);
            $list.toggleClass('next-choices-list-locked', busy);
            toolbar.$enhance.prop('disabled', busy);
            $panel.attr('aria-busy', busy ? 'true' : 'false');
            setPanelControlsDisabled(busy);
            $stopEnhance.toggle(busy);
            if (busy) {
                setStatus(tr('Enhancing choices…'));
            } else {
                refreshGuidanceAvailability();
            }
        };

        const isViewCurrent = () => document.getElementById(CONTAINER_ID) === $container[0]
            && $content.parent()[0] === $container[0]
            && $container.children()[0] === $content[0];

        const setRowsInteractive = (interactive) => {
            for (const row of rowRefs) {
                row.$btn.prop('disabled', !interactive);
                row.$edit.prop('disabled', !interactive);
            }
        };

        const enhanceDisplayedChoices = async () => {
            if (enhancementBusy) return;
            if (!isViewCurrent() || !getSettings().enabled) return;

            const guidance = String($guidanceInput.val() ?? '').trim();
            if (!guidance) return;

            const ctx = getContext();
            if (!ctx || !getLastMessage(ctx)) {
                // Keep rows and the entered guidance; only report.
                setStatus(tr('No conversation is available to enhance these choices.'));
                return;
            }
            if (openEditors > 0) {
                refreshGuidanceAvailability();
                return;
            }

            // Snapshot committed text and settings before any await: edits
            // or preference changes made while the request is in flight must
            // not leak into this request or its validation count.
            const originals = currentChoices.slice();
            const settings = { ...getSettings() };

            clearTimeout(autoGenerateTimer);
            abortPending();
            const myRequestId = requestId;
            enhancementRequestId = myRequestId;
            const requestController = typeof AbortController !== 'undefined' ? new AbortController() : null;
            abortController = requestController;
            generating = true;
            setBusy(true);

            let response;
            try {
                const prompt = buildEnhancementPrompt(ctx, settings, originals, guidance);
                response = await sendRawRequest(ctx, settings, prompt, requestController?.signal, myRequestId);
            } catch (err) {
                if (myRequestId !== requestId) return; // stale, ignore
                generating = false;
                // Same detached-view guard as the success path: a rejected
                // request for a dismissed list must not resurrect controls or
                // log noise for UI that was deliberately discarded.
                if (!isViewCurrent()) return;
                setBusy(false);
                console.error(`[${MODULE_NAME}] Enhancement failed:`, err);
                setStatus(tr('Failed to enhance choices: ') + (err?.message ?? String(err)));
                return;
            }

            if (myRequestId !== requestId) return; // stale, ignore
            generating = false;

            // Second guard: even when the underlying request could not be
            // aborted, a detached/replaced view must never resurrect old
            // choices or surface an error into the new view.
            if (!isViewCurrent()) return;

            const enhanced = parseEnhancedChoices(response, originals.length);
            if (!enhanced) {
                setBusy(false);
                setStatus(tr('Could not parse one enhanced choice for every original choice. Try again.'));
                return;
            }

            // Success: one atomic replace. The new render owns fresh state;
            // its panel starts hidden with an empty draft, and the next
            // enhancement uses the enhanced text as its committed baseline.
            // The captured generation theme is forwarded: the enhancement
            // direction is not the theme these options were generated from.
            renderChoices(enhanced, generationGuidance);
            const $newEnhance = $(`#${CONTAINER_ID} .next-choices-enhance`).first();
            if ($newEnhance.length) $newEnhance.trigger('focus');
        };

        $submit.on('click', () => enhanceDisplayedChoices());

        const $panelActions = $('<div class="next-choices-guidance-actions"></div>');
        $panelActions.append($submit, $stopEnhance, $panelClose);
        // The live status stays OUTSIDE the panel: aria-busy on an ancestor
        // makes assistive tech defer live-region updates inside it, so the
        // "Enhancing choices…" announcement would never be spoken.
        // The live status stays OUTSIDE the panel (see the wrap declaration
        // above): aria-busy on an ancestor makes assistive tech defer
        // live-region updates inside it.
        $panelWrap.append($panel, $status);
        $panel.append($panelLabel, $guidanceInput, $panelHint, $panelActions);

        // Initial availability pass: without it a freshly rendered panel would
        // open with submit enabled even though the draft is empty (the input
        // handler only fires after the user types).
        refreshGuidanceAvailability();

        const $content = $('<div class="next-choices-content"></div>');
        $content.append($list, $panelWrap);
        $container.append($content, toolbar.$toolbar);
    }

    function applyChoice(choiceText) {
        const settings = getSettings();
        try {
            const $ta = $('#send_textarea');
            if (!$ta.length) return;
            $ta.val(choiceText);
            $ta[0].dispatchEvent(new Event('input', { bubbles: true }));
            clearChoicesUI();
            if (settings.autoSend) {
                $('#send_but').trigger('click');
            } else {
                $ta.trigger('focus');
            }
        } catch (err) {
            console.error(`[${MODULE_NAME}] Failed to apply choice:`, err);
        }
    }

    // =========================================================================
    // UI: settings panel
    // =========================================================================

    function getSettingsHtmlFallback() {
        return `<div class="next-choices-settings"><p>${tr('Failed to load the Next Choices settings panel.')}</p></div>`;
    }

    function getExtensionBaseUrl() {
        // Third-party extensions live under /scripts/extensions/third-party/<repo>.
        // import.meta is unavailable in this classic-script IIFE, so derive from
        // the known install path; fetch failures fall back gracefully anyway.
        return 'scripts/extensions/third-party/next-choices';
    }

    async function loadSettingsHtml() {
        try {
            const response = await fetch(`${getExtensionBaseUrl()}/settings.html`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.text();
        } catch (err) {
            console.error(`[${MODULE_NAME}] Failed to load settings.html:`, err);
            return getSettingsHtmlFallback();
        }
    }

    function getConnectionProfiles(ctx) {
        const profiles = ctx?.extensionSettings?.connectionManager?.profiles;
        return Array.isArray(profiles) ? profiles : [];
    }

    function rebuildProfileDropdown() {
        const ctx = getContext();
        const settings = getSettings();
        const $select = $('#next_choices_profile');
        if (!$select.length) return;

        const hasCMRS = !!ctx?.ConnectionManagerRequestService?.sendRequest;
        $select.empty();
        $select.append($('<option value="current"></option>').text(tr('Current connection settings')));

        if (hasCMRS) {
            for (const profile of getConnectionProfiles(ctx)) {
                if (!profile?.id) continue;
                $select.append(
                    $('<option></option>').attr('value', profile.id).text(profile.name ?? profile.id),
                );
            }
            $('#next_choices_no_cm_hint').hide();
        } else {
            $('#next_choices_no_cm_hint').show();
        }

        // Restore selection; fall back to 'current' if the profile vanished.
        if ($select.find(`option[value="${CSS?.escape ? CSS.escape(settings.profileId) : settings.profileId}"]`).length) {
            $select.val(settings.profileId);
        } else {
            $select.val('current');
            if (settings.profileId !== 'current') {
                settings.profileId = 'current';
                saveSettings();
            }
        }
    }

    function bindSettingsUI() {
        // NOTE: never capture the settings object in a long-lived closure here.
        // Handlers call getSettings() at event time so they always write to the
        // live object stored in ctx.extensionSettings.

        // Initial values
        $('#next_choices_enabled').prop('checked', getSettings().enabled);
        $('#next_choices_auto_generate').prop('checked', getSettings().autoGenerate);
        $('#next_choices_auto_send').prop('checked', getSettings().autoSend);
        $('#next_choices_show_quick_generate').prop('checked', getSettings().showQuickGenerateButton);
        $('#next_choices_num').val(getSettings().numChoices);
        $('#next_choices_max_tokens').val(getSettings().maxTokens);
        $('#next_choices_history_depth').val(getSettings().historyDepth);
        $('#next_choices_prompt').val(getSettings().promptTemplate);
        rebuildProfileDropdown();

        // Handlers
        $('#next_choices_enabled').on('change', function () {
            const enabled = !!$(this).prop('checked');
            getSettings().enabled = enabled;
            saveSettings();
            clearTimeout(autoGenerateTimer);
            abortPending();
            clearChoicesUI();
            // Both wand entries follow the enabled state; the composer
            // shortcuts are additionally gated by their own preference.
            $(`#${WAND_BUTTON_ID}, #${GUIDED_WAND_BUTTON_ID}`).toggle(enabled);
            updateQuickGenerateButton();
        });
        $('#next_choices_auto_generate').on('change', function () {
            getSettings().autoGenerate = !!$(this).prop('checked');
            saveSettings();
            clearTimeout(autoGenerateTimer);
            abortPending();
            clearChoicesUI();
        });
        $('#next_choices_auto_send').on('change', function () {
            getSettings().autoSend = !!$(this).prop('checked');
            saveSettings();
        });
        // Purely a display preference: it never touches the choices list,
        // in-flight generations, or auto-generation.
        $('#next_choices_show_quick_generate').on('change', function () {
            getSettings().showQuickGenerateButton = !!$(this).prop('checked');
            saveSettings();
            updateQuickGenerateButton();
        });
        $('#next_choices_profile').on('change', function () {
            getSettings().profileId = String($(this).val() || 'current');
            saveSettings();
        });
        $('#next_choices_num').on('input change', function () {
            const value = parseInt($(this).val(), 10);
            getSettings().numChoices = Number.isFinite(value) && value > 0 ? Math.min(value, 10) : DEFAULT_SETTINGS.numChoices;
            saveSettings();
        });
        $('#next_choices_max_tokens').on('input change', function () {
            const value = parseInt($(this).val(), 10);
            getSettings().maxTokens = Number.isFinite(value) && value > 0 ? value : DEFAULT_SETTINGS.maxTokens;
            saveSettings();
        });
        $('#next_choices_history_depth').on('input change', function () {
            const value = parseInt($(this).val(), 10);
            getSettings().historyDepth = Number.isFinite(value) && value > 0 ? value : DEFAULT_SETTINGS.historyDepth;
            saveSettings();
        });
        $('#next_choices_prompt').on('input change', function () {
            getSettings().promptTemplate = String($(this).val() ?? '') || DEFAULT_PROMPT_TEMPLATE;
            saveSettings();
        });
        $('#next_choices_prompt_reset').on('click', function () {
            getSettings().promptTemplate = DEFAULT_PROMPT_TEMPLATE;
            $('#next_choices_prompt').val(DEFAULT_PROMPT_TEMPLATE);
            saveSettings();
        });

        // Rebuild the profile list every time the drawer is opened, so newly
        // created/deleted connection profiles show up without extra event wiring.
        $('#next_choices_settings_drawer .inline-drawer-toggle').on('click', () => {
            setTimeout(rebuildProfileDropdown, 0);
        });
    }

    /**
     * Manual translation pass over the settings panel, as a safety net in case
     * SillyTavern's own data-i18n observer does not process dynamically
     * appended extension HTML. Uses the data-i18n attribute value as the key
     * (supporting plain keys, "[attr]key" syntax, and semicolon-separated
     * multi-part specs), so running it repeatedly is idempotent and it does
     * not conflict with ST's built-in handling.
     */
    function applyI18nToPanel($panel) {
        try {
            const ctx = getContext();
            if (typeof ctx?.translate !== 'function') return;
            $panel.find('[data-i18n]').addBack('[data-i18n]').each(function () {
                const spec = this.getAttribute('data-i18n');
                if (!spec) return;
                for (const part of spec.split(';')) {
                    try {
                        const attrMatch = part.match(/^\[(.+?)\](.+)$/);
                        if (attrMatch) {
                            const translated = ctx.translate(attrMatch[2]);
                            if (typeof translated === 'string') this.setAttribute(attrMatch[1], translated);
                        } else {
                            const translated = ctx.translate(part);
                            if (typeof translated === 'string') this.textContent = translated;
                        }
                    } catch { /* ignore this part */ }
                }
            });
        } catch (err) {
            console.warn(`[${MODULE_NAME}] applyI18nToPanel failed:`, err);
        }
    }

    async function initSettingsPanel() {
        const html = await loadSettingsHtml();
        const $target = $('#extensions_settings2').length
            ? $('#extensions_settings2')
            : $('#extensions_settings');
        if (!$target.length) {
            console.warn(`[${MODULE_NAME}] No extensions settings container found.`);
            return;
        }
        const $panel = $(html);
        $target.append($panel);
        applyI18nToPanel($panel);
        bindSettingsUI();
    }

    // =========================================================================
    // UI: wand menu entry
    // =========================================================================

    /**
     * Adds one entry to SillyTavern's wand (magic wand) menu, creating it once
     * and toggling its visibility afterwards. Idempotent per id, so a missing
     * or removed sibling entry never blocks the other one. `onClick` receives
     * the entry element, which launchers that open a panel reuse as the focus
     * return target.
     */
    function addWandMenuItem({ id, icon, label, onClick, visible, controls = null }) {
        let $item = $(`#${id}`).first();
        if (!$item.length) {
            let $menu = $('#extensionsMenu');
            if (!$menu.length) $menu = $('#extensions_menu');
            if (!$menu.length) {
                console.warn(`[${MODULE_NAME}] Wand menu container not found; ${id} not added.`);
                return null;
            }
            $item = $(`<div id="${id}" class="list-group-item flex-container flexGap5 interactable" tabindex="0"></div>`);
            $item.append(`<div class="fa-solid ${icon} extensionsMenuExtensionButton"></div>`);
            $item.append($('<span></span>').text(label));
            $item.on('click', () => onClick($item[0]));
            $menu.append($item);
        }
        if (controls) {
            $item.attr('aria-controls', controls);
            if (typeof $item.attr('aria-expanded') === 'undefined') $item.attr('aria-expanded', 'false');
        }
        $item.toggle(!!visible);
        return $item;
    }

    /**
     * Adds the wand (magic wand) menu entries: plain generation and guided
     * generation (which only opens the theme editor). Both stay available
     * whenever the extension is enabled, independently of whether the composer
     * shortcuts are shown, so guided generation is never unreachable.
     */
    function addWandMenuButton() {
        const enabled = !!getSettings().enabled;
        addWandMenuItem({
            id: WAND_BUTTON_ID,
            icon: 'fa-dice',
            label: tr('Generate Choices'),
            onClick: () => generateChoices('manual'),
            visible: enabled,
        });
        addWandMenuItem({
            id: GUIDED_WAND_BUTTON_ID,
            icon: 'fa-compass',
            label: tr('Generate choices (guided)'),
            // Only opens the editor; the request is issued by its submit button.
            onClick: (opener) => setGenerationGuidanceOpen(!generationGuidanceUi?.open, opener),
            visible: enabled,
            controls: GUIDANCE_WRAPPER_ID,
        });
        // A recreated wand entry loses its aria state with the old node.
        syncGenerationGuidanceAria();
    }

    // =========================================================================
    // UI: composer quick-generate shortcut
    // =========================================================================

    const WAND_BUTTON_ID = 'next_choices_wand_button';
    const QUICK_BUTTON_ID = 'next_choices_quick_generate';
    const QUICK_ROW_ID = 'next_choices_quick_actions';
    const QUICK_HOST_CLASS = 'next-choices-quick-host';
    const GUIDED_BUTTON_ID = 'next_choices_guided_generate';
    const GUIDED_WAND_BUTTON_ID = 'next_choices_guided_wand_button';
    const GUIDANCE_WRAPPER_ID = 'next_choices_generation_guidance';
    const GUIDANCE_PANEL_ID = 'next_choices_generation_guidance_panel';
    const GUIDANCE_INPUT_ID = 'next_choices_theme_input';
    const QUICK_IMPERSONATE_SELECTOR =
        '#gg_impersonate_button, #gg_impersonate_button_2nd, #gg_impersonate_button_3rd';
    const QUICK_WATCH_SELECTOR = [
        '#send_form',
        '#nonQRFormItems',
        '#gg-action-button-container',
        '#gg-regular-buttons-container',
        `#${QUICK_ROW_ID}`,
        `#${QUICK_BUTTON_ID}`,
        `#${GUIDED_BUTTON_ID}`,
        `#${GUIDANCE_WRAPPER_ID}`,
    ].join(', ');

    let quickGenerateObserver = null;
    // Owned DOM, tracked by reference as well as by id: a detached #send_form
    // (and everything inside it) cannot be reached by document lookups, but
    // must still be torn down when the shortcut is turned off.
    let quickGenerateButton = null;
    let guidedGenerateButton = null;
    let quickGenerateRow = null;
    let quickGenerateMarkedHost = null;

    // =========================================================================
    // UI: composer theme editor (guided generation)
    // =========================================================================

    // Owned editor DOM plus its launch state. The textarea owns the draft; the
    // panel is only ever shown or hidden with it, and resetGenerationGuidanceUI
    // discards the whole tree. Deliberately separate from
    // #next_choices_container, so loading, errors, enhancement, and choice
    // rendering never erase the draft. The draft is never persisted to
    // settings, chat metadata, browser storage, or chat messages.
    let generationGuidanceUi = null;

    /** True when a node is in the document and takes up space. */
    function isRendered(node) {
        return node instanceof HTMLElement && node.isConnected && node.getClientRects().length > 0;
    }

    /**
     * Keeps aria-expanded on both guided launchers in sync with the editor.
     * Writes to the owned node directly: a button that was just recreated is
     * still detached, where an id lookup cannot see it, and it would otherwise
     * keep advertising a closed editor while the panel is open. Also used
     * right after a launcher is (re)created, which loses its state with the
     * old node.
     */
    function syncGenerationGuidanceAria() {
        const open = generationGuidanceUi?.open ? 'true' : 'false';
        guidedGenerateButton?.setAttribute('aria-expanded', open);
        document.getElementById(GUIDED_WAND_BUTTON_ID)?.setAttribute('aria-expanded', open);
    }

    /** Submit needs a nonempty theme and no pending guided request. */
    function refreshGuidanceSubmitState() {
        const ui = generationGuidanceUi;
        if (!ui) return;
        const hasTheme = String(ui.$input.val() ?? '').trim().length > 0;
        ui.$submit.prop('disabled', ui.busy || !hasTheme);
    }

    function createGenerationGuidanceUI() {
        const $wrapper = $(`<div id="${GUIDANCE_WRAPPER_ID}" class="next-choices-guidance-wrap"></div>`).hide();
        const $panel = $(`<div class="next-choices-guidance" id="${GUIDANCE_PANEL_ID}"></div>`);
        const $label = $(`<label for="${GUIDANCE_INPUT_ID}"></label>`).text(tr('Choice theme'));
        const $input = $(`<textarea id="${GUIDANCE_INPUT_ID}" class="text_pole next-choices-guidance-input" rows="3"></textarea>`)
            .attr('placeholder', tr('e.g. invite her to dance'));
        const $hint = $('<div class="next-choices-guidance-hint"></div>')
            .text(tr("Use one main theme while keeping each choice's tone and approach from your prompt template."));
        const $actions = $('<div class="next-choices-guidance-actions"></div>');
        const $submit = $('<button type="button" class="next-choices-tool next-choices-guidance-submit"></button>')
            .text(tr('Generate choices (guided)'));
        const $close = $('<button type="button" class="next-choices-tool next-choices-guidance-close"></button>')
            .text(tr('Close'));
        // The live status stays OUTSIDE the panel: aria-busy on an ancestor
        // makes assistive tech defer live-region updates inside it, so the
        // pending announcement would never be spoken.
        const $status = $('<div class="next-choices-guidance-status" role="status" aria-live="polite"></div>');

        $actions.append($submit, $close);
        $panel.append($label, $input, $hint, $actions);
        $wrapper.append($panel, $status);

        // Same keydown policy as the row editors and the enhancement panel:
        // Enter stays a native newline, and the global .interactable Enter
        // handler never sees this textarea. Submission is explicit, and the
        // main composer is never written to or submitted from here.
        $input.on('keydown', (event) => event.stopPropagation());
        $input.on('input', refreshGuidanceSubmitState);

        const ui = {
            $wrapper,
            $panel,
            $input,
            $submit,
            $close,
            $status,
            open: false,
            busy: false,
            // Element that opened the editor, so focus can return to it.
            opener: null,
        };

        $submit.on('click', () => {
            if (ui !== generationGuidanceUi || ui.busy) return;
            const theme = String($input.val() ?? '').trim();
            if (!theme) return;
            const ctx = getContext();
            if (!ctx || !getLastMessage(ctx)) {
                // Keep the draft; only report. No request is issued.
                ui.$status.text(tr('No conversation is available to generate choices.'));
                return;
            }
            generateChoices('guided', theme);
        });
        $close.on('click', () => setGenerationGuidanceOpen(false));

        return ui;
    }

    /**
     * Lazily creates the editor and returns it, then reconciles its host. The
     * DOM is created even before a composer exists so a draft is retained for
     * later reconciliation; it is simply not reachable until it is mounted.
     */
    function getGenerationGuidanceUI() {
        if (!generationGuidanceUi) {
            generationGuidanceUi = createGenerationGuidanceUI();
            // The editor outlives the composer shortcut preference (the wand
            // entry can open it while no shortcut is shown), so its own host
            // must be reconciled from the moment it exists. Without this the
            // reconciler would only run again on the next settings toggle, and
            // a composer rebuild would leave the editor detached with its
            // draft until then.
            if (getSettings().enabled) startQuickGenerateObserver();
        }
        syncGenerationGuidanceUI();
        return generationGuidanceUi;
    }

    /**
     * Moves the existing editor (never creates one) to the current composer
     * host and copies that host's flex order, so the editor renders above the
     * toolbar rather than merely before it in the DOM.
     *
     * Priority host: the first of these that is a direct child of #send_form.
     * Guided Generations' container is destructively rebuilt, so the editor is
     * a sibling of it, never a descendant, and never inside .interactable.
     */
    function syncGenerationGuidanceUI() {
        const ui = generationGuidanceUi;
        if (!ui) return;

        const sendForm = document.getElementById('send_form');
        if (!sendForm) return; // no composer: keep the draft for later

        const wrapper = ui.$wrapper[0];
        // A composer replacement can leave a cloned duplicate wrapper behind.
        // CloneNode drops bound handlers, so the duplicate is dropped instead
        // of adopted, and our own node (with the draft) is moved back.
        const duplicate = document.getElementById(GUIDANCE_WRAPPER_ID);
        if (duplicate && duplicate !== wrapper) duplicate.remove();

        let host = null;
        for (const id of ['gg-action-button-container', QUICK_ROW_ID, 'nonQRFormItems']) {
            const candidate = document.getElementById(id);
            if (candidate && candidate.parentElement === sendForm) {
                host = candidate;
                break;
            }
        }

        const placed = wrapper.parentElement === sendForm && wrapper.nextElementSibling === host;
        if (!placed) {
            if (host) sendForm.insertBefore(wrapper, host);
            else sendForm.appendChild(wrapper);
        }

        // Fallback order matches #nonQRFormItems' row so an unmounted host
        // still yields a full-width editor above the composer rows.
        const order = host ? getComputedStyle(host).order : '25';
        if (wrapper.style.order !== order) wrapper.style.order = order;
    }

    /**
     * Toggles the editor. Opening focuses the theme box and never issues a
     * request; closing only hides, so it neither cancels a pending request nor
     * discards the draft. Returns false when there is no composer to show it in.
     */
    function setGenerationGuidanceOpen(open, opener = null) {
        const ui = getGenerationGuidanceUI();
        const wrapper = ui.$wrapper[0];

        if (!open) {
            // Decided before hiding: a hidden element cannot hold focus, so
            // this must be read while the close control is still visible.
            const focusInside = wrapper.contains(document.activeElement);
            ui.$wrapper.hide();
            ui.open = false;
            syncGenerationGuidanceAria();
            if (focusInside) restoreGenerationGuidanceFocus(ui);
            return true;
        }

        if (opener instanceof Element) ui.opener = opener;
        if (!wrapper.isConnected) return false; // composer not mounted yet
        ui.$wrapper.show();
        ui.open = true;
        syncGenerationGuidanceAria();
        refreshGuidanceSubmitState();
        ui.$input.trigger('focus');
        return true;
    }

    /**
     * Returns focus to whatever launched the editor, falling back to the
     * visible composer shortcut and then the message box.
     */
    function restoreGenerationGuidanceFocus(ui) {
        const candidates = [ui.opener, document.getElementById(GUIDED_BUTTON_ID), document.getElementById('send_textarea')];
        for (const candidate of candidates) {
            if (isRendered(candidate)) {
                candidate.focus();
                return;
            }
        }
    }

    function restoreFocusAfterGenerationStop(target) {
        const launchers = [
            document.getElementById(WAND_BUTTON_ID),
            document.getElementById(QUICK_BUTTON_ID),
            document.getElementById(GUIDED_BUTTON_ID),
            document.getElementById(GUIDED_WAND_BUTTON_ID),
        ];
        const sendForm = document.getElementById('send_form');
        // Preserve the original target only when it belongs to this extension's
        // launchers or the live composer; auto generation may start elsewhere.
        const targetIsInComposerOrLauncher = !!target
            && (launchers.includes(target) || !!sendForm?.contains(target));
        const candidates = targetIsInComposerOrLauncher ? [target, ...launchers] : launchers;
        candidates.push(document.getElementById('send_textarea'), document.getElementById('send_but'));
        for (const candidate of candidates) {
            if (candidate && candidate !== document.body && isRendered(candidate) && !candidate.disabled) {
                candidate.focus();
                return;
            }
        }
    }


    /**
     * Locks the editor for the duration of its own guided request. Released on
     * that request's terminal path only, and unconditionally by abortPending()
     * so any interruption cannot leave the submit control stuck.
     */
    function setGenerationGuidanceBusy(busy) {
        const ui = generationGuidanceUi;
        if (!ui) return;
        ui.busy = !!busy;
        ui.$panel.attr('aria-busy', ui.busy ? 'true' : 'false');
        ui.$input.prop('disabled', ui.busy);
        ui.$status.text(ui.busy ? tr('Generating choices…') : '');
        refreshGuidanceSubmitState();
    }

    /**
     * Discards the editor and its draft. Used when the conversation turn is
     * invalidated (chat change, swipe, edit, delete, new generation) and when
     * the extension is disabled.
     */
    function resetGenerationGuidanceUI() {
        const ui = generationGuidanceUi;
        generationGuidanceUi = null;
        if (ui) {
            ui.$input.val('');
            ui.$wrapper.remove();
        } else {
            // Safety net for a wrapper this module instance did not create.
            document.getElementById(GUIDANCE_WRAPPER_ID)?.remove();
        }
        syncGenerationGuidanceAria();
    }

    function quickGenerateWanted() {
        const settings = getSettings();
        return !!settings.enabled && !!settings.showQuickGenerateButton;
    }

    function createQuickGenerateButton() {
        const $button = $('<button></button>')
            .attr('type', 'button')
            .attr('id', QUICK_BUTTON_ID)
            .addClass('next-choices-quick-generate next-choices-tool interactable')
            .attr('title', tr('Generate choices'))
            .attr('aria-label', tr('Generate choices'));
        $button.append('<i class="fa-solid fa-dice" aria-hidden="true"></i>');
        // Same entrypoint as the wand menu item: it only generates choices.
        // Never applies a choice, submits the composer, or saves settings.
        $button.on('click', () => {
            // Re-read at click time: the preference or the whole extension may
            // have been switched off after this button was mounted.
            if (!quickGenerateWanted()) return;
            // Stays one-click unguided even when the theme box holds text.
            generateChoices('manual');
        });
        quickGenerateButton = $button[0];
        return $button;
    }

    function createGuidedGenerateButton() {
        const $button = $('<button></button>')
            .attr('type', 'button')
            .attr('id', GUIDED_BUTTON_ID)
            .addClass('next-choices-quick-generate next-choices-tool interactable')
            .attr('title', tr('Generate choices (guided)'))
            .attr('aria-label', tr('Generate choices (guided)'))
            .attr('aria-controls', GUIDANCE_WRAPPER_ID)
            .attr('aria-expanded', 'false');
        $button.append('<i class="fa-solid fa-compass" aria-hidden="true"></i>');
        // Only opens the theme editor; the request is issued by its submit
        // button, so opening never generates anything.
        $button.on('click', () => {
            if (!quickGenerateWanted()) return;
            setGenerationGuidanceOpen(!generationGuidanceUi?.open, $button[0]);
        });
        guidedGenerateButton = $button[0];
        syncGenerationGuidanceAria();
        return $button;
    }

    // Ids this module instance has already created a bound node for. After
    // that, another node carrying the same id is never adopted: cloneNode()
    // copies markup but drops event handlers, and a stale copy sitting in a
    // subtree that was detached and later restored is equally inert.
    const ownedShortcutIds = new Set();

    /**
     * Returns a live, bound button for `id`.
     *
     * Exactly one node may carry each shortcut id. Our own node is reused even
     * while it is detached (a composer or toolbar rebuild moves it back with
     * its handlers and state intact) and any other node with that id is
     * removed rather than adopted, so a restored subtree cannot resurrect a
     * second, inert copy of the shortcut.
     */
    function resolveOwnedButton(id, owned, create) {
        if (owned) {
            for (const node of document.querySelectorAll(`#${id}`)) {
                if (node !== owned) node.remove();
            }
            return $(owned);
        }

        // No owned node: adopt what the page already has only on first
        // sighting (for example an extension script loaded twice). After this
        // module has created a node for the id, a node it does not hold is a
        // clone (cloneNode drops handlers) or a stale copy from a restored
        // subtree, so it is removed and replaced instead of adopted. Nothing
        // removed here may be returned: the NodeList is static and would hand
        // back a detached, handler-less node for the caller to re-insert.
        const found = document.querySelectorAll(`#${id}`);
        if (found.length && !ownedShortcutIds.has(id)) {
            for (let i = 1; i < found.length; i++) found[i].remove();
            return $(found[0]);
        }
        for (const node of found) node.remove();
        const $button = create();
        ownedShortcutIds.add(id);
        return $button;
    }

    /**
     * Puts the ordered pair [dice, compass] immediately before the first
     * impersonate button in Guided Generations' regular button row when that
     * row exists, and in an owned full-width fallback row inside #send_form
     * otherwise. Creates missing buttons and never duplicates them, so it is
     * safe to call on every relevant DOM mutation.
     */
    function syncQuickGenerateButton() {
        if (!quickGenerateWanted()) return;

        const sendForm = document.getElementById('send_form');
        if (!sendForm) return; // composer not in the DOM yet; reconcile later

        const $dice = resolveOwnedButton(QUICK_BUTTON_ID, quickGenerateButton, createQuickGenerateButton);
        const $compass = resolveOwnedButton(GUIDED_BUTTON_ID, guidedGenerateButton, createGuidedGenerateButton);
        const dice = $dice[0];
        const compass = $compass[0];
        // Hold the live node even when it was adopted rather than created, so
        // teardown and later reconciles always treat it as ours.
        quickGenerateButton = dice;
        guidedGenerateButton = compass;
        // A button that was just created (or restored from the DOM) carries no
        // launch state, so both launchers are re-synchronized after placement.
        syncGenerationGuidanceAria();

        const regularHost = document.getElementById('gg-regular-buttons-container');
        if (regularHost && sendForm.contains(regularHost)) {
            const actionHost = document.getElementById('gg-action-button-container');
            if (actionHost && !actionHost.classList.contains(QUICK_HOST_CLASS)) {
                actionHost.classList.add(QUICK_HOST_CLASS);
            }
            quickGenerateMarkedHost = actionHost;

            // Marked position: the slot left of the person/impersonate
            // buttons. Other Guided Generations tools keep their own order.
            // Direct children only: insertBefore() throws NotFoundError for a
            // node nested deeper under the container, and a nested person
            // control is not the marked slot anyway.
            const reference = Array.from(regularHost.children)
                .find((child) => child.matches(QUICK_IMPERSONATE_SELECTOR)) ?? null;
            // Both adjacency and the trailing reference are checked: keeping
            // only the old single-button condition would let a foreign node
            // wedge itself between the pair and reorder it on every mutation.
            const placed = dice.parentElement === regularHost
                && dice.nextElementSibling === compass
                && (reference
                    ? compass.nextElementSibling === reference
                    : regularHost.firstElementChild === dice);
            if (!placed) {
                // Inserting the compass first keeps the pair's order even when
                // the dice is currently the container's first child.
                regularHost.insertBefore(compass, reference ?? regularHost.firstElementChild);
                regularHost.insertBefore(dice, compass);
            }

            // The fallback row only exists while Guided Generations has no
            // mount point of its own.
            detachOwnedRow();
            syncGenerationGuidanceUI();
            return;
        }

        clearMarkedHost();

        // Reuse our own row while it is still in the document; otherwise fall
        // back to an id lookup so a row survives an extension reload and is
        // never duplicated.
        let row = quickGenerateRow?.isConnected ? quickGenerateRow : null;
        if (!row) row = document.getElementById(QUICK_ROW_ID);
        if (!row) {
            row = document.createElement('div');
            row.id = QUICK_ROW_ID;
            const nonQR = document.getElementById('nonQRFormItems');
            if (nonQR && nonQR.parentElement === sendForm) {
                sendForm.insertBefore(row, nonQR.nextSibling);
            } else {
                sendForm.appendChild(row);
            }
        }
        quickGenerateRow = row;
        // Appending both in order also repairs a pair that the row lost one
        // half of; the guard keeps an already-correct pair from producing a
        // mutation record on every batch.
        if (dice.parentElement !== row || dice.nextElementSibling !== compass) {
            row.appendChild(dice);
            row.appendChild(compass);
        }
        syncGenerationGuidanceUI();
    }

    function removeQuickGenerateButton() {
        // Reference-based teardown first: the shortcut can be sitting inside a
        // detached composer, where id lookups cannot reach it. Without this a
        // disable would leave it behind, and re-attaching that subtree would
        // show a shortcut the preference no longer asks for.
        quickGenerateButton?.remove();
        quickGenerateButton = null;
        guidedGenerateButton?.remove();
        guidedGenerateButton = null;
        detachOwnedRow();
        clearMarkedHost();
        // Safety nets for buttons this module instance did not create.
        document.getElementById(QUICK_BUTTON_ID)?.remove();
        document.getElementById(GUIDED_BUTTON_ID)?.remove();
        // The theme editor is deliberately left alone: hiding the composer
        // shortcuts is a display preference, and the wand entry can still open
        // (and reconcile) the editor.
    }

    /** Removes the owned fallback row, connected or detached. */
    function detachOwnedRow() {
        quickGenerateRow?.remove();
        quickGenerateRow = null;
        // Safety net for a row this module instance did not create.
        document.getElementById(QUICK_ROW_ID)?.remove();
    }

    /** Drops the Guided Generations host marker, connected or detached. */
    function clearMarkedHost() {
        quickGenerateMarkedHost?.classList.remove(QUICK_HOST_CLASS);
        quickGenerateMarkedHost = null;
        // Safety net for a host marked by an earlier module instance.
        document.getElementById('gg-action-button-container')?.classList.remove(QUICK_HOST_CLASS);
    }

    /**
     * True when this mutation batch can affect the shortcut's home. Focused on
     * the composer subtree so chat streaming, attribute churn, and typing are
     * ignored.
     */
    function mutationTouchesQuickHosts(record) {
        if (record.target instanceof Element && record.target.matches(QUICK_WATCH_SELECTOR)) return true;
        // Nothing under #chat can move the composer, and chat content is the
        // high-churn case (message blocks and streamed paragraphs are inserted
        // and removed constantly). Reject the batch before descending: a
        // removed node has no ancestors left, so this must use the mutation
        // target rather than the removed subtree.
        if (record.target instanceof Element && record.target.closest('#chat')) return false;
        const touches = (node) => node instanceof Element
            && (node.matches(QUICK_WATCH_SELECTOR) || !!node.querySelector(QUICK_WATCH_SELECTOR));
        for (const node of record.addedNodes) if (touches(node)) return true;
        for (const node of record.removedNodes) if (touches(node)) return true;
        return false;
    }

    function onComposerMutations(records) {
        // Re-check now rather than trusting the state at observe time: a batch
        // queued before the option was turned off must not remount anything.
        // The reconciler owns every branch (disabled, shortcuts hidden but the
        // editor open, or a moved host), so the observer never decides state on
        // its own.
        if (!quickGenerateWanted() && !generationGuidanceUi) {
            updateQuickGenerateButton();
            return;
        }
        for (const record of records) {
            if (mutationTouchesQuickHosts(record)) {
                updateQuickGenerateButton();
                return;
            }
        }
    }

    function startQuickGenerateObserver() {
        if (quickGenerateObserver || typeof MutationObserver !== 'function') return;
        quickGenerateObserver = new MutationObserver(onComposerMutations);
        // Guided Generations rebuilds its toolbar with innerHTML = '' and
        // emits no mount event, so the DOM is the only reliable signal.
        quickGenerateObserver.observe(document.body, { childList: true, subtree: true });
    }

    function stopQuickGenerateObserver() {
        quickGenerateObserver?.disconnect();
        quickGenerateObserver = null;
    }

    /**
     * Applies the current enabled + showQuickGenerateButton state: manages the
     * reconciliation observer and adds/removes the owned shortcut DOM.
     */
    function updateQuickGenerateButton() {
        const settings = getSettings();
        // Disabling discards the editor and its draft; hiding the composer
        // shortcuts deliberately does not.
        if (!settings.enabled) resetGenerationGuidanceUI();

        if (quickGenerateWanted()) {
            syncQuickGenerateButton();
        } else {
            removeQuickGenerateButton();
        }
        // The editor outlives the shortcut preference (the wand entry still
        // opens it) and its host can be rebuilt at any time, so it is
        // reconciled independently of whether the shortcuts are shown.
        if (generationGuidanceUi) syncGenerationGuidanceUI();

        if (settings.enabled && (quickGenerateWanted() || generationGuidanceUi)) {
            startQuickGenerateObserver();
        } else {
            stopQuickGenerateObserver();
        }
    }

    // =========================================================================
    // Events
    // =========================================================================

    let autoGenerateTimer = null;

    function onCharacterMessageRendered() {
        const settings = getSettings();
        if (!settings.enabled || !settings.autoGenerate) return;
        // Debounce: streaming / multi-part renders can fire this repeatedly.
        clearTimeout(autoGenerateTimer);
        autoGenerateTimer = setTimeout(() => {
            // Re-check: settings may have changed while the timer was pending.
            const current = getSettings();
            if (current.enabled && current.autoGenerate) generateChoices('auto');
        }, 300);
    }

    function onGenerationStarted() {
        clearTimeout(autoGenerateTimer);
        abortPending();
        clearChoicesUI();
        // The theme is a draft for the current conversation turn only.
        resetGenerationGuidanceUI();
    }

    function onChatStateChanged() {
        clearTimeout(autoGenerateTimer);
        abortPending();
        clearChoicesUI();
        // Also reached through swipe, edit, and delete: the draft never
        // survives into another turn or another chat.
        resetGenerationGuidanceUI();
    }

    function onMessageSwiped() {
        onChatStateChanged();
        const settings = getSettings();
        if (settings.enabled && settings.autoGenerate) {
            autoGenerateTimer = setTimeout(() => {
                // Re-check: settings may have changed while the timer was pending.
                const current = getSettings();
                if (current.enabled && current.autoGenerate) generateChoices('auto');
            }, 300);
        }
    }

    function wireEvents(ctx) {
        const eventSource = ctx?.eventSource;
        const types = ctx?.eventTypes ?? ctx?.event_types ?? {};
        if (!eventSource?.on) {
            console.warn(`[${MODULE_NAME}] eventSource unavailable; events not wired.`);
            return;
        }

        const bind = (typeName, handler) => {
            const eventName = types[typeName];
            if (eventName) eventSource.on(eventName, handler);
        };

        bind('CHARACTER_MESSAGE_RENDERED', onCharacterMessageRendered);
        bind('GENERATION_STARTED', onGenerationStarted);
        bind('CHAT_CHANGED', onChatStateChanged);
        bind('MESSAGE_SWIPED', onMessageSwiped);
        bind('MESSAGE_EDITED', onChatStateChanged);
        bind('MESSAGE_DELETED', onChatStateChanged);
    }

    // =========================================================================
    // Init
    // =========================================================================

    function init() {
        const ctx = getContext();
        if (!ctx) {
            console.error(`[${MODULE_NAME}] SillyTavern context unavailable; extension disabled.`);
            return;
        }
        try {
            getSettings(); // ensure settings object exists with defaults
            wireEvents(ctx);
            initSettingsPanel().catch((err) =>
                console.error(`[${MODULE_NAME}] Settings panel init failed:`, err));
            addWandMenuButton();
            updateQuickGenerateButton();
            console.log(`[${MODULE_NAME}] Extension loaded.`);
        } catch (err) {
            console.error(`[${MODULE_NAME}] Init failed:`, err);
        }
    }

    if (typeof jQuery === 'function') {
        jQuery(() => init());
    } else {
        // Extremely defensive: run after DOM ready without jQuery.
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    }
})();
