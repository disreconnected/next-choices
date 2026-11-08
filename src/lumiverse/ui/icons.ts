/** Inline SVG icons for the input bar actions (stroke follows the host text colour). */

const SVG_OPEN =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

export const DICE_SVG =
    SVG_OPEN +
    '<rect x="3" y="3" width="18" height="18" rx="3"/>' +
    '<circle cx="8.5" cy="8.5" r="1" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1" fill="currentColor"/>' +
    '<circle cx="12" cy="12" r="1" fill="currentColor"/>' +
    '<circle cx="8.5" cy="15.5" r="1" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1" fill="currentColor"/></svg>';

export const COMPASS_SVG =
    SVG_OPEN +
    '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>';
