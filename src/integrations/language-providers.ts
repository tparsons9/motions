import { Notice } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import type { ActionFn, CmAdapter, MotionFn, VimPos } from '../types/vim-api';

export type LanguageAction = 'hover' | 'definition' | 'codeAction' | 'format';

export interface LanguageDiagnostic {
    from: number;
    to: number;
    severity: 'error' | 'warning' | 'info' | 'hint';
    message: string;
    source?: string;
}

/**
 * Language features another plugin provides for code in an editor, e.g. from
 * a language server. Vim Motions routes `gd`, `K`, `]d`/`[d` and the Lua
 * `vim.lsp.buf`/`vim.diagnostic` functions through these.
 */
export interface LanguageProvider {
    /** Unique, e.g. `my-plugin`. Registering the same id again replaces it. */
    id: string;
    /** Whether this provider handles the code at `pos`. */
    matches(view: EditorView, pos: number): boolean;
    hover?(view: EditorView, pos: number): void | Promise<void>;
    definition?(view: EditorView, pos: number): void | Promise<void>;
    codeAction?(view: EditorView, pos: number): void | Promise<void>;
    format?(view: EditorView, pos: number): void | Promise<void>;
    /** Every diagnostic in the editor, in document offsets. */
    diagnostics?(view: EditorView): readonly LanguageDiagnostic[];
}

const ACTIONS: readonly LanguageAction[] = [
    'hover',
    'definition',
    'codeAction',
    'format',
];

function assertProvider(
    provider: unknown,
): asserts provider is LanguageProvider {
    const candidate = provider as Partial<LanguageProvider> | null;
    if (
        !candidate ||
        typeof candidate.id !== 'string' ||
        !candidate.id ||
        typeof candidate.matches !== 'function'
    ) {
        throw new TypeError(
            'A language provider needs a non-empty string `id` and a `matches` function',
        );
    }
    for (const name of [...ACTIONS, 'diagnostics'] as const) {
        if (
            candidate[name] !== undefined &&
            typeof candidate[name] !== 'function'
        ) {
            throw new TypeError(`provider.${name} must be a function`);
        }
    }
}

function report(
    provider: LanguageProvider,
    what: string,
    error: unknown,
): void {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Vim Motions] ${provider.id} ${what} failed:`, error);
    new Notice(`${provider.id}: ${message}`);
}

export class LanguageProviderRegistry {
    private providers: LanguageProvider[] = [];

    register(provider: LanguageProvider): () => void {
        assertProvider(provider);
        this.providers = [
            provider,
            ...this.providers.filter((item) => item.id !== provider.id),
        ];
        return () => {
            this.providers = this.providers.filter((item) => item !== provider);
        };
    }

    clear(): void {
        this.providers = [];
    }

    /** The most recently registered provider that matches and implements `action`. */
    find(
        action: LanguageAction,
        view: EditorView,
        pos: number,
    ): LanguageProvider | null {
        for (const provider of this.providers) {
            if (typeof provider[action] !== 'function') continue;
            try {
                if (provider.matches(view, pos)) return provider;
            } catch (error) {
                console.error(
                    `[Vim Motions] ${provider.id} matches() failed:`,
                    error,
                );
            }
        }
        return null;
    }

    /** Runs `action` at `pos`; false when no provider handles it. */
    run(action: LanguageAction, view: EditorView, pos: number): boolean {
        const provider = this.find(action, view, pos);
        if (!provider) return false;
        try {
            void Promise.resolve(provider[action]?.(view, pos)).catch(
                (error: unknown) => report(provider, action, error),
            );
        } catch (error) {
            report(provider, action, error);
        }
        return true;
    }

    /** Diagnostics from every provider, sorted by position, without duplicates. */
    diagnostics(view: EditorView): LanguageDiagnostic[] {
        const seen = new Set<string>();
        const result: LanguageDiagnostic[] = [];
        for (const provider of this.providers) {
            if (!provider.diagnostics) continue;
            let items: readonly LanguageDiagnostic[];
            try {
                items = provider.diagnostics(view);
            } catch (error) {
                console.error(
                    `[Vim Motions] ${provider.id} diagnostics() failed:`,
                    error,
                );
                continue;
            }
            for (const item of items) {
                const key = `${item.from}:${item.to}:${item.message}`;
                if (seen.has(key)) continue;
                seen.add(key);
                result.push(item);
            }
        }
        return result.sort((a, b) => a.from - b.from || a.to - b.to);
    }
}

/**
 * The start of the `count`th diagnostic after (or before) `head`, wrapping
 * around the document like Neovim's `vim.diagnostic.jump()`.
 */
export function diagnosticTarget(
    diagnostics: readonly LanguageDiagnostic[],
    head: number,
    forward: boolean,
    count = 1,
): LanguageDiagnostic | null {
    const starts = diagnostics.filter(
        (item, index) =>
            index === 0 || item.from !== diagnostics[index - 1]!.from,
    );
    if (starts.length === 0) return null;
    let index = -1;
    if (forward) {
        index = starts.findIndex((item) => item.from > head);
    } else {
        for (let i = starts.length - 1; i >= 0 && index === -1; i--) {
            if (starts[i]!.from < head) index = i;
        }
    }
    if (index === -1) index = forward ? 0 : starts.length - 1;
    const steps = Math.max(1, count) - 1;
    const length = starts.length;
    const target = forward
        ? (index + steps) % length
        : (((index - steps) % length) + length) % length;
    return starts[target] ?? null;
}

const headOffset = (cm: CmAdapter): number => cm.cm6.state.selection.main.head;

/** Runs a provider for the cursor, falling back to the existing action. */
export function withLanguageProvider(
    getRegistry: () => LanguageProviderRegistry | null,
    action: LanguageAction,
    fallback: ActionFn,
): ActionFn {
    return (cm, actionArgs, vim) => {
        const view = cm?.cm6;
        const registry = getRegistry();
        if (view && registry?.run(action, view, headOffset(cm))) return;
        fallback(cm, actionArgs, vim);
    };
}

export function createDiagnosticMotion(
    getRegistry: () => LanguageProviderRegistry | null,
    forward: boolean,
): MotionFn {
    return (cm, head, motionArgs) => {
        const view = cm?.cm6;
        const registry = getRegistry();
        if (!view || !registry) return head;
        const doc = view.state.doc;
        const line = doc.line(Math.min(head.line + 1, doc.lines));
        const offset = Math.min(line.from + head.ch, line.to);
        const target = diagnosticTarget(
            registry.diagnostics(view),
            offset,
            forward,
            motionArgs.repeat,
        );
        if (!target) return head;
        const targetLine = doc.lineAt(Math.min(target.from, doc.length));
        const pos: VimPos = {
            line: targetLine.number - 1,
            ch: Math.min(target.from, doc.length) - targetLine.from,
        };
        return pos;
    };
}
