import type { MotionFn, VimPos } from '../types/vim-api';
import { isTreeAvailable, getNodeSummariesOfType } from '../treesitter/js-api';
import { findFenceLines } from '../text-objects/code-block';

/**
 * The first body line of each fenced code block, which is where `]x`/`[x`
 * land — the cell's code, not its fence. An empty block uses its fence line
 * so the motion never skips a cell.
 */
export function codeCellLines(cm: Parameters<MotionFn>[0]): number[] {
    const view = (
        cm as unknown as { cm6?: import('@codemirror/view').EditorView }
    ).cm6;
    const blocks =
        view && isTreeAvailable(view)
            ? getNodeSummariesOfType(view, 'fenced_code_block').map((node) => ({
                  openLine: node.startRow,
                  closeLine:
                      node.endColumn === 0 ? node.endRow - 1 : node.endRow,
              }))
            : findFenceLines(cm);
    return blocks
        .map((block) =>
            block.closeLine > block.openLine + 1
                ? block.openLine + 1
                : block.openLine,
        )
        .sort((a, b) => a - b);
}

function createCodeCellMotion(forward: boolean): MotionFn {
    return (cm, head, motionArgs) => {
        const lines = codeCellLines(cm);
        const repeat = Math.max(1, motionArgs.repeat ?? 1);
        let count = 0;
        if (forward) {
            for (const line of lines) {
                if (line <= head.line) continue;
                if (++count >= repeat) return { line, ch: 0 } satisfies VimPos;
            }
        } else {
            for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i]!;
                if (line >= head.line) continue;
                if (++count >= repeat) return { line, ch: 0 } satisfies VimPos;
            }
        }
        return head;
    };
}

export const nextCodeCell = createCodeCellMotion(true);
export const prevCodeCell = createCodeCellMotion(false);
