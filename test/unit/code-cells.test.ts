import { describe, expect, it } from 'vitest';
import {
    codeCellLines,
    nextCodeCell,
    prevCodeCell,
} from '../../src/motions/code-cells';
import type { CmAdapter, MotionArgs } from '../../src/types/vim-api';

const NOTE = [
    'Intro prose', // 0
    '',
    '```python', // 2
    'x = 1', // 3
    '```', // 4
    '',
    'More prose',
    '```r', // 7
    '```', // 8: an empty cell
    '',
    '```python', // 10
    'y = 2', // 11
    'z = 3', // 12
    '```', // 13
];

function adapter(lines = NOTE): CmAdapter {
    return {
        getLine: (n: number) => lines[n] ?? '',
        lastLine: () => lines.length - 1,
    } as unknown as CmAdapter;
}

const move = (
    motion: typeof nextCodeCell,
    line: number,
    repeat = 1,
    lines = NOTE,
) =>
    motion(
        adapter(lines),
        { line, ch: 0 },
        { repeat } as MotionArgs,
        {} as never,
        null,
    );

describe('code cell motions', () => {
    it('targets the first body line of each cell, and the fence of an empty one', () => {
        expect(codeCellLines(adapter())).toEqual([3, 7, 11]);
    });

    it(']x moves to the next cell and stops at the last one', () => {
        expect(move(nextCodeCell, 0)).toEqual({ line: 3, ch: 0 });
        expect(move(nextCodeCell, 3)).toEqual({ line: 7, ch: 0 });
        expect(move(nextCodeCell, 11)).toEqual({ line: 11, ch: 0 });
    });

    it('[x moves to the previous cell and stops at the first one', () => {
        expect(move(prevCodeCell, 13)).toEqual({ line: 11, ch: 0 });
        expect(move(prevCodeCell, 11)).toEqual({ line: 7, ch: 0 });
        expect(move(prevCodeCell, 3)).toEqual({ line: 3, ch: 0 });
    });

    it('honours a count', () => {
        expect(move(nextCodeCell, 0, 2)).toEqual({ line: 7, ch: 0 });
        expect(move(nextCodeCell, 0, 3)).toEqual({ line: 11, ch: 0 });
        expect(move(prevCodeCell, 13, 3)).toEqual({ line: 3, ch: 0 });
        // Counting past the last cell stays put rather than wrapping.
        expect(move(nextCodeCell, 0, 9)).toEqual({ line: 0, ch: 0 });
    });

    it('handles blockquoted fences and notes without code', () => {
        const quoted = ['> ```python', '> a = 1', '> ```', 'text'];
        expect(codeCellLines(adapter(quoted))).toEqual([1]);
        expect(codeCellLines(adapter(['no code here']))).toEqual([]);
        expect(move(nextCodeCell, 0, 1, ['no code here'])).toEqual({
            line: 0,
            ch: 0,
        });
    });
});
