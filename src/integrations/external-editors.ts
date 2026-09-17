import { Compartment, StateEffect, type Extension } from '@codemirror/state';
import { ViewPlugin, type EditorView } from '@codemirror/view';
import type { CmAdapter, VimModeChange } from '../types/vim-api';

/** Class added to the DOM of every editor another plugin attached Vim to. */
export const EXTERNAL_EDITOR_CLASS = 'vim-motions-external';

/** What a host plugin tells Vim Motions about an editor it owns. */
export interface ExternalEditorHost {
    /** Vault path, or `file:` followed by an absolute path outside the vault. */
    path: string;
    /** Neovim-style filetype, e.g. `python` or `r`. */
    filetype: string;
    /** Handles `:w`. */
    save?(): Promise<void>;
    /** Handles `:q`. */
    close?(): void;
}

export type ExternalEditorMode = VimModeChange['mode'];

export interface ExternalEditorHandle {
    readonly view: EditorView;
    /** Whether Vim is still attached; false after `detach()` or plugin teardown. */
    readonly attached: boolean;
    detach(): void;
    getMode(): ExternalEditorMode;
    onModeChange(callback: (mode: ExternalEditorMode) => void): () => void;
}

export interface ExternalEditorEntry {
    readonly view: EditorView;
    readonly host: ExternalEditorHost;
}

interface Entry extends ExternalEditorEntry {
    handle: HandleImpl;
    adapter: CmAdapter | null;
    mode: ExternalEditorMode;
    listeners: Set<(mode: ExternalEditorMode) => void>;
    onAdapterMode: (change: VimModeChange) => void;
    onFocus: () => void;
    /** Forgets the entry if the host destroys the view without detaching. */
    lifecycle: Extension;
}

export interface ExternalEditorRegistryOptions {
    /** Builds the extension installed into each attached editor. */
    build(): Extension;
    /** Resolves the Vim adapter the extension created for a view. */
    getAdapter(view: EditorView): CmAdapter | null;
    /** Called after Vim is attached, e.g. to fire `FileType`. */
    onAttach?(entry: ExternalEditorEntry): void;
    /** Called when an attached editor gains focus. */
    onFocus?(entry: ExternalEditorEntry): void;
    /**
     * Called once an editor is detached or destroyed, before it is forgotten.
     * `adapter` is the Vim adapter it had, so callers can drop listeners that
     * outlive the view.
     */
    onRelease?(entry: ExternalEditorEntry, adapter: CmAdapter | null): void;
}

class HandleImpl implements ExternalEditorHandle {
    attached = true;

    constructor(
        readonly view: EditorView,
        private readonly registry: ExternalEditorRegistry,
    ) {}

    detach(): void {
        this.registry.detach(this.view, this);
    }

    getMode(): ExternalEditorMode {
        return this.registry.modeOf(this);
    }

    onModeChange(callback: (mode: ExternalEditorMode) => void): () => void {
        return this.registry.listen(this, callback);
    }
}

/**
 * Tracks CodeMirror views owned by other plugins that have Vim attached.
 *
 * `registerEditorExtension()` only reaches editors Obsidian creates, so each
 * external view carries its own compartment, reconfigured whenever the shared
 * extension set changes. A view keeps its compartment after detaching, so
 * attaching again reuses it instead of appending another.
 */
export class ExternalEditorRegistry {
    private readonly entries = new Map<EditorView, Entry>();
    private readonly compartments = new WeakMap<EditorView, Compartment>();
    private lastFocused: EditorView | null = null;

    constructor(private readonly options: ExternalEditorRegistryOptions) {}

    attach(view: EditorView, host: ExternalEditorHost): ExternalEditorHandle {
        const existing = this.entries.get(view);
        if (existing) this.detach(view, existing.handle);

        const handle = new HandleImpl(view, this);
        const entry: Entry = {
            view,
            host,
            handle,
            adapter: null,
            mode: 'normal',
            listeners: new Set(),
            onAdapterMode: (change) => this.emitMode(entry, change.mode),
            onFocus: () => {
                this.lastFocused = view;
                this.options.onFocus?.(entry);
            },
            lifecycle: ViewPlugin.define(() => ({
                destroy: () => this.forget(entry),
            })),
        };
        this.entries.set(view, entry);

        this.install(view, [this.options.build(), entry.lifecycle]);
        view.dom.classList.add(EXTERNAL_EDITOR_CLASS);
        view.dom.addEventListener('focusin', entry.onFocus);
        this.bindAdapter(entry);
        // Focus first: `onAttach` fires FileType, and an autocommand resolves
        // the current buffer through the focused editor.
        if (view.hasFocus) entry.onFocus();
        this.options.onAttach?.(entry);
        return handle;
    }

    detach(view: EditorView, handle?: ExternalEditorHandle): void {
        const entry = this.entries.get(view);
        if (!entry || (handle && entry.handle !== handle)) return;
        this.release(entry);
        this.entries.delete(view);
        this.install(view, []);
    }

    /** Detaches every editor, e.g. when Vim is disabled or the plugin unloads. */
    detachAll(): void {
        for (const entry of [...this.entries.values()]) {
            this.detach(entry.view, entry.handle);
        }
    }

    /** Re-applies the shared extension set after it changed. */
    reconfigureAll(): void {
        const extension = this.options.build();
        for (const entry of this.entries.values()) {
            this.install(entry.view, [extension, entry.lifecycle]);
            this.bindAdapter(entry);
        }
    }

    private forget(entry: Entry): void {
        if (this.entries.get(entry.view) !== entry) return;
        this.release(entry);
        this.entries.delete(entry.view);
    }

    get(view: EditorView): ExternalEditorEntry | null {
        return this.entries.get(view) ?? null;
    }

    views(): EditorView[] {
        return [...this.entries.keys()];
    }

    /** The attached editor that most recently had focus, if it is still open. */
    focused(): ExternalEditorEntry | null {
        const view = this.lastFocused;
        if (!view) return null;
        const entry = this.entries.get(view);
        if (!entry || !view.dom.isConnected) return null;
        return entry;
    }

    /** @internal */
    modeOf(handle: HandleImpl): ExternalEditorMode {
        const entry = this.entries.get(handle.view);
        return entry?.handle === handle ? entry.mode : 'normal';
    }

    /** @internal */
    listen(
        handle: HandleImpl,
        callback: (mode: ExternalEditorMode) => void,
    ): () => void {
        const entry = this.entries.get(handle.view);
        if (!entry || entry.handle !== handle) return () => {};
        entry.listeners.add(callback);
        return () => entry.listeners.delete(callback);
    }

    private install(view: EditorView, extension: Extension): void {
        let compartment = this.compartments.get(view);
        if (compartment && compartment.get(view.state) !== undefined) {
            view.dispatch({ effects: compartment.reconfigure(extension) });
            return;
        }
        compartment = new Compartment();
        this.compartments.set(view, compartment);
        view.dispatch({
            effects: StateEffect.appendConfig.of(compartment.of(extension)),
        });
    }

    /** The Vim plugin may be recreated by a reconfigure, so rebind when it changes. */
    private bindAdapter(entry: Entry): void {
        const adapter = this.options.getAdapter(entry.view);
        if (adapter === entry.adapter) return;
        this.unbindAdapter(entry);
        entry.adapter = adapter;
        adapter?.on('vim-mode-change', entry.onAdapterMode);
    }

    private unbindAdapter(entry: Entry): void {
        entry.adapter?.off(
            'vim-mode-change',
            entry.onAdapterMode as (...args: unknown[]) => void,
        );
        entry.adapter = null;
    }

    private release(entry: Entry): void {
        const adapter = entry.adapter;
        this.unbindAdapter(entry);
        entry.view.dom.removeEventListener('focusin', entry.onFocus);
        entry.view.dom.classList.remove(EXTERNAL_EDITOR_CLASS);
        if (this.lastFocused === entry.view) this.lastFocused = null;
        // Listeners that react to leaving insert mode see detaching as doing so.
        const outsideNormal = entry.mode !== 'normal';
        entry.handle.attached = false;
        if (outsideNormal) this.emitMode(entry, 'normal');
        entry.listeners.clear();
        try {
            this.options.onRelease?.(entry, adapter);
        } catch (error) {
            console.error(
                '[Vim Motions] External editor release hook failed:',
                error,
            );
        }
    }

    private emitMode(entry: Entry, mode: ExternalEditorMode): void {
        entry.mode = mode;
        for (const listener of [...entry.listeners]) {
            try {
                listener(mode);
            } catch (error) {
                console.error(
                    '[Vim Motions] External editor mode listener failed:',
                    error,
                );
            }
        }
    }
}
