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
    }

    /**
     * Sends the raw prompt through the configured backend and returns the
     * response text (string). Throws on failure.
     */
    async function sendRawRequest(ctx, settings, prompt) {
        const profileId = settings.profileId;
        const cmrs = ctx?.ConnectionManagerRequestService;

        if (profileId && profileId !== 'current' && cmrs?.sendRequest) {
            const messages = [{ role: 'user', content: prompt }];
            const response = await cmrs.sendRequest(profileId, messages, settings.maxTokens);
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
            console.warn(`[${MODULE_NAME}] generateRaw object form failed, trying legacy form:`, err);
            const legacy = await ctx.generateRaw(prompt, '', false, false, '');
            if (typeof legacy === 'string') return legacy;
            if (legacy && typeof legacy.content === 'string') return legacy.content;
            throw new Error(tr('generateRaw returned an unrecognized response'));
        }
    }

    async function generateChoices(reason = 'manual') {
        const ctx = getContext();
        const settings = getSettings();
        if (!ctx || !settings.enabled) return;
        if (reason === 'auto' && !settings.autoGenerate) return;

        const lastMes = getLastMessage(ctx);
        if (!lastMes) return;
        // In auto mode, only fire when the latest message is from the AI.
        if (reason === 'auto' && lastMes.is_user) return;

        abortPending();
        const myRequestId = requestId;
        abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
        generating = true;

        renderLoading();

        let text;
        try {
            const prompt = buildPrompt(ctx, settings);
            text = await sendRawRequest(ctx, settings, prompt);
        } catch (err) {
            if (myRequestId !== requestId) return; // stale, ignore
            generating = false;
            console.error(`[${MODULE_NAME}] Generation failed:`, err);
            renderError(err?.message ?? String(err));
            return;
        }

        if (myRequestId !== requestId) return; // stale, ignore
        generating = false;

        const choices = parseChoices(text, settings.numChoices);
        if (!choices.length) {
            renderError(tr('Could not parse choices from the model response'));
            return;
        }
        renderChoices(choices);
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

    // =========================================================================
    // UI: choices bar
    // =========================================================================

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

    function makeToolbar() {
        const $toolbar = $('<div class="next-choices-toolbar"></div>');
        const $regen = $('<button type="button" class="next-choices-tool next-choices-regenerate"></button>')
            .text('♻️')
            .attr('title', tr('Regenerate'))
            .attr('aria-label', tr('Regenerate'));
        $regen.on('click', () => generateChoices('manual'));
        const $close = $('<button type="button" class="next-choices-tool next-choices-dismiss"></button>')
            .text('✖')
            .attr('title', tr('Dismiss'))
            .attr('aria-label', tr('Dismiss'));
        // Dismiss only hides the list. It is not a request cancellation control.
        $close.on('click', () => clearChoicesUI());
        $toolbar.append($regen, $close);
        return $toolbar;
    }

    function renderLoading() {
        const $container = getContainer();
        if (!$container.length) return;
        $container.empty().show();
        const $loading = $('<div class="next-choices-loading"><span class="next-choices-spinner"></span></div>');
        $loading.append(document.createTextNode(' ' + tr('Generating choices…')));
        $container.append($loading);
    }

    function renderError(message) {
        const $container = getContainer();
        if (!$container.length) return;
        $container.empty().show();
        const $error = $('<div class="next-choices-error"></div>');
        $error.append($('<span></span>').text(tr('Failed to generate choices: ') + message));
        const $retry = $('<button type="button" class="next-choices-retry menu_button"></button>').text(tr('Retry'));
        $retry.on('click', () => generateChoices('manual'));
        $error.append($retry);
        $container.append($error, makeToolbar());
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

    function renderChoices(choices) {
        const $container = getContainer();
        if (!$container.length) return;
        $container.empty().show();

        const $list = $('<div class="next-choices-list"></div>');
        choices.forEach((choice, index) => {
            // Per-row editing state. `committedText` is the last applied text
            // (initially the generated string); the textarea owns the live
            // draft while editing. Everything stays local to this closure, so
            // any container .empty() (dismiss, regenerate, chat change, …)
            // discards drafts and applied edits with the DOM.
            let committedText = String(choice ?? '');
            const number = index + 1;

            const $row = $('<div class="next-choices-row"></div>');

            // --- Selection target: fills the composer with applied text ---
            const $btn = $('<button type="button" class="next-choices-item"></button>');
            const renderPreview = () => {
                const formatted = formatChoiceHtml(committedText);
                if (formatted !== null) {
                    $btn.html(formatted);
                } else {
                    $btn.text(committedText);
                }
            };
            renderPreview();
            $btn.on('click', () => applyChoice(committedText));

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
                    $btn.hide();
                    $edit.hide();
                    $editor.show();
                    $input.trigger('focus');
                } else {
                    $editor.hide();
                    $btn.show();
                    $edit.show();
                }
            };

            $edit.on('click', () => {
                $input.val(committedText);
                refreshApplyState();
                setEditing(true);
            });

            // Apply stores the exact draft (whitespace/newlines preserved);
            // trimming is for validation only. Unchanged nonempty text may be
            // applied so it just closes editing.
            $apply.on('click', () => {
                const draft = String($input.val() ?? '');
                if (!draft.trim()) return;
                committedText = draft;
                renderPreview();
                setEditing(false);
                $edit.trigger('focus');
            });

            // Reset discards the draft; committedText (last applied text) is
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
        });
        $container.append($list, makeToolbar());
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
            if (enabled) {
                $('#next_choices_wand_button').show();
            } else {
                $('#next_choices_wand_button').hide();
            }
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
     * Adds a "Generate Choices" entry to SillyTavern's wand (magic wand) menu,
     * so the player can trigger generation manually at any time. Idempotent.
     */
    function addWandMenuButton() {
        if ($('#next_choices_wand_button').length) return;

        let $menu = $('#extensionsMenu');
        if (!$menu.length) $menu = $('#extensions_menu');
        if (!$menu.length) {
            console.warn(`[${MODULE_NAME}] Wand menu container not found; button not added.`);
            return;
        }

        const $item = $('<div id="next_choices_wand_button" class="list-group-item flex-container flexGap5 interactable" tabindex="0"></div>');
        $item.append('<div class="fa-solid fa-dice extensionsMenuExtensionButton"></div>');
        $item.append($('<span></span>').text(tr('Generate Choices')));
        $item.on('click', () => generateChoices('manual'));
        $menu.append($item);

        if (getSettings().enabled) {
            $item.show();
        } else {
            $item.hide();
        }
    }

    // =========================================================================
    // UI: composer quick-generate shortcut
    // =========================================================================

    const QUICK_BUTTON_ID = 'next_choices_quick_generate';
    const QUICK_ROW_ID = 'next_choices_quick_actions';
    const QUICK_HOST_CLASS = 'next-choices-quick-host';
    const QUICK_IMPERSONATE_SELECTOR =
        '#gg_impersonate_button, #gg_impersonate_button_2nd, #gg_impersonate_button_3rd';
    const QUICK_WATCH_SELECTOR = [
        '#send_form',
        '#nonQRFormItems',
        '#gg-action-button-container',
        '#gg-regular-buttons-container',
        `#${QUICK_ROW_ID}`,
        `#${QUICK_BUTTON_ID}`,
    ].join(', ');

    let quickGenerateObserver = null;
    // Owned DOM, tracked by reference as well as by id: a detached #send_form
    // (and everything inside it) cannot be reached by document lookups, but
    // must still be torn down when the shortcut is turned off.
    let quickGenerateButton = null;
    let quickGenerateRow = null;
    let quickGenerateMarkedHost = null;

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
            generateChoices('manual');
        });
        quickGenerateButton = $button[0];
        return $button;
    }

    /**
     * Puts the shortcut immediately before the first impersonate button in
     * Guided Generations' regular button row when that row exists, and in an
     * owned full-width fallback row inside #send_form otherwise. Creates the
     * button if it is missing and never duplicates it, so it is safe to call
     * on every relevant DOM mutation.
     */
    function syncQuickGenerateButton() {
        if (!quickGenerateWanted()) return;

        const sendForm = document.getElementById('send_form');
        if (!sendForm) return; // composer not in the DOM yet; reconcile later

        let $button = $(`#${QUICK_BUTTON_ID}`).first();
        if ($button.length && quickGenerateButton && !quickGenerateButton.isConnected && $button[0] !== quickGenerateButton) {
            // Someone cloned an ancestor of the shortcut (or our node was
            // copied by a template): cloneNode() drops the click handler, so
            // adopting the surviving node would leave an inert button. Drop it
            // and let the next lines create a freshly bound one.
            $button.remove();
            $button = $();
        }
        if (!$button.length) $button = createQuickGenerateButton();
        const button = $button[0];

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
            const placed = button.parentElement === regularHost
                && (reference
                    ? button.nextElementSibling === reference
                    : regularHost.firstElementChild === button);
            if (!placed) {
                regularHost.insertBefore(button, reference ?? regularHost.firstElementChild);
            }

            // The fallback row only exists while Guided Generations has no
            // mount point of its own.
            detachOwnedRow();
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
        if (button.parentElement !== row) row.appendChild(button);
    }

    function removeQuickGenerateButton() {
        // Reference-based teardown first: the shortcut can be sitting inside a
        // detached composer, where id lookups cannot reach it. Without this a
        // disable would leave it behind, and re-attaching that subtree would
        // show a shortcut the preference no longer asks for.
        quickGenerateButton?.remove();
        quickGenerateButton = null;
        detachOwnedRow();
        clearMarkedHost();
        // Safety net for a button this module instance did not create.
        document.getElementById(QUICK_BUTTON_ID)?.remove();
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
        if (!quickGenerateWanted()) {
            stopQuickGenerateObserver();
            removeQuickGenerateButton();
            return;
        }
        for (const record of records) {
            if (mutationTouchesQuickHosts(record)) {
                syncQuickGenerateButton();
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
        if (!quickGenerateWanted()) {
            stopQuickGenerateObserver();
            removeQuickGenerateButton();
            return;
        }
        startQuickGenerateObserver();
        syncQuickGenerateButton();
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
    }

    function onChatStateChanged() {
        clearTimeout(autoGenerateTimer);
        abortPending();
        clearChoicesUI();
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
