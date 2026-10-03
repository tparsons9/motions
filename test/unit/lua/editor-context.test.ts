import { describe, expect, it } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { LuaEditorContext } from '../../../src/lua/editor-context';
import type { ExternalEditorEntry } from '../../../src/integrations/external-editors';

const entry = (path: string, filetype: string): ExternalEditorEntry => ({
    view: { hasFocus: false } as EditorView,
    host: { path, filetype },
});
const focus = (target: ExternalEditorEntry, value: boolean) =>
    Object.assign(target.view, { hasFocus: value });

describe('Lua editor context', () => {
    it('follows actual focus while the active vault note stays stale', () => {
        const note = entry('note.md', 'markdown');
        const python = entry('file:/repo/app.py', 'python');
        const typescript = entry('file:/repo/app.ts', 'typescript');
        const entries = [note, python, typescript];
        const context = new LuaEditorContext(
            () => entries,
            () => note,
        );
        for (const target of [note, python, typescript, note]) {
            entries.forEach((item) => focus(item, item === target));
            expect(context.current()?.host).toEqual(target.host);
        }
        entries.splice(1, 2);
        expect(context.current()?.host.path).toBe('note.md');
    });

    it('targets background FileType and nested callbacks without changing focus', () => {
        const note = entry('note.md', 'markdown');
        const code = entry('file:/repo/app.py', 'python');
        focus(note, true);
        const context = new LuaEditorContext(
            () => [note, code],
            () => note,
        );
        const observed: string[] = [];
        expect(() =>
            context.withEntry(code, () => {
                observed.push(context.current()!.host.path);
                context.withView(note.view, () =>
                    observed.push(context.current()!.host.path),
                );
                observed.push(context.current()!.host.path);
                throw new Error('callback');
            }),
        ).toThrow('callback');
        expect(observed).toEqual([
            'file:/repo/app.py',
            'note.md',
            'file:/repo/app.py',
        ]);
        expect(context.current()?.host.path).toBe('note.md');
        expect(note.view.hasFocus).toBe(true);
    });
});
