import { describe, expect, test } from 'bun:test';
import { mergeCombined, selectedInOrder } from '../src/lumiverse/ui/choice-logic';

describe('mergeCombined', () => {
    const originals = ['a', 'b', 'c', 'd'];

    test('the rewrite replaces the earliest selected choice and the other selected ones go', () => {
        expect(mergeCombined(originals, [1, 3], 'X')).toEqual({ choices: ['a', 'X', 'c'], insertionIndex: 1 });
    });

    test('selection order does not matter', () => {
        expect(mergeCombined(originals, [3, 1], 'X').choices).toEqual(['a', 'X', 'c']);
    });

    test('unselected choices keep their order', () => {
        expect(mergeCombined(originals, [0, 1, 2, 3], 'X').choices).toEqual(['X']);
        expect(mergeCombined(originals, [2], 'X').choices).toEqual(['a', 'b', 'X', 'd']);
    });

    test('ignores out-of-range, fractional and repeated indexes', () => {
        expect(mergeCombined(originals, [-1, 9, 1.5, 2, 2], 'X')).toEqual({
            choices: ['a', 'b', 'X', 'd'],
            insertionIndex: 2,
        });
    });

    test('with nothing valid selected the rewrite takes the first slot', () => {
        expect(mergeCombined(originals, [], 'X')).toEqual({ choices: ['X', 'b', 'c', 'd'], insertionIndex: 0 });
    });

    test('accepts any iterable', () => {
        expect(mergeCombined(originals, new Set([0, 2]), 'X').choices).toEqual(['X', 'b', 'd']);
    });
});

describe('selectedInOrder', () => {
    test('ascending, unique and in range', () => {
        expect(selectedInOrder([3, 1, 1, 7, -2, 0.5, 2], 4)).toEqual([1, 2, 3]);
    });

    test('empty selection', () => {
        expect(selectedInOrder(new Set<number>(), 3)).toEqual([]);
    });
});
