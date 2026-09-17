import { describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import {
    closeExternalEditor,
    externalEditorFor,
    saveExternalEditor,
} from '../../../src/integrations/external-ex-commands';
import type {
    ExternalEditorEntry,
    ExternalEditorHost,
} from '../../../src/integrations/external-editors';
import type { CmAdapter } from '../../../src/types/vim-api';

function entry(host: Partial<ExternalEditorHost> = {}): ExternalEditorEntry {
    return {
        view: {} as EditorView,
        host: { path: 'file:/repo/app.py', filetype: 'python', ...host },
    };
}

describe('external editor ex commands', () => {
    it('resolves the host from the adapter running the command', () => {
        const view = {} as EditorView;
        const found = entry();
        const lookup = vi.fn((v: EditorView) => (v === view ? found : null));

        expect(
            externalEditorFor({ cm6: view } as unknown as CmAdapter, lookup),
        ).toBe(found);
        expect(
            externalEditorFor({ cm6: {} } as unknown as CmAdapter, lookup),
        ).toBeNull();
        expect(externalEditorFor(undefined, lookup)).toBeNull();
        expect(
            externalEditorFor({ cm6: view } as unknown as CmAdapter, undefined),
        ).toBeNull();
    });

    it('fires write autocommands around a successful host save', async () => {
        const order: string[] = [];
        const save = vi.fn(() => {
            order.push('save');
            return Promise.resolve();
        });
        const events = {
            fire: (event: string, data: { file: string }) =>
                order.push(`${event}:${data.file}`),
        };

        await expect(saveExternalEditor(entry({ save }), events)).resolves.toBe(
            true,
        );
        expect(order).toEqual([
            'BufWritePre:file:/repo/app.py',
            'save',
            'BufWritePost:file:/repo/app.py',
        ]);
    });

    it('reports a failed or unsupported save without firing BufWritePost', async () => {
        const fire = vi.fn();
        const failing = vi.fn(() => Promise.reject(new Error('conflict')));

        await expect(
            saveExternalEditor(entry({ save: failing }), { fire }),
        ).resolves.toBe(false);
        expect(fire).toHaveBeenCalledTimes(1);
        expect(fire).toHaveBeenCalledWith('BufWritePre', {
            file: 'file:/repo/app.py',
        });

        fire.mockClear();
        await expect(saveExternalEditor(entry(), { fire })).resolves.toBe(
            false,
        );
        expect(fire).not.toHaveBeenCalled();
    });

    it('closes through the host only when it provides a handler', () => {
        const close = vi.fn();
        expect(closeExternalEditor(entry({ close }))).toBe(true);
        expect(close).toHaveBeenCalledOnce();
        expect(closeExternalEditor(entry())).toBe(false);
    });
});
