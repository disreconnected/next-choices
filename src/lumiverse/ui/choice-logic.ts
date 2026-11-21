export function mergeCombined(
    originals: readonly string[],
    selectedIndexes: Iterable<number>,
    rewritten: string,
    combinedIndexes: readonly number[] = [],
): { choices: string[]; insertionIndex: number; combinedIndexes: number[] } {
    const selected = new Set(
        [...selectedIndexes].filter((index) => Number.isInteger(index) && index >= 0 && index < originals.length),
    );
    const sorted = [...selected].sort((a, b) => a - b);
    const insertionIndex = sorted[0] ?? 0;
    const choices: string[] = [];
    const nextCombined: number[] = [];
    originals.forEach((choice, index) => {
        if (index === insertionIndex) {
            nextCombined.push(choices.length);
            choices.push(rewritten);
        } else if (!selected.has(index)) {
            if (combinedIndexes.includes(index)) nextCombined.push(choices.length);
            choices.push(choice);
        }
    });
    return { choices, insertionIndex, combinedIndexes: nextCombined };
}

export function selectedInOrder(selected: Iterable<number>, count: number): number[] {
    return [...new Set(selected)].filter((index) => Number.isInteger(index) && index >= 0 && index < count).sort((a, b) => a - b);
}
