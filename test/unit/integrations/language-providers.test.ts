import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
    LanguageProviderRegistry,
    createDiagnosticMotion,
    diagnosticTarget,
    withLanguageProvider,
    type LanguageDiagnostic,
    type LanguageProvider,
} from '../../../src/integrations/language-providers';
import type {
    ActionFn,
    CmAdapter,
    MotionArgs,
} from '../../../src/types/vim-api';

const view = {} as EditorView;

function provider(
    id: string,
    overrides: Partial<LanguageProvider> = {},
): LanguageProvider {
    return { id, matches: () => true, ...overrides };
}

function diagnostic(from: number, message = 'oops'): LanguageDiagnostic {
    return { from, to: from + 1, severity: 'error', message };
}

describe('LanguageProviderRegistry', () => {
    it('prefers the newest provider that matches and implements the action', () => {
        const registry = new LanguageProviderRegistry();
        const older = vi.fn();
        const newer = vi.fn();
        registry.register(provider('older', { definition: older }));
        registry.register(
            provider('newer', {
                matches: (_v, pos) => pos > 5,
                definition: newer,
            }),
        );

        expect(registry.run('definition', view, 10)).toBe(true);
        expect(newer).toHaveBeenCalledWith(view, 10);
        expect(older).not.toHaveBeenCalled();

        expect(registry.run('definition', view, 1)).toBe(true);
        expect(older).toHaveBeenCalledWith(view, 1);

        expect(registry.run('format', view, 1)).toBe(false);
    });

    it('replaces a provider registered under the same id', () => {
        const registry = new LanguageProviderRegistry();
        const first = vi.fn();
        const second = vi.fn();
        registry.register(provider('same', { hover: first }));
        registry.register(provider('same', { hover: second }));

        registry.run('hover', view, 0);
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledOnce();
    });

    it('unregisters, clears and validates', () => {
        const registry = new LanguageProviderRegistry();
        const hover = vi.fn();
        const dispose = registry.register(provider('a', { hover }));
        dispose();
        expect(registry.run('hover', view, 0)).toBe(false);

        registry.register(provider('b', { hover }));
        registry.clear();
        expect(registry.run('hover', view, 0)).toBe(false);

        expect(() => registry.register({ id: '' } as LanguageProvider)).toThrow(
            /id/,
        );
        expect(() =>
            registry.register({
                id: 'c',
                matches: () => true,
                hover: 'no',
            } as unknown as LanguageProvider),
        ).toThrow(/hover/);
    });

    it('survives a provider that throws in matches, the action, or diagnostics', () => {
        const registry = new LanguageProviderRegistry();
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const good = vi.fn();
        registry.register(
            provider('good', {
                hover: good,
                diagnostics: () => [diagnostic(4)],
            }),
        );
        registry.register(
            provider('bad', {
                matches: () => {
                    throw new Error('matches');
                },
                hover: vi.fn(),
                diagnostics: () => {
                    throw new Error('diagnostics');
                },
            }),
        );

        expect(registry.run('hover', view, 0)).toBe(true);
        expect(good).toHaveBeenCalledOnce();
        expect(registry.diagnostics(view)).toEqual([diagnostic(4)]);

        registry.clear();
        registry.register(
            provider('thrower', {
                hover: () => {
                    throw new Error('sync boom');
                },
            }),
        );
        expect(registry.run('hover', view, 0)).toBe(true);
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });

    it('reports a rejected async action without unhandled rejections', async () => {
        const registry = new LanguageProviderRegistry();
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        registry.register(
            provider('async', {
                format: () => Promise.reject(new Error('late')),
            }),
        );

        expect(registry.run('format', view, 0)).toBe(true);
        await Promise.resolve();
        await Promise.resolve();
        expect(error).toHaveBeenCalledWith(
            '[Vim Motions] async format failed:',
            expect.any(Error),
        );
        error.mockRestore();
    });

    it('merges diagnostics from every provider, sorted and deduplicated', () => {
        const registry = new LanguageProviderRegistry();
        registry.register(
            provider('a', {
                diagnostics: () => [diagnostic(9), diagnostic(2)],
            }),
        );
        registry.register(
            provider('b', {
                diagnostics: () => [diagnostic(2), diagnostic(5)],
            }),
        );

        expect(registry.diagnostics(view).map((item) => item.from)).toEqual([
            2, 5, 9,
        ]);
    });
});

describe('diagnosticTarget()', () => {
    const items = [diagnostic(5), diagnostic(5, 'second'), diagnostic(20)];

    it('finds the next and previous diagnostic, ignoring duplicate starts', () => {
        expect(diagnosticTarget(items, 0, true)?.from).toBe(5);
        expect(diagnosticTarget(items, 5, true)?.from).toBe(20);
        expect(diagnosticTarget(items, 20, false)?.from).toBe(5);
    });

    it('wraps around the document and honours the count', () => {
        expect(diagnosticTarget(items, 30, true)?.from).toBe(5);
        expect(diagnosticTarget(items, 0, false)?.from).toBe(20);
        expect(diagnosticTarget(items, 0, true, 2)?.from).toBe(20);
        expect(diagnosticTarget(items, 0, true, 3)?.from).toBe(5);
        expect(diagnosticTarget([], 0, true)).toBeNull();
    });
});

describe('vim integration', () => {
    const adapterFor = (state: EditorState) =>
        ({ cm6: { state } }) as unknown as CmAdapter;

    it('falls back to the original action when no provider matches', () => {
        const registry = new LanguageProviderRegistry();
        const fallback = vi.fn() as unknown as ActionFn;
        const action = withLanguageProvider(() => registry, 'hover', fallback);
        const cm = adapterFor(EditorState.create({ doc: 'abc' }));

        action(cm, { repeat: 1 } as never, {} as never);
        expect(fallback).toHaveBeenCalledOnce();

        const hover = vi.fn();
        registry.register(provider('p', { hover }));
        action(cm, { repeat: 1 } as never, {} as never);
        expect(hover).toHaveBeenCalledWith(cm.cm6, 0);
        expect(fallback).toHaveBeenCalledOnce();
    });

    it('moves the cursor to the next diagnostic and stays put when there are none', () => {
        const registry = new LanguageProviderRegistry();
        const state = EditorState.create({ doc: 'aa\nbb\ncc\n' });
        const cm = adapterFor(state);
        const motion = createDiagnosticMotion(() => registry, true);
        const head = { line: 0, ch: 0 };
        const args = { repeat: 1 } as MotionArgs;

        expect(motion(cm, head, args, {} as never, null)).toEqual(head);

        // Offsets 3 and 6 are the starts of lines 2 and 3.
        registry.register(
            provider('p', {
                diagnostics: () => [diagnostic(3), diagnostic(6)],
            }),
        );
        expect(motion(cm, head, args, {} as never, null)).toEqual({
            line: 1,
            ch: 0,
        });
        expect(
            motion(cm, head, { repeat: 2 } as MotionArgs, {} as never, null),
        ).toEqual({ line: 2, ch: 0 });
    });
});
