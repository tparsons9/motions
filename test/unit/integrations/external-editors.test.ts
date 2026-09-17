import { describe, expect, it, vi } from 'vitest';
import { EditorState, StateField, type Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
    EXTERNAL_EDITOR_CLASS,
    ExternalEditorRegistry,
} from '../../../src/integrations/external-editors';
import {
    createEditorApi,
    installEditorApi,
    uninstallEditorApi,
} from '../../../src/integrations/editor-api';
import { LanguageProviderRegistry } from '../../../src/integrations/language-providers';
import type { CmAdapter, VimModeChange } from '../../../src/types/vim-api';

const marker = (name: string) =>
    StateField.define<string>({ create: () => name, update: (v) => v });

function fakeView(doc = 'x = 1\n') {
    const classes = new Set<string>();
    const listeners = new Map<string, Set<() => void>>();
    const view = {
        state: EditorState.create({ doc }),
        hasFocus: false,
        dom: {
            isConnected: true,
            classList: {
                add: (c: string) => classes.add(c),
                remove: (c: string) => classes.delete(c),
                contains: (c: string) => classes.has(c),
            },
            addEventListener: (type: string, fn: () => void) => {
                if (!listeners.has(type)) listeners.set(type, new Set());
                listeners.get(type)!.add(fn);
            },
            removeEventListener: (type: string, fn: () => void) =>
                listeners.get(type)?.delete(fn),
        },
        dispatch(spec: Parameters<EditorState['update']>[0]) {
            view.state = view.state.update(spec).state;
        },
        fire(type: string) {
            for (const fn of listeners.get(type) ?? []) fn();
        },
        listenerCount: (type: string) => listeners.get(type)?.size ?? 0,
    };
    return view;
}

function fakeAdapter() {
    const handlers = new Set<(change: VimModeChange) => void>();
    return {
        adapter: {
            on: (_event: string, fn: (change: VimModeChange) => void) =>
                handlers.add(fn),
            off: (_event: string, fn: (change: VimModeChange) => void) =>
                handlers.delete(fn),
        } as unknown as CmAdapter,
        emit: (mode: VimModeChange['mode']) => {
            for (const fn of [...handlers]) fn({ mode });
        },
        count: () => handlers.size,
    };
}

function setup(initial: Extension[] = [marker('vim')]) {
    let slot = initial;
    const adapters = new Map<unknown, ReturnType<typeof fakeAdapter>>();
    const registry = new ExternalEditorRegistry({
        build: () => [...slot],
        getAdapter: (view) => {
            if (slot.length === 0) return null;
            if (!adapters.has(view)) adapters.set(view, fakeAdapter());
            return adapters.get(view)!.adapter;
        },
    });
    return {
        registry,
        setSlot: (next: Extension[]) => {
            slot = next;
        },
        adapterFor: (view: unknown) => adapters.get(view)!,
    };
}

const host = { path: 'file:/repo/app.py', filetype: 'python' };
const hooks = () => ({ getAdapter: () => null, recordJump: () => {} });
const asView = (v: ReturnType<typeof fakeView>) => v as unknown as EditorView;

describe('ExternalEditorRegistry', () => {
    it('installs the shared extension and marks the editor', () => {
        const field = marker('vim');
        const { registry } = setup([field]);
        const view = fakeView();

        const handle = registry.attach(asView(view), host);

        expect(view.state.field(field, false)).toBe('vim');
        expect(view.dom.classList.contains(EXTERNAL_EDITOR_CLASS)).toBe(true);
        expect(handle.attached).toBe(true);
        expect(registry.get(asView(view))?.host).toBe(host);
        expect(registry.views()).toEqual([view]);
    });

    it('removes the extension on detach and reuses the compartment on reattach', () => {
        const field = marker('vim');
        const { registry } = setup([field]);
        const view = fakeView();

        const first = registry.attach(asView(view), host);
        first.detach();
        expect(view.state.field(field, false)).toBeUndefined();
        expect(view.dom.classList.contains(EXTERNAL_EDITOR_CLASS)).toBe(false);
        expect(first.attached).toBe(false);
        expect(view.listenerCount('focusin')).toBe(0);

        const second = registry.attach(asView(view), host);
        expect(view.state.field(field, false)).toBe('vim');
        // A second appended compartment would survive this detach.
        second.detach();
        expect(view.state.field(field, false)).toBeUndefined();
    });

    it('ignores a stale handle after the view was attached again', () => {
        const field = marker('vim');
        const { registry } = setup([field]);
        const view = fakeView();

        const stale = registry.attach(asView(view), host);
        registry.attach(asView(view), { ...host, filetype: 'r' });
        stale.detach();

        expect(view.state.field(field, false)).toBe('vim');
        expect(registry.get(asView(view))?.host.filetype).toBe('r');
    });

    it('reconfigures attached editors with the rebuilt extension set', () => {
        const before = marker('before');
        const after = marker('after');
        const { registry, setSlot } = setup([before]);
        const view = fakeView();
        registry.attach(asView(view), host);

        setSlot([after]);
        registry.reconfigureAll();

        expect(view.state.field(before, false)).toBeUndefined();
        expect(view.state.field(after, false)).toBe('after');
    });

    it('detachAll clears every editor', () => {
        const field = marker('vim');
        const { registry } = setup([field]);
        const a = fakeView();
        const b = fakeView();
        const handleA = registry.attach(asView(a), host);
        const handleB = registry.attach(asView(b), host);

        registry.detachAll();

        expect(registry.views()).toEqual([]);
        expect(handleA.attached || handleB.attached).toBe(false);
        expect(a.state.field(field, false)).toBeUndefined();
        expect(b.state.field(field, false)).toBeUndefined();
    });

    it('reports mode changes and treats detaching as returning to normal', () => {
        const { registry, adapterFor } = setup();
        const view = fakeView();
        const handle = registry.attach(asView(view), host);
        const modes: string[] = [];
        handle.onModeChange((mode) => modes.push(mode));

        adapterFor(view).emit('insert');
        expect(handle.getMode()).toBe('insert');
        handle.detach();

        expect(modes).toEqual(['insert', 'normal']);
        expect(adapterFor(view).count()).toBe(0);
    });

    it('isolates a throwing mode listener', () => {
        const { registry, adapterFor } = setup();
        const view = fakeView();
        const handle = registry.attach(asView(view), host);
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const seen = vi.fn();
        handle.onModeChange(() => {
            throw new Error('boom');
        });
        handle.onModeChange(seen);

        adapterFor(view).emit('visual');

        expect(seen).toHaveBeenCalledWith('visual');
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });

    it('tracks the most recently focused attached editor', () => {
        const { registry } = setup();
        const a = fakeView();
        const b = fakeView();
        registry.attach(asView(a), host);
        const handleB = registry.attach(asView(b), { ...host, path: 'b' });

        expect(registry.focused()).toBeNull();
        b.fire('focusin');
        expect(registry.focused()?.host.path).toBe('b');

        b.dom.isConnected = false;
        expect(registry.focused()).toBeNull();
        b.dom.isConnected = true;

        handleB.detach();
        expect(registry.focused()).toBeNull();
    });
});

describe('ExternalEditorRegistry hooks', () => {
    it('reports attach, focus and release, isolating a failing release hook', () => {
        const attached: string[] = [];
        const focused: string[] = [];
        const released: string[] = [];
        const registry = new ExternalEditorRegistry({
            build: () => [],
            getAdapter: () => null,
            onAttach: (entry) => attached.push(entry.host.path),
            onFocus: (entry) => focused.push(entry.host.path),
            onRelease: (entry) => {
                released.push(entry.host.path);
                throw new Error('boom');
            },
        });
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const a = fakeView();
        const b = fakeView();
        b.hasFocus = true;
        registry.attach(asView(a), { ...host, path: 'a' });
        registry.attach(asView(b), { ...host, path: 'b' });
        expect(attached).toEqual(['a', 'b']);
        expect(focused).toEqual(['b']);

        a.fire('focusin');
        expect(focused).toEqual(['b', 'a']);
        expect(registry.focused()?.host.path).toBe('a');

        registry.detachAll();
        expect(released).toEqual(['a', 'b']);
        expect(registry.views()).toEqual([]);
        expect(error).toHaveBeenCalledTimes(2);
        error.mockRestore();
    });
});

describe('editor API', () => {
    it('validates arguments before attaching', () => {
        const { registry } = setup();
        const api = createEditorApi(
            registry,
            new LanguageProviderRegistry(),
            hooks(),
        );

        expect(api.apiVersion).toBe(1);
        expect(() => api.attach({} as EditorView, host)).toThrow(/EditorView/);
        expect(() =>
            api.attach(asView(fakeView()), { path: 'a' } as never),
        ).toThrow(/filetype/);
        expect(() =>
            api.attach(asView(fakeView()), { ...host, save: 'no' } as never),
        ).toThrow(/save/);
    });

    it('attaches through the registry and reports attachment', () => {
        const { registry } = setup();
        const api = createEditorApi(
            registry,
            new LanguageProviderRegistry(),
            hooks(),
        );
        const view = asView(fakeView());

        const handle = api.attach(view, host);
        expect(api.isAttached(view)).toBe(true);
        handle.detach();
        expect(api.isAttached(view)).toBe(false);
    });

    it('installs and removes window.VimMotions.editor without disturbing siblings', () => {
        const win = window as unknown as {
            VimMotions?: Record<string, unknown>;
        };
        const api = createEditorApi(
            setup().registry,
            new LanguageProviderRegistry(),
        );

        installEditorApi(api);
        expect(win.VimMotions?.editor).toBe(api);
        win.VimMotions!.picker = 'picker';

        uninstallEditorApi();
        expect(win.VimMotions?.editor).toBeUndefined();
        expect(win.VimMotions?.picker).toBe('picker');

        delete win.VimMotions!.picker;
        installEditorApi(api);
        uninstallEditorApi();
        expect(win.VimMotions).toBeUndefined();
    });
});
