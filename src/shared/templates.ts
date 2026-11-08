// Kept verbatim so existing users who never customized the old default can
// be migrated without overwriting genuinely custom prompt templates.
export const LEGACY_DEFAULT_PROMPT_TEMPLATE =
    'You are an assistant helping a roleplay player. Below is the recent conversation between {{user}} and {{char}}:\n\n' +
    '{{history}}\n\n' +
    'Write {{numChoices}} response options that {{user}} could say next, replying to the latest message from {{char}}.\n\n' +
    'Requirements:\n' +
    '- The motivation behind each option, and the consequences it would lead to, must differ drastically from the other options (e.g. one bold, one cautious, one creative).\n' +
    '- Write the options in the same language as the conversation.\n' +
    '- Respond ONLY with a JSON array of {{numChoices}} strings, no other text.';

export const DEFAULT_PROMPT_TEMPLATE =
    'You are an assistant helping a roleplay player. Below is the recent conversation between {{user}} and {{char}}:\n\n' +
    '{{history}}\n\n' +
    'Persona of {{user}} (match their voice, writing style, and inner narration):\n' +
    '{{persona}}\n\n' +
    'Write {{numChoices}} response options that {{user}} could say next, replying to the latest message from {{char}}.\n\n' +
    'Requirements:\n' +
    '- The motivation behind each option, and the consequences it would lead to, must differ drastically from the other options (e.g. one bold, one cautious, one creative).\n' +
    '- Write the options in the same language as the conversation.\n' +
    '- Respond ONLY with a JSON array of {{numChoices}} strings, no other text.';
