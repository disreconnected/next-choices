import { errorMessage } from '../../shared/error';
import { formatChoiceHtml } from '../../shared/format';
import { parseRewrittenChoices } from '../../shared/parse';
import { mergeCombined, selectedInOrder } from './choice-logic';
import { h, stopKeydown, toolButton } from './dom';
import { NoConversationError, type RequestHandle, type RewriteTask, type Translate } from './types';

export const CONTAINER_ID = 'next_choices_container';

export interface ChoicesUiDeps {
    tr: Translate;
    getContainer(): HTMLElement | null;
    peekContainer(): HTMLElement | null;
    isEnabled(): boolean;
    getUserName(): string;
    applyChoice(text: string): void;
    regenerate(guidance: string): void;
    beginRequest(): RequestHandle;
    abortPending(): void;
    cancelAutoTimer(): void;
    runRewrite(handle: RequestHandle, task: RewriteTask): Promise<string>;
    restoreFocusAfterStop(target: Element | null): void;
}

export interface ChoicesUi {
    clear(): void;
    renderLoading(handle: RequestHandle, focusTarget: Element | null): void;
    renderError(message: string, generationGuidance?: string): void;
    renderNotice(message: string): void;
    renderChoices(choices: readonly string[], generationGuidance?: string): void;
}

interface ToolbarOptions {
    regenerate: boolean;
    generationGuidance: string;
    onEnhance?: () => void;
    onCombine?: () => void;
}

interface RowRefs {
    row: HTMLElement;
    item: HTMLButtonElement;
    edit: HTMLButtonElement;
    select: HTMLElement;
    checkbox: HTMLInputElement;
}

export function createChoicesUi(deps: ChoicesUiDeps): ChoicesUi {
    const { tr } = deps;

    function clear(): void {
        const container = deps.peekContainer();
        if (!container) return;
        container.replaceChildren();
        container.hidden = true;
    }

    function makeToolbar(options: ToolbarOptions): {
        toolbar: HTMLElement;
        enhance: HTMLButtonElement | null;
        combine: HTMLButtonElement | null;
    } {
        const toolbar = h('div', { className: 'next-choices-toolbar' });

        if (options.regenerate) {
            const regenerate = toolButton('next-choices-regenerate', '♻️', {
                title: tr('Regenerate'),
                'aria-label': tr('Regenerate'),
            });
            regenerate.addEventListener('click', () => deps.regenerate(options.generationGuidance));
            toolbar.append(regenerate);
        }

        let enhance: HTMLButtonElement | null = null;
        if (options.onEnhance) {
            const onEnhance = options.onEnhance;
            enhance = toolButton('next-choices-enhance', tr('Enhance'), {
                title: tr('Enhance choices'),
                'aria-label': tr('Enhance choices'),
                'aria-controls': 'next_choices_guidance_panel',
                'aria-expanded': 'false',
            });
            enhance.addEventListener('click', () => onEnhance());
            toolbar.append(enhance);
        }

        let combine: HTMLButtonElement | null = null;
        if (options.onCombine) {
            const onCombine = options.onCombine;
            combine = toolButton('next-choices-combine', tr('Combine'), {
                title: tr('Combine choices'),
                'aria-label': tr('Combine choices'),
                'aria-controls': 'next_choices_combine_panel',
                'aria-expanded': 'false',
            });
            combine.addEventListener('click', () => onCombine());
            stopKeydown(combine);
            toolbar.append(combine);
        }

        const dismiss = toolButton('next-choices-dismiss', '✖', {
            title: tr('Dismiss'),
            'aria-label': tr('Dismiss'),
        });
        dismiss.addEventListener('click', () => clear());
        toolbar.append(dismiss);

        return { toolbar, enhance, combine };
    }

    function renderLoading(handle: RequestHandle, focusTarget: Element | null): void {
        const container = deps.getContainer();
        if (!container) return;
        container.replaceChildren();
        container.hidden = false;

        const stop = toolButton('next-choices-stop', tr('Stop generating'), { 'aria-label': tr('Stop generating') });
        const loading = h('div', {
            className: 'next-choices-loading',
            children: [
                h('span', { className: 'next-choices-spinner' }),
                h('span', { className: 'next-choices-loading-label', text: tr('Generating choices…') }),
                stop,
            ],
        });
        stop.addEventListener('click', () => {
            if (!handle.isCurrent() || !container.isConnected || loading.parentElement !== container) return;
            deps.cancelAutoTimer();
            deps.abortPending();
            clear();
            deps.restoreFocusAfterStop(focusTarget);
        });
        container.append(loading);
    }

    function renderError(message: string, generationGuidance = ''): void {
        const container = deps.getContainer();
        if (!container) return;
        container.replaceChildren();
        container.hidden = false;

        const retry = toolButton('next-choices-retry', tr('Retry'));
        retry.addEventListener('click', () => deps.regenerate(generationGuidance));
        const error = h('div', {
            className: 'next-choices-error',
            attrs: { role: 'alert' },
            children: [h('span', { text: tr('Failed to generate choices: ') + message }), retry],
        });
        container.append(error, makeToolbar({ regenerate: true, generationGuidance }).toolbar);
    }

    function renderNotice(message: string): void {
        const container = deps.getContainer();
        if (!container) return;
        container.replaceChildren();
        container.hidden = false;
        const notice = h('div', {
            className: 'next-choices-error next-choices-notice',
            attrs: { role: 'status' },
            children: [h('span', { text: message })],
        });
        container.append(notice, makeToolbar({ regenerate: false, generationGuidance: '' }).toolbar);
    }

    function renderChoices(choices: readonly string[], generationGuidance = ''): void {
        const container = deps.getContainer();
        if (!container) return;
        const view: HTMLElement = container;
        container.replaceChildren();
        container.hidden = false;

        const currentChoices = choices.map((choice) => String(choice ?? ''));
        let openEditors = 0;
        let enhancementBusy = false;
        let combinationOpen = false;
        let combinationBusy = false;
        let enhancementHandle: RequestHandle | null = null;
        let combinationHandle: RequestHandle | null = null;
        const selectedChoiceIndexes = new Set<number>();
        const rowRefs: RowRefs[] = [];

        const list = h('div', { className: 'next-choices-list' });
        const content = h('div', { className: 'next-choices-content' });

        const isViewCurrent = (): boolean =>
            container.isConnected && content.parentElement === container && container.firstElementChild === content;

        currentChoices.forEach((_, index) => {
            const number = index + 1;
            const row = h('div', { className: 'next-choices-row' });

            const checkbox = h('input', {
                className: 'next-choices-select-input',
                attrs: {
                    type: 'checkbox',
                    'aria-label': tr('Select choice {number} to combine', { number }),
                },
            });
            const select = h('label', { className: 'next-choices-select', hidden: true, children: [checkbox] });
            checkbox.addEventListener('change', () => toggleCombinationChoice(index));
            stopKeydown(checkbox);

            const item = h('button', { className: 'next-choices-item', attrs: { type: 'button' } });
            const renderPreview = () => {
                item.innerHTML = formatChoiceHtml(currentChoices[index]!);
            };
            renderPreview();
            item.addEventListener('click', () => {
                if (combinationOpen) toggleCombinationChoice(index);
                else deps.applyChoice(currentChoices[index]!);
            });
            item.addEventListener('keydown', (event) => {
                if (combinationOpen) event.stopPropagation();
            });

            const editLabel = `${tr('Edit choice')} ${number}`;
            const edit = toolButton('next-choices-edit', tr('Edit'), { 'aria-label': editLabel });

            const input = h('textarea', {
                className: 'next-choices-edit-input',
                attrs: { rows: '4', 'aria-label': editLabel },
            });
            stopKeydown(input);
            const apply = toolButton('next-choices-apply', tr('Apply changes'));
            const reset = toolButton('next-choices-reset', tr('Reset changes'));
            const editor = h('div', {
                className: 'next-choices-editor',
                hidden: true,
                children: [input, h('div', { className: 'next-choices-edit-actions', children: [apply, reset] })],
            });

            const refreshApplyState = () => {
                apply.disabled = input.value.trim().length === 0;
            };
            input.addEventListener('input', refreshApplyState);

            const setEditing = (editing: boolean) => {
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
            edit.addEventListener('click', () => {
                input.value = currentChoices[index]!;
                refreshApplyState();
                setEditing(true);
            });
            apply.addEventListener('click', () => {
                const draft = input.value;
                if (!draft.trim()) return;
                currentChoices[index] = draft;
                renderPreview();
                setEditing(false);
                edit.focus();
            });
            reset.addEventListener('click', () => {
                input.value = '';
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
                if (enhancementBusy || combinationOpen || combinationBusy) return;
                setPanelOpen(guidanceWrap.hidden);
            },
            onCombine: () => setCombinationOpen(!combinationOpen),
        });
        const enhanceButton = toolbar.enhance!;
        const combineButton = toolbar.combine!;

        const guidanceInput = h('textarea', {
            id: 'next_choices_guidance_input',
            className: 'next-choices-guidance-input',
            attrs: { rows: '3' },
        });
        stopKeydown(guidanceInput);
        const status = h('div', {
            className: 'next-choices-guidance-status',
            attrs: { role: 'status', 'aria-live': 'polite' },
        });
        const setStatus = (message: string) => {
            status.textContent = message;
        };
        const submit = toolButton('next-choices-guidance-submit', tr('Enhance choices'));
        const stopEnhance = toolButton('next-choices-enhance-stop', tr('Stop enhancing'));
        stopEnhance.hidden = true;
        const panelClose = toolButton('next-choices-guidance-close', tr('Close'));
        const panel = h('div', {
            id: 'next_choices_guidance_panel',
            className: 'next-choices-guidance',
            children: [
                h('label', { text: tr('Enhancement prompt'), attrs: { for: 'next_choices_guidance_input' } }),
                guidanceInput,
                h('div', {
                    className: 'next-choices-guidance-hint',
                    text: tr("Keeps each choice's main content and adds your direction."),
                }),
                h('div', { className: 'next-choices-guidance-actions', children: [submit, stopEnhance, panelClose] }),
            ],
        });
        const guidanceWrap = h('div', {
            className: 'next-choices-guidance-wrap',
            hidden: true,
            children: [panel, status],
        });

        function placeholderExemplar(): string {
            const name = deps.getUserName().trim();
            return name ? tr('e.g. have {name} reassure her', { name }) : tr('e.g. reassure her');
        }

        function setPanelControlsDisabled(disabled: boolean): void {
            guidanceInput.disabled = disabled;
            submit.disabled = disabled;
            panelClose.disabled = disabled;
        }

        function refreshGuidanceAvailability(): void {
            const hasGuidance = guidanceInput.value.trim().length > 0;
            const editing = openEditors > 0;
            const busy = enhancementBusy || combinationBusy;
            submit.disabled = busy || combinationOpen || !hasGuidance || editing;
            if (editing) setStatus(tr('Apply or reset your edits before enhancing choices.'));
            else if (!busy) setStatus('');
        }
        guidanceInput.addEventListener('input', refreshGuidanceAvailability);

        function setPanelOpen(open: boolean): void {
            guidanceWrap.hidden = !open;
            enhanceButton.setAttribute('aria-expanded', String(open));
            if (open) {
                guidanceInput.placeholder = placeholderExemplar();
                guidanceInput.focus();
            } else {
                enhanceButton.focus();
            }
        }
        panelClose.addEventListener('click', () => {
            if (!enhancementBusy) setPanelOpen(false);
        });

        function setRowsInteractive(interactive: boolean): void {
            for (const row of rowRefs) {
                row.item.disabled = !interactive;
                row.checkbox.disabled = !interactive;
                row.edit.disabled = !interactive || combinationOpen;
            }
        }

        function setBusy(busy: boolean): void {
            enhancementBusy = busy;
            setRowsInteractive(!busy);
            list.classList.toggle('next-choices-list-locked', busy);
            enhanceButton.disabled = busy || combinationOpen || combinationBusy;
            panel.setAttribute('aria-busy', busy ? 'true' : 'false');
            setPanelControlsDisabled(busy);
            stopEnhance.hidden = !busy;
            refreshCombinationAvailability();
            if (busy) setStatus(tr('Enhancing choices…'));
            else refreshGuidanceAvailability();
        }

        async function enhanceDisplayedChoices(): Promise<void> {
            if (enhancementBusy || combinationOpen || combinationBusy) return;
            if (!isViewCurrent() || !deps.isEnabled()) return;
            const guidance = guidanceInput.value.trim();
            if (!guidance) return;
            if (openEditors > 0) {
                refreshGuidanceAvailability();
                return;
            }

            const originals = currentChoices.slice();

            deps.cancelAutoTimer();
            const handle = deps.beginRequest();
            enhancementHandle = handle;
            setBusy(true);

            let response: string;
            try {
                response = await deps.runRewrite(handle, { kind: 'enhance', originals, guidance });
            } catch (err) {
                if (!handle.isCurrent()) return;
                if (!isViewCurrent()) return;
                setBusy(false);
                if (err instanceof NoConversationError) {
                    setStatus(tr('No conversation is available to enhance these choices.'));
                    return;
                }
                console.error('[nextChoices] Enhancement failed:', err);
                setStatus(tr('Failed to enhance choices: ') + errorMessage(err));
                return;
            }

            if (!handle.isCurrent()) return;
            if (!isViewCurrent()) return;

            const enhanced = parseRewrittenChoices(response, originals.length);
            if (!enhanced) {
                setBusy(false);
                setStatus(tr('Could not parse one enhanced choice for every original choice. Try again.'));
                return;
            }

            renderChoices(enhanced, generationGuidance);
            view.querySelector<HTMLElement>('.next-choices-enhance')?.focus();
        }
        submit.addEventListener('click', () => void enhanceDisplayedChoices());
        stopEnhance.addEventListener('click', () => {
            if (!enhancementBusy || enhancementHandle === null || !enhancementHandle.isCurrent() || !isViewCurrent()) return;
            deps.cancelAutoTimer();
            deps.abortPending();
            setBusy(false);
            guidanceInput.focus();
        });

        const combineHint = h('div', {
            className: 'next-choices-combine-hint',
            text: tr('Select at least two choices to combine.'),
        });
        const combineSubmit = toolButton('next-choices-combine-submit', tr('Combine selected'));
        combineSubmit.disabled = true;
        const combineStop = toolButton('next-choices-combine-stop', tr('Stop combining'));
        combineStop.hidden = true;
        const combineCancel = toolButton('next-choices-combine-cancel', tr('Cancel'));
        for (const control of [combineSubmit, combineStop, combineCancel]) stopKeydown(control);
        const combinationPanel = h('div', {
            id: 'next_choices_combine_panel',
            className: 'next-choices-combine-panel',
            children: [
                combineHint,
                h('div', { className: 'next-choices-combine-actions', children: [combineSubmit, combineStop, combineCancel] }),
            ],
        });
        const combineStatus = h('div', {
            className: 'next-choices-combine-status',
            attrs: { role: 'status', 'aria-live': 'polite' },
        });
        const combinationWrap = h('div', {
            className: 'next-choices-combine-wrap',
            hidden: true,
            children: [combinationPanel, combineStatus],
        });
        combineCancel.addEventListener('click', () => setCombinationOpen(false));

        function refreshCombinationAvailability(): void {
            const editing = openEditors > 0;
            const busy = enhancementBusy || combinationBusy;
            combineButton.disabled = busy || editing || currentChoices.length < 2;
            combineButton.title = editing
                ? tr('Apply or reset your edits before combining choices.')
                : currentChoices.length < 2
                  ? tr('Select at least two choices to combine.')
                  : tr('Combine choices');
            combineSubmit.disabled = !combinationOpen || busy || editing || selectedChoiceIndexes.size < 2;
        }

        function toggleCombinationChoice(index: number): void {
            if (!combinationOpen || combinationBusy || !isViewCurrent()) return;
            if (selectedChoiceIndexes.has(index)) selectedChoiceIndexes.delete(index);
            else selectedChoiceIndexes.add(index);
            const selected = selectedChoiceIndexes.has(index);
            const row = rowRefs[index]!;
            row.checkbox.checked = selected;
            row.item.setAttribute('aria-pressed', String(selected));
            row.row.classList.toggle('next-choices-row-selected', selected);
            combineStatus.textContent = tr('{count} selected', { count: selectedChoiceIndexes.size });
            refreshCombinationAvailability();
        }

        function setCombinationOpen(open: boolean): void {
            if (!isViewCurrent() || combinationBusy) return;
            if (open && (currentChoices.length < 2 || enhancementBusy || openEditors > 0)) return;
            if (open && !guidanceWrap.hidden) setPanelOpen(false);
            combinationOpen = open;
            selectedChoiceIndexes.clear();
            combineStatus.textContent = '';
            combinationWrap.hidden = !open;
            combineButton.setAttribute('aria-expanded', String(open));
            for (const row of rowRefs) {
                row.select.hidden = !open;
                row.checkbox.checked = false;
                row.row.classList.remove('next-choices-row-selected');
                if (open) row.item.setAttribute('aria-pressed', 'false');
                else row.item.removeAttribute('aria-pressed');
            }
            setRowsInteractive(true);
            enhanceButton.disabled = open;
            refreshGuidanceAvailability();
            refreshCombinationAvailability();
            if (open) rowRefs[0]!.checkbox.focus();
            else combineButton.focus();
        }

        function setCombinationBusy(busy: boolean): void {
            combinationBusy = busy;
            setRowsInteractive(!busy);
            list.classList.toggle('next-choices-list-locked', busy);
            enhanceButton.disabled = busy || combinationOpen;
            setPanelControlsDisabled(busy);
            combinationPanel.setAttribute('aria-busy', String(busy));
            combineCancel.disabled = busy;
            combineStop.hidden = !busy;
            refreshGuidanceAvailability();
            refreshCombinationAvailability();
            if (busy) {
                combineStatus.textContent = tr('Combining choices…');
                combineStop.focus();
            } else {
                combineStatus.textContent = tr('{count} selected', { count: selectedChoiceIndexes.size });
            }
        }

        async function combineDisplayedChoices(): Promise<void> {
            if (!deps.isEnabled() || !isViewCurrent() || !combinationOpen) return;
            if (enhancementBusy || combinationBusy || openEditors > 0) return;
            const selectedIndexes = selectedInOrder(selectedChoiceIndexes, currentChoices.length);
            if (selectedIndexes.length < 2) return;

            const originals = currentChoices.slice();
            const selected = selectedIndexes.map((index) => originals[index]!);

            deps.cancelAutoTimer();
            const handle = deps.beginRequest();
            combinationHandle = handle;
            setCombinationBusy(true);

            let response: string;
            try {
                response = await deps.runRewrite(handle, { kind: 'combine', selected });
            } catch (err) {
                if (!handle.isCurrent()) return;
                if (!isViewCurrent()) return;
                setCombinationBusy(false);
                if (err instanceof NoConversationError) {
                    combineStatus.textContent = tr('No conversation is available to combine these choices.');
                } else {
                    console.error('[nextChoices] Combination failed:', err);
                    combineStatus.textContent = tr('Failed to combine choices: ') + errorMessage(err);
                }
                combineSubmit.focus();
                return;
            }

            if (!handle.isCurrent()) return;
            if (!isViewCurrent()) return;
            const rewritten = parseRewrittenChoices(response, 1);
            if (!rewritten) {
                setCombinationBusy(false);
                combineStatus.textContent = tr('Could not parse one combined choice. Try again.');
                combineSubmit.focus();
                return;
            }

            const merged = mergeCombined(originals, selectedIndexes, rewritten[0]!);
            renderChoices(merged.choices, generationGuidance);
            view.querySelectorAll<HTMLElement>('.next-choices-item')[merged.insertionIndex]?.focus();
        }
        combineSubmit.addEventListener('click', () => void combineDisplayedChoices());
        combineStop.addEventListener('click', () => {
            if (!combinationBusy || combinationHandle === null || !combinationHandle.isCurrent() || !isViewCurrent()) return;
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
