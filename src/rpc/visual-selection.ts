import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

/**
 * Neovim's visual selection, rendered as a decoration rather than as CM6's own
 * selection.
 *
 * Mirroring it into `EditorSelection` is the obvious approach and was measured
 * to break Escape: with a non-empty selection in the editor, Obsidian consumes
 * the Escape keydown before the RPC delegation listener on `contentDOM` sees
 * it, so visual mode could be entered but never left. A decoration carries no
 * selection semantics, so Obsidian has nothing to act on, and the cursor CM6
 * holds stays the caret Neovim reports.
 */

export interface VisualRange {
    from: number;
    to: number;
}

export const setVisualSelection = StateEffect.define<VisualRange[]>();

const visualMark = Decoration.mark({ class: 'vim-motions-rpc-visual' });

const neovimVisualSelectionField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, transaction) {
        let next = transaction.docChanged
            ? value.map(transaction.changes)
            : value;
        for (const effect of transaction.effects) {
            if (!effect.is(setVisualSelection)) continue;
            next = Decoration.set(
                effect.value
                    .filter((range) => range.to > range.from)
                    .map((range) => visualMark.range(range.from, range.to)),
                true,
            );
        }
        return next;
    },
    provide: (field) => EditorView.decorations.from(field),
});

export function neovimVisualSelectionExtension(): Extension {
    return neovimVisualSelectionField;
}
