import { toolButton } from './dom';
import type { Translate } from './types';

export const QUICK_BUTTON_ID = 'next_choices_quick_generate';
export const GUIDED_BUTTON_ID = 'next_choices_guided_generate';

export interface QuickButtonsDeps {
    tr: Translate;
    mount(): Element | null;
    isWanted(): boolean;
    onGenerate(): void;
    onGuided(opener: Element): void;
}

export interface QuickButtons {
    sync(): void;
    setGuidedExpanded(open: boolean): void;
    elements(): HTMLElement[];
    relabel(): void;
    destroy(): void;
}

export function createQuickButtons(deps: QuickButtonsDeps): QuickButtons {
    const { tr } = deps;
    let root: Element | null = null;
    let dice: HTMLButtonElement | null = null;
    let compass: HTMLButtonElement | null = null;
    let guidedExpanded = false;

    function create(): void {
        dice = toolButton('next-choices-quick-generate', '🎲', { id: QUICK_BUTTON_ID });
        dice.addEventListener('click', () => {
            if (!deps.isWanted()) return;
            deps.onGenerate();
        });
        compass = toolButton('next-choices-quick-generate', '🧭', {
            id: GUIDED_BUTTON_ID,
            'aria-controls': 'next_choices_generation_guidance',
            'aria-expanded': String(guidedExpanded),
        });
        compass.addEventListener('click', () => {
            if (!deps.isWanted()) return;
            deps.onGuided(compass!);
        });
        relabel();
    }

    function relabel(): void {
        dice?.setAttribute('title', tr('Generate choices'));
        dice?.setAttribute('aria-label', tr('Generate choices'));
        compass?.setAttribute('title', tr('Generate choices (guided)'));
        compass?.setAttribute('aria-label', tr('Generate choices (guided)'));
    }

    function remove(): void {
        dice?.remove();
        compass?.remove();
        dice = null;
        compass = null;
    }

    return {
        sync() {
            if (!deps.isWanted()) {
                remove();
                return;
            }
            if (!root || !root.isConnected) {
                let next: Element | null = null;
                try {
                    next = deps.mount();
                } catch (err) {
                    console.warn('[nextChoices] Could not mount the quick generate buttons:', err);
                }
                root = next;
            }
            if (!root) return;
            if (!dice || !compass) create();
            if (dice!.parentElement !== root || compass!.parentElement !== root || dice!.nextElementSibling !== compass) {
                root.append(dice!, compass!);
            }
        },

        setGuidedExpanded(open) {
            guidedExpanded = open;
            compass?.setAttribute('aria-expanded', String(open));
        },

        elements() {
            return [dice, compass].filter((node): node is HTMLButtonElement => node !== null);
        },

        relabel,

        destroy() {
            remove();
        },
    };
}
