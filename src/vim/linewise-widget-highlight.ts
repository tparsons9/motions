import { type Extension } from '@codemirror/state';
import { ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { blockWidgetSpans } from './block-widgets';
import { getCmAdapterFromEditorView } from './vim-api';

const HIGHLIGHT_CLASS = 'cm-vim-linewise-widget-selection';

interface VimSel {
    anchor: { line: number; ch: number };
    head: { line: number; ch: number };
}

interface VimStateWithSel {
    visualMode: boolean;
    visualLine: boolean;
    sel: VimSel | null;
}

class LinewiseWidgetHighlight {
    private highlighted = new Set<HTMLElement>();

    update(update: ViewUpdate): void {
        const cm = getCmAdapterFromEditorView(update.view);
        const vim = cm?.state?.vim as unknown as VimStateWithSel | undefined;

        if (!vim?.visualMode || !vim.visualLine || !vim.sel) {
            this.cleanup();
            return;
        }

        const startLine = Math.min(vim.sel.anchor.line, vim.sel.head.line);
        const endLine = Math.max(vim.sel.anchor.line, vim.sel.head.line);

        const stillActive = new Set<HTMLElement>();

        for (const span of blockWidgetSpans(update.view)) {
            const overlaps =
                span.startLine <= endLine && span.endLine >= startLine;

            if (overlaps) {
                span.el.classList.add(HIGHLIGHT_CLASS);
                stillActive.add(span.el);
            } else {
                span.el.classList.remove(HIGHLIGHT_CLASS);
            }
        }

        for (const el of this.highlighted) {
            if (!stillActive.has(el)) el.classList.remove(HIGHLIGHT_CLASS);
        }
        this.highlighted = stillActive;
    }

    // Never skip a detached element. Live Preview swaps a callout's widget for
    // source lines the moment the selection head enters it, then re-attaches
    // that same cached element when the cursor leaves again — so the element
    // this loop is least likely to find connected is exactly the one whose
    // highlight would come back and never leave (issue #190).
    private cleanup(): void {
        for (const el of this.highlighted) el.classList.remove(HIGHLIGHT_CLASS);
        this.highlighted.clear();
    }

    destroy(): void {
        this.cleanup();
    }
}

export function linewiseWidgetHighlightExtension(): Extension {
    return ViewPlugin.fromClass(LinewiseWidgetHighlight);
}
