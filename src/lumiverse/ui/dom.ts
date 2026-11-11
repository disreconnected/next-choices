export interface ElOptions {
    id?: string;
    className?: string;
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

export function toolButton(className: string, text: string, attrs: Readonly<Record<string, string>> = {}): HTMLButtonElement {
    return h('button', {
        className: `next-choices-tool ${className}`.trim(),
        text,
        attrs: { type: 'button', ...attrs },
    });
}

export function stopKeydown(node: Element): void {
    node.addEventListener('keydown', (event) => event.stopPropagation());
}

export function isRendered(node: unknown): node is HTMLElement {
    return node instanceof HTMLElement && node.isConnected && node.getClientRects().length > 0;
}
