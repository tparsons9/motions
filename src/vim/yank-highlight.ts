import { StateEffect, StateField, type Extension } from '@codemirror/state';
import {
    Decoration,
    type DecorationSet,
    EditorView,
    ViewPlugin,
    type ViewUpdate,
} from '@codemirror/view';
import { blockWidgetSpans } from './block-widgets';

interface YankHighlightPayload {
    ranges: { from: number; to: number }[];
    mode: 'solid' | 'fade';
}

interface YankHighlightValue {
    decos: DecorationSet;
    mode: 'solid' | 'fade';
}

interface CoveredWidgets {
    targets: HTMLElement[];
    fade: boolean;
}

const WIDGET_CLASS = 'vim-motions-yank-highlight-widget';
const WIDGET_FADE_CLASS = 'vim-motions-yank-highlight-widget-fade';

const addYankHighlight = StateEffect.define<YankHighlightPayload>();
const clearYankHighlight = StateEffect.define<null>();

const solidMark = Decoration.mark({
    class: 'vim-motions-yank-highlight',
});

const fadeMark = Decoration.mark({
    class: 'vim-motions-yank-highlight vim-motions-yank-highlight-fade',
});

const yankHighlightField = StateField.define<YankHighlightValue>({
    create() {
        return { decos: Decoration.none, mode: 'solid' };
    },
    update(prev, tr) {
        let value: YankHighlightValue = {
            decos: prev.decos.map(tr.changes),
            mode: prev.mode,
        };
        for (const effect of tr.effects) {
            if (effect.is(addYankHighlight)) {
                const mark =
                    effect.value.mode === 'fade' ? fadeMark : solidMark;
                const ranges = effect.value.ranges
                    .filter((r) => r.from < r.to)
                    .map((r) => mark.range(r.from, r.to));
                value = {
                    decos: Decoration.set(ranges, true),
                    mode: effect.value.mode,
                };
            }
            if (effect.is(clearYankHighlight)) {
                value = { decos: Decoration.none, mode: value.mode };
            }
        }
        return value;
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
});

/**
 * Paints the rendered blocks a yank covered.
 *
 * Mark decorations stop at block widgets — CodeMirror drops the active marks
 * when it emits a block point — so a callout or embed inside the yanked range
 * gets nothing from the decoration set and has to be painted through its DOM
 * element. That cannot be done once when the yank fires: a linewise yank leaves
 * the CodeMirror selection spanning the range, which makes Live Preview reveal
 * every block it touches as source lines, and the block only returns as a
 * widget a transaction later when the cursor collapses. So the painting is
 * derived from the highlight state on each update instead, which also covers a
 * block scrolling into view while the highlight is up.
 *
 * A widget is painted when the yank touches any line it stands in for, matching
 * how linewise visual selection treats the same blocks — the block is opaque,
 * so there is no partial state to show.
 */
class YankWidgetHighlight {
    private painted = new Set<HTMLElement>();

    constructor(view: EditorView) {
        this.schedule(view);
    }

    update(update: ViewUpdate): void {
        this.schedule(update.view);
    }

    destroy(): void {
        this.unpaintAll();
    }

    private schedule(view: EditorView): void {
        const active = view.state.field(yankHighlightField).decos.size > 0;
        // Reading widget geometry forces layout, so stay out of the way
        // entirely unless a highlight is up or one is still to be cleaned up.
        if (!active && this.painted.size === 0) return;
        view.requestMeasure<CoveredWidgets>({
            key: this,
            read: (v) => this.covered(v),
            write: (measured) => this.apply(measured),
        });
    }

    private covered(view: EditorView): CoveredWidgets {
        const { decos, mode } = view.state.field(yankHighlightField);
        if (decos.size === 0) return { targets: [], fade: false };

        const doc = view.state.doc;
        const lines: { start: number; end: number }[] = [];
        const cursor = decos.iter();
        while (cursor.value) {
            lines.push({
                start: doc.lineAt(cursor.from).number - 1,
                end: doc.lineAt(Math.min(cursor.to, doc.length)).number - 1,
            });
            cursor.next();
        }

        return {
            targets: blockWidgetSpans(view)
                .filter((span) =>
                    lines.some(
                        (r) =>
                            span.startLine <= r.end && span.endLine >= r.start,
                    ),
                )
                .map((span) => span.el),
            fade: mode === 'fade',
        };
    }

    private apply({ targets, fade }: CoveredWidgets): void {
        const next = new Set(targets);
        for (const el of this.painted) {
            if (!next.has(el)) this.unpaint(el);
        }
        for (const el of next) {
            el.classList.add(WIDGET_CLASS);
            el.classList.toggle(WIDGET_FADE_CLASS, fade);
        }
        this.painted = next;
    }

    private unpaintAll(): void {
        for (const el of this.painted) this.unpaint(el);
        this.painted.clear();
    }

    // No isConnected guard. Live Preview caches the element it detaches when
    // the cursor enters the block, so a class skipped here returns with the
    // element and never leaves (issue #190).
    private unpaint(el: HTMLElement): void {
        el.classList.remove(WIDGET_CLASS, WIDGET_FADE_CLASS);
    }
}

export function yankHighlightExtension(): Extension {
    return [yankHighlightField, ViewPlugin.fromClass(YankWidgetHighlight)];
}

/**
 * Dispatch a yank highlight to a specific EditorView.
 *
 * - Replaces any existing highlight (handles rapid successive yanks).
 * - Skips highlights for very large yanks (>1000 lines) to avoid stalls.
 * - Guards against disposed views (tab close during animation).
 * - In fade mode, sets `--vim-motions-yank-duration` on the view DOM so the
 *   CSS animation duration matches the JS removal timeout.
 * - Rendered blocks (callouts, embeds) that mark decorations cannot reach are
 *   painted from this state by `YankWidgetHighlight`.
 */
export function showYankHighlight(
    view: EditorView,
    ranges: { from: number; to: number }[],
    durationMs: number,
    mode: 'solid' | 'fade',
): void {
    if (ranges.length === 0) return;

    // Cap: skip highlight for very large yanks (> 1000 lines)
    const doc = view.state.doc;
    const totalLines = ranges.reduce((sum, r) => {
        const fromLine = doc.lineAt(r.from).number;
        const toLine = doc.lineAt(Math.min(r.to, doc.length)).number;
        return sum + (toLine - fromLine + 1);
    }, 0);
    if (totalLines > 1000) return;

    if (mode === 'fade') {
        view.dom.style.setProperty(
            '--vim-motions-yank-duration',
            `${durationMs}ms`,
        );
    }

    try {
        view.dispatch({
            effects: addYankHighlight.of({ ranges, mode }),
        });
    } catch {
        return; // View may be destroyed
    }

    window.setTimeout(() => {
        try {
            view.dispatch({ effects: clearYankHighlight.of(null) });
        } catch {
            // View may have been destroyed during timeout
        }
    }, durationMs);
}
