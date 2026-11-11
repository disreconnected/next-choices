import {
    appendCombinationTask,
    appendEnhancementTask,
    appendGuidedTask,
    buildHistory as buildSharedHistory,
    buildPrompt as buildSharedPrompt,
    type MacroExpander,
    type PromptVars,
} from '../shared/prompt';
import type { NextChoicesSettings } from '../shared/settings';

type PromptSettings = Pick<NextChoicesSettings, 'promptTemplate' | 'historyDepth' | 'numChoices'>;

export function buildHistory(ctx: any, depth: number): string {
    const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
    const visible = chat.filter((mes: any) => mes && !mes.is_system && typeof mes.mes === 'string');
    return buildSharedHistory(
        visible.map((mes: any) => ({ name: mes.name, text: mes.mes })),
        depth,
    );
}

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
    return typeof ctx?.substituteParams === 'function' ? (text) => ctx.substituteParams(text) : undefined;
}

export function buildPrompt(ctx: any, settings: PromptSettings): string {
    return buildSharedPrompt(settings.promptTemplate, promptVars(ctx, settings), macroExpander(ctx));
}

export function buildEnhancementPrompt(ctx: any, settings: PromptSettings, choices: string[], guidance: string): string {
    const vars = { ...promptVars(ctx, settings), numChoices: choices.length };
    return appendEnhancementTask(buildSharedPrompt(settings.promptTemplate, vars, macroExpander(ctx)), choices, guidance);
}

export function buildCombinationPrompt(ctx: any, settings: PromptSettings, choices: string[]): string {
    const vars = { ...promptVars(ctx, settings), numChoices: 1 };
    return appendCombinationTask(buildSharedPrompt(settings.promptTemplate, vars, macroExpander(ctx)), choices);
}

export function buildGuidedPrompt(ctx: any, settings: PromptSettings, guidance: string): string {
    const vars = promptVars(ctx, settings);
    return appendGuidedTask(buildSharedPrompt(settings.promptTemplate, vars, macroExpander(ctx)), vars.numChoices, guidance);
}
