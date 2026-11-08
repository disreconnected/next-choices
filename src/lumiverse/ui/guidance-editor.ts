/**
 * Composer theme editor for guided generation. Deliberately separate from the
 * choices container, so loading, errors, enhancement and choice rendering never
 * erase the draft. The draft is never persisted anywhere: it lives in the
 * textarea and dies with the conversation turn (see destroy()).
 */
import { h, stopKeydown, toolButton } from './dom';
import type { Translate } from './types';

export const GUIDANCE_WRAPPER_ID = 'next_choices_generation_guidance';
const GUIDANCE_PANEL_ID = 'next_choices_generation_guidance_panel';
const GUIDANCE_INPUT_ID = 'next_choices_theme_input';

export interface GuidanceEditorDeps {
    tr: Translate;
    /** Puts the wrapper into the document (the mount root). False when there is no composer. */
    place(wrapper: HTMLElement): boolean;
    /** The player pressed the submit button with a nonempty theme. */
    onSubmit(theme: string): void;
    /** Opened or closed: keep the launchers' aria-expanded in sync. */
    onOpenChange(open: boolean): void;
    /** Return focus to whatever launched the editor. */
    restoreFocus(opener: Element | null): void;
}

export interface GuidanceEditor {
    readonly wrapper: HTMLElement;
    isOpen(): boolean;
    isBusy(): boolean;
    /** Opening focuses the theme box and never issues a request. Returns false when it could not be shown. */
    setOpen(open: boolean, opener?: Element | null): boolean;
    /** Locks the editor for the duration of its own guided request. */
    setBusy(busy: boolean): void;
    setStatus(message: string): void;
    /** Discards the editor and its draft. */
    destroy(): void;
}

export function createGuidanceEditor(deps: GuidanceEditorDeps): GuidanceEditor {
    const { tr } = deps;
    const input = h('textarea', {
        id: GUIDANCE_INPUT_ID,
        className: 'next-choices-guidance-input',
        attrs: { rows: '3', placeholder: tr('e.g. invite her to dance') },
    });
    const submit = toolButton('next-choices-guidance-submit', tr('Generate choices (guided)'));
    const close = toolButton('next-choices-guidance-close', tr('Close'));
    const panel = h('div', {
        id: GUIDANCE_PANEL_ID,
        className: 'next-choices-guidance',
        children: [
            h('label', { text: tr('Choice theme'), attrs: { for: GUIDANCE_INPUT_ID } }),
            input,
            h('div', {
                className: 'next-choices-guidance-hint',
                text: tr("Use one main theme while keeping each choice's tone and approach from your prompt template."),
            }),
            h('div', { className: 'next-choices-guidance-actions', children: [submit, close] }),
        ],
    });
    // The live status stays OUTSIDE the panel: aria-busy on an ancestor makes
    // assistive tech defer live-region updates inside it.
    const status = h('div', {
        className: 'next-choices-guidance-status',
        attrs: { role: 'status', 'aria-live': 'polite' },
    });
    const wrapper = h('div', {
        id: GUIDANCE_WRAPPER_ID,
        className: 'next-choices-guidance-wrap',
        hidden: true,
        children: [panel, status],
    });

    let open = false;
    let busy = false;
    let opener: Element | null = null;

    function refreshSubmitState(): void {
        submit.disabled = busy || input.value.trim().length === 0;
    }

    // Enter stays a native newline and host shortcuts never see this textarea.
    // Submission is explicit, and the main composer is never written to from here.
    stopKeydown(input);
    input.addEventListener('input', refreshSubmitState);
    submit.addEventListener('click', () => {
        if (busy) return;
        const theme = input.value.trim();
        if (!theme) return;
        deps.onSubmit(theme);
    });
    close.addEventListener('click', () => editor.setOpen(false));

    const editor: GuidanceEditor = {
        wrapper,
        isOpen: () => open,
        isBusy: () => busy,

        setOpen(next, newOpener = null) {
            if (!next) {
                // Decided before hiding: a hidden element cannot hold focus.
                const focusInside = wrapper.contains(document.activeElement);
                wrapper.hidden = true;
                open = false;
                deps.onOpenChange(false);
                if (focusInside) deps.restoreFocus(opener);
                return true;
            }
            if (newOpener) opener = newOpener;
            deps.place(wrapper);
            if (!wrapper.isConnected) return false; // composer not mounted
            wrapper.hidden = false;
            open = true;
            deps.onOpenChange(true);
            refreshSubmitState();
            input.focus();
            return true;
        },

        setBusy(next) {
            busy = next;
            panel.setAttribute('aria-busy', next ? 'true' : 'false');
            input.disabled = next;
            status.textContent = next ? tr('Generating choices…') : '';
            refreshSubmitState();
        },

        setStatus(message) {
            status.textContent = message;
        },

        destroy() {
            input.value = '';
            wrapper.remove();
            open = false;
            busy = false;
        },
    };

    refreshSubmitState();
    return editor;
}
