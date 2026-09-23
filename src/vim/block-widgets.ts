import { type EditorView } from '@codemirror/view';

interface BlockWidgetSpan {
    el: HTMLElement;
    /** 0-based first document line the widget stands in for. */
    startLine: number;
    /** 0-based last document line the widget stands in for. */
    endLine: number;
}

/**
 * Every rendered block widget currently in `view`, with the document lines it
 * replaces.
 *
 * Live Preview renders callouts, embeds, images, and tables as block widgets,
 * and no `Decoration.mark` can reach one — CodeMirror's `ContentBuilder.point`
 * drops the active marks when it emits a block point. Anything that has to
 * paint those blocks has to find them in the DOM and map them back to lines
 * instead, so both consumers share this walk rather than keeping two copies of
 * the element filtering and `posAtDOM` handling in sync.
 */
export function blockWidgetSpans(view: EditorView): BlockWidgetSpan[] {
    const doc = view.state.doc;
    const spans: BlockWidgetSpan[] = [];

    for (const child of Array.from(view.contentDOM.children)) {
        const el = child as HTMLElement;
        if (el.classList.contains('cm-line')) continue;
        if (el.classList.contains('cm-widgetBuffer')) continue;
        if (el.getBoundingClientRect().height === 0) continue;

        let startLine: number;
        let endLine: number;
        try {
            startLine = doc.lineAt(view.posAtDOM(el, 0)).number - 1;
            endLine =
                doc.lineAt(view.posAtDOM(el, el.childNodes.length)).number - 1;
        } catch {
            continue;
        }

        spans.push({ el, startLine, endLine });
    }

    return spans;
}
