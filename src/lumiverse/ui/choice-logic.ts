/** Pure list logic of the choices UI, kept free of the DOM so it can be unit tested. */

/**
 * Result of combining: the rewritten text takes the place of the earliest
 * selected choice, the other selected choices disappear, and every choice that
 * was not selected is kept in order.
 */
export function mergeCombined(
    originals: readonly string[],
    selectedIndexes: Iterable<number>,
    rewritten: string,
): { choices: string[]; insertionIndex: number } {
    const selected = new Set(
        [...selectedIndexes].filter((index) => Number.isInteger(index) && index >= 0 && index < originals.length),
    );
    const sorted = [...selected].sort((a, b) => a - b);
    const insertionIndex = sorted[0] ?? 0;
    const choices: string[] = [];
    originals.forEach((choice, index) => {
        if (index === insertionIndex) choices.push(rewritten);
        else if (!selected.has(index)) choices.push(choice);
    });
    return { choices, insertionIndex };
}

/** Indexes (ascending, valid, unique) of the selected choices. */
export function selectedInOrder(selected: Iterable<number>, count: number): number[] {
    return [...new Set(selected)].filter((index) => Number.isInteger(index) && index >= 0 && index < count).sort((a, b) => a - b);
}
