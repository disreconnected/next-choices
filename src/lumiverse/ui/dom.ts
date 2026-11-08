/** Small plain-DOM helpers shared by the Lumiverse UI modules. */

export interface ElOptions {
    id?: string;
    className?: string;
    /** Sets textContent (never HTML). */
    text?: string;
    attrs?: Readonly<Record<string, string>>;
    hidden?: boolean;
    children?: ReadonlyArray<Node | string | null | undefined>;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, options: ElOptions = {}): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (options.id) node.id = options.id;
    if (options.className) node.className = options.className;
    if (options.text !== undefined) node.textContent = options.text;
    if (options.attrs) {
        for (const [name, value] of Object.entries(options.attrs)) node.setAttribute(name, value);
    }
    if (options.hidden) node.hidden = true;
    if (options.children) {
        for (const child of options.children) {
            if (child !== null && child !== undefined) node.append(child);
        }
    }
    return node;
}

/** A themed text button: `<button type="button" class="next-choices-tool ...">`. */
export function toolButton(className: string, text: string, attrs: Readonly<Record<string, string>> = {}): HTMLButtonElement {
    return h('button', {
        className: `next-choices-tool ${className}`.trim(),
        text,
        attrs: { type: 'button', ...attrs },
    });
}

/** Keeps host-level keyboard shortcuts from seeing keys typed into our own inputs. */
export function stopKeydown(node: Element): void {
    node.addEventListener('keydown', (event) => event.stopPropagation());
}

/** True when a node is in the document and takes up space. */
export function isRendered(node: unknown): node is HTMLElement {
    return node instanceof HTMLElement && node.isConnected && node.getClientRects().length > 0;
}

export function setDisabled(node: Element, disabled: boolean): void {
    (node as HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement).disabled = disabled;
}

export function errorText(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
        return (err as { message: string }).message;
    }
    return String(err);
}
