import { describe, expect, it } from 'vitest';
import { EditorState, type TransactionSpec } from '@codemirror/state';
import { indentUnit } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { LocalOptions, readLocalOption } from '../../../src/lua/local-options';
function editor() {
    return {
        state: EditorState.create({
            extensions: [EditorState.tabSize.of(8), indentUnit.of('\t')],
        }),
        dom: { isConnected: true },
        dispatch(spec: TransactionSpec) {
            this.state = this.state.update(spec).state;
        },
    };
}

describe('local options', () => {
    it('changes only the target views and restores host facets on cleanup', async () => {
        const options = new LocalOptions();
        const one = editor(),
            two = editor(),
            note = editor();
        options.attach(one as unknown as EditorView, 'code.py');
        options.attach(two as unknown as EditorView, 'code.py');
        options.attach(note as unknown as EditorView, 'note.md');
        options.set('code.py', 'expandtab', true);
        options.set('code.py', 'tabstop', 4);
        options.set('code.py', 'shiftwidth', 2);
        options.set('code.py', 'textwidth', 60);
        await Promise.resolve();
        expect([
            one.state.tabSize,
            two.state.tabSize,
            note.state.tabSize,
        ]).toEqual([4, 4, 8]);
        expect([
            one.state.facet(indentUnit),
            note.state.facet(indentUnit),
        ]).toEqual(['  ', '\t']);
        expect(readLocalOption(one as unknown as EditorView, 'textwidth')).toBe(
            60,
        );
        options.detach(one as unknown as EditorView);
        await Promise.resolve();
        expect([one.state.tabSize, two.state.tabSize]).toEqual([8, 4]);
        options.clear();
        await Promise.resolve();
        expect(two.state.facet(indentUnit)).toBe('\t');
        expect(options.get('code.py', 'textwidth')).toBeUndefined();
        expect(
            readLocalOption(two as unknown as EditorView, 'textwidth'),
        ).toBeUndefined();
    });

    it('cancels queued writes after release and reapplies a new reload generation', async () => {
        const options = new LocalOptions(),
            view = editor();
        options.attach(view as unknown as EditorView, 'old.py');
        options.set('old.py', 'tabstop', 3);
        options.release('old.py');
        options.attach(view as unknown as EditorView, 'new.ts');
        options.set('new.ts', 'tabstop', 2);
        await Promise.resolve();
        expect(view.state.tabSize).toBe(2);
        expect(options.get('old.py', 'tabstop')).toBeUndefined();
        options.clear();
        await Promise.resolve();
        expect(view.state.tabSize).toBe(8);
    });
});
