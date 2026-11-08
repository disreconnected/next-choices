/**
 * SillyTavern adapter for the shared prompt builders: maps the getContext()
 * object onto the host-independent inputs of src/shared/prompt.ts. The
 * signatures are the ones the extension always had, so every call site in
 * index.ts is unchanged. `ctx` is SillyTavern's untyped getContext() result.
 */
import {
    buildCombinationPrompt as buildSharedCombinationPrompt,
    buildEnhancementPrompt as buildSharedEnhancementPrompt,
    buildGuidedPrompt as buildSharedGuidedPrompt,
    buildHistory as buildSharedHistory,
    buildPrompt as buildSharedPrompt,
    type MacroExpander,
    type PromptVars,
} from '../shared/prompt';
import type { NextChoicesSettings } from '../shared/settings';

type PromptSettings = Pick<NextChoicesSettings, 'promptTemplate' | 'historyDepth' | 'numChoices'>;

/**
 * Returns the last `depth` non-system chat messages as "Name: text" lines.
 */
export function buildHistory(ctx: any, depth: number): string {
    const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
    const visible = chat.filter((mes: any) => mes && !mes.is_system && typeof mes.mes === 'string');
    return buildSharedHistory(
        visible.map((mes: any) => ({ name: mes.name, text: mes.mes })),
        depth,
    );
}

/**
 * Returns the player's persona description, or '' if none is set.
 */
export function getPersonaDescription(ctx: any): string {
    const desc = ctx?.powerUserSettings?.persona_description;
    return typeof desc === 'string' ? desc.trim() : '';
}

function promptVars(ctx: any, settings: PromptSettings): PromptVars {
    return {
        history: buildHistory(ctx, settings.historyDepth),
        numChoices: settings.numChoices,
        user: ctx?.name1 ?? 'User',
        char: ctx?.name2 ?? 'Assistant',
        persona: getPersonaDescription(ctx),
    };
}

function macroExpander(ctx: any): MacroExpander | undefined {
    // Called as a method: substituteParams may rely on its receiver.
    return typeof ctx?.substituteParams === 'function' ? (text) => ctx.substituteParams(text) : undefined;
}

export function buildPrompt(ctx: any, settings: PromptSettings): string {
    return buildSharedPrompt(settings.promptTemplate, promptVars(ctx, settings), macroExpander(ctx));
}

/**
 * Builds a prompt that asks the model to enhance the already displayed
 * choices according to the user's guidance instead of inventing new ones.
 */
export function buildEnhancementPrompt(ctx: any, settings: PromptSettings, choices: string[], guidance: string): string {
    return buildSharedEnhancementPrompt(settings.promptTemplate, promptVars(ctx, settings), choices, guidance, macroExpander(ctx));
}

export function buildCombinationPrompt(ctx: any, settings: PromptSettings, choices: string[]): string {
    return buildSharedCombinationPrompt(settings.promptTemplate, promptVars(ctx, settings), choices, macroExpander(ctx));
}

/**
 * Builds a prompt that asks the model for brand-new options that all share
 * the player's one main theme.
 */
export function buildGuidedPrompt(ctx: any, settings: PromptSettings, guidance: string): string {
    return buildSharedGuidedPrompt(settings.promptTemplate, promptVars(ctx, settings), guidance, macroExpander(ctx));
}
