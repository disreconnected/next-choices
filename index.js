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

    const DEFAULT_PROMPT_TEMPLATE =
        'You are an assistant helping a roleplay player. Below is the recent conversation between {{user}} and {{char}}:\n\n' +
        '{{history}}\n\n' +
        'Write {{numChoices}} response options that {{user}} could say next, replying to the latest message from {{char}}.\n\n' +
        'Requirements:\n' +
        '- The motivation behind each option, and the consequences it would lead to, must differ drastically from the other options (e.g. one bold, one cautious, one creative).\n' +
        '- Write the options in the same language as the conversation.\n' +
        '- Respond ONLY with a JSON array of {{numChoices}} strings, no other text.';

    const DEFAULT_SETTINGS = Object.freeze({
        enabled: true,
        autoGenerate: true,      // auto (event-driven) / manual (button)
        autoSend: false,         // send immediately on click
        profileId: 'current',    // 'current' or a connection profile id
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

    function buildPrompt(ctx, settings) {
        const history = buildHistory(ctx, settings.historyDepth);
        const template = settings.promptTemplate || DEFAULT_PROMPT_TEMPLATE;
        return template
            .replaceAll('{{history}}', history)
            .replaceAll('{{user}}', ctx?.name1 ?? 'User')
            .replaceAll('{{char}}', ctx?.name2 ?? 'Assistant')
            .replaceAll('{{numChoices}}', String(settings.numChoices));
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
        const $regen = $('<button type="button" class="next-choices-tool">♻️</button>').attr('title', tr('Regenerate'));
        $regen.on('click', () => generateChoices('manual'));
        const $close = $('<button type="button" class="next-choices-tool">✖</button>').attr('title', tr('Dismiss'));
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
        for (const choice of choices) {
            const $btn = $('<button type="button" class="next-choices-item"></button>');
            const formatted = formatChoiceHtml(choice);
            if (formatted !== null) {
                $btn.html(formatted);
            } else {
                $btn.text(choice);
            }
            $btn.on('click', () => applyChoice(choice));
            $list.append($btn);
        }
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
