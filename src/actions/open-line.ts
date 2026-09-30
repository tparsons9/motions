import type {
    ActionFn,
    ActionArgs,
    CmAdapter,
    VimState,
} from '../types/vim-api';
import {
    findFenceLines,
    findContainingBlock,
} from '../text-objects/code-block';

// indent, blockquote chain, padding between the quote and a marker, marker.
// The marker is optional so a bare `> quote` continues the quote prefix on its
// own, matching what Obsidian core's Enter does on the same line.
const LIST_CONTINUATION_RE =
    /^(\s*)((?:>\s?)*)(\s*)([-*+]\s(?:\[.\]\s)?|\d+[.)]\s(?:\[.\]\s)?)?/;

/** First line after YAML frontmatter, or `cm.firstLine()` if none. */
function firstEditableLine(cm: {
    firstLine(): number;
    getLine(n: number): string;
    lastLine(): number;
}): number {
    const first = cm.firstLine();
    if (cm.getLine(first) !== '---') return first;

    // Scan for the closing `---`.
    for (let i = first + 1; i <= cm.lastLine(); i++) {
        if (cm.getLine(i) === '---') return i + 1;
    }
    // Malformed frontmatter (no closing `---`) — fall back.
    return first;
}

interface ListContinuation {
    below: string;
    above: string;
}

function detectListContinuation(line: string): ListContinuation | null {
    const m = LIST_CONTINUATION_RE.exec(line);
    if (!m) return null;

    const indent = m[1] ?? '';
    const bq = m[2] ?? '';
    const innerIndent = m[3] ?? '';
    const marker = m[4] ?? '';

    if (!marker) {
        if (!bq) return null;
        // Without a marker the padding is the quote's own text alignment
        // rather than list structure, so only the quote prefix carries over.
        const quotePrefix = indent + bq;
        return { below: quotePrefix, above: quotePrefix };
    }

    const hasCheckbox = /\[.\]\s$/.test(marker);
    const checkboxSuffix = hasCheckbox ? '[ ] ' : '';

    const base = indent + bq + innerIndent;

    const orderedMatch = marker.match(/^(\d+)([.)]\s)/);
    if (orderedMatch && orderedMatch[1] && orderedMatch[2]) {
        const num = parseInt(orderedMatch[1], 10);
        const delim = orderedMatch[2];
        return {
            below: base + String(num + 1) + delim + checkboxSuffix,
            above: base + String(num) + delim + checkboxSuffix,
        };
    }

    const bulletMatch = marker.match(/^([-*+]\s)/);
    if (bulletMatch && bulletMatch[1]) {
        const bullet = bulletMatch[1];
        const prefix = base + bullet + checkboxSuffix;
        return { below: prefix, above: prefix };
    }

    return null;
}

export function createSmartOpenLineAction(
    originalAction: ActionFn,
    getEnabled: () => boolean,
): ActionFn {
    // Runtime dispatch (vim.js:1971) calls actions[name](cm, args, vim),
    // setting `this` to the actions object. A regular function (not arrow)
    // preserves this binding so we can call this['enterInsertMode'].
    return function (
        this: Record<string, ActionFn>,
        cm: CmAdapter,
        actionArgs: ActionArgs,
        vim: VimState,
    ): void {
        if (!getEnabled()) {
            return originalAction.call(this, cm, actionArgs, vim);
        }

        const curLine = cm.getCursor().line;
        const lineText = cm.getLine(curLine);

        const cont = detectListContinuation(lineText);
        if (!cont) {
            return originalAction.call(this, cm, actionArgs, vim);
        }

        const block = findContainingBlock(findFenceLines(cm), curLine);
        if (block) {
            return originalAction.call(this, cm, actionArgs, vim);
        }

        vim.insertMode = true;
        const prefix = actionArgs.after ? cont.below : cont.above;

        if (actionArgs.after) {
            const lineLen = cm.getLine(curLine).length;
            cm.replaceRange('\n' + prefix, { line: curLine, ch: lineLen });
            cm.setCursor(curLine + 1, prefix.length);
        } else {
            if (curLine <= firstEditableLine(cm)) {
                cm.replaceRange(prefix + '\n', { line: curLine, ch: 0 });
                cm.setCursor(curLine, prefix.length);
            } else {
                const prevLine = curLine - 1;
                const prevLen = cm.getLine(prevLine).length;
                cm.replaceRange('\n' + prefix, {
                    line: prevLine,
                    ch: prevLen,
                });
                cm.setCursor(curLine, prefix.length);
            }
        }

        const enterInsert = this['enterInsertMode'] as ActionFn;
        enterInsert(cm, { repeat: actionArgs.repeat }, vim);
    };
}
