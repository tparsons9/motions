import type { EditorView } from '@codemirror/view';
import type {
    LanguageProvider,
    LanguageProviderRegistry,
} from './language-providers';
import type { CmAdapter, VimModeChange } from '../types/vim-api';
import type {
    ExternalEditorHandle,
    ExternalEditorHost,
    ExternalEditorRegistry,
} from './external-editors';

export const EDITOR_API_VERSION = 1;
export const EDITOR_API_READY_EVENT = 'vim-motions:editor-api-ready';
export const EDITOR_API_UNLOAD_EVENT = 'vim-motions:editor-api-unload';

/**
 * Lets other plugins attach Vim Motions to CodeMirror editors they create
 * themselves. See `docs/development/editor-api.md`.
 */
export interface VimMotionsEditorApi {
    readonly apiVersion: typeof EDITOR_API_VERSION;
    attach(view: EditorView, host: ExternalEditorHost): ExternalEditorHandle;
    isAttached(view: EditorView): boolean;
    /** Routes `gd`, `K`, `]d`/`[d` and Lua `vim.lsp`/`vim.diagnostic` to `provider` where it matches. */
    registerLanguageProvider(provider: LanguageProvider): () => void;
    /** Vim mode changes in any editor Vim is active in, including Obsidian's own. */
    onModeChange(
        view: EditorView,
        callback: (mode: VimModeChange['mode']) => void,
    ): () => void;
    /** Records the cursor in the jump list, so `<C-o>` returns after a jump. */
    recordJump(view: EditorView): void;
}

function assertView(view: unknown): asserts view is EditorView {
    const candidate = view as Partial<EditorView> | null;
    if (
        !candidate ||
        typeof candidate.dispatch !== 'function' ||
        !candidate.state ||
        !candidate.dom
    ) {
        throw new TypeError('attach() requires a CodeMirror EditorView');
    }
}

function assertHost(host: unknown): asserts host is ExternalEditorHost {
    const candidate = host as Partial<ExternalEditorHost> | null;
    if (
        !candidate ||
        typeof candidate.path !== 'string' ||
        typeof candidate.filetype !== 'string'
    ) {
        throw new TypeError(
            'attach() requires a host with string `path` and `filetype`',
        );
    }
    for (const name of ['save', 'close'] as const) {
        if (
            candidate[name] !== undefined &&
            typeof candidate[name] !== 'function'
        ) {
            throw new TypeError(`host.${name} must be a function`);
        }
    }
}

export interface EditorApiHooks {
    getAdapter(view: EditorView): CmAdapter | null;
    recordJump(view: EditorView): void;
}

export function createEditorApi(
    registry: ExternalEditorRegistry,
    languageProviders: LanguageProviderRegistry,
    hooks: EditorApiHooks,
): VimMotionsEditorApi {
    return Object.freeze({
        apiVersion: EDITOR_API_VERSION,
        attach(view: EditorView, host: ExternalEditorHost) {
            assertView(view);
            assertHost(host);
            return registry.attach(view, host);
        },
        isAttached(view: EditorView) {
            return registry.get(view) !== null;
        },
        registerLanguageProvider(provider: LanguageProvider) {
            return languageProviders.register(provider);
        },
        onModeChange(
            view: EditorView,
            callback: (mode: VimModeChange['mode']) => void,
        ) {
            assertView(view);
            if (typeof callback !== 'function') {
                throw new TypeError('onModeChange() requires a callback');
            }
            const adapter = hooks.getAdapter(view);
            if (!adapter) return () => {};
            const handler = (change: VimModeChange): void => {
                try {
                    callback(change.mode);
                } catch (error) {
                    console.error('[Vim Motions] mode listener failed:', error);
                }
            };
            adapter.on('vim-mode-change', handler);
            return () => {
                adapter.off(
                    'vim-mode-change',
                    handler as (...args: unknown[]) => void,
                );
            };
        },
        recordJump(view: EditorView) {
            assertView(view);
            hooks.recordJump(view);
        },
    });
}

export function installEditorApi(api: VimMotionsEditorApi): void {
    const win = window as unknown as Record<string, Record<string, unknown>>;
    if (!win.VimMotions) {
        win.VimMotions = {};
    }
    Object.defineProperty(win.VimMotions, 'editor', {
        value: api,
        configurable: true,
        enumerable: true,
    });
}

export function uninstallEditorApi(): void {
    const win = window as unknown as Record<string, Record<string, unknown>>;
    if (!win.VimMotions) return;
    delete win.VimMotions.editor;
    if (Object.keys(win.VimMotions).length === 0) {
        delete (win as Record<string, unknown>).VimMotions;
    }
}
