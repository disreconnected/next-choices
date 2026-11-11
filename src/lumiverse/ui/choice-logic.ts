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

export function selectedInOrder(selected: Iterable<number>, count: number): number[] {
    return [...new Set(selected)].filter((index) => Number.isInteger(index) && index >= 0 && index < count).sort((a, b) => a - b);
}
