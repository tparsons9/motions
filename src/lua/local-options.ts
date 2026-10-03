import { Compartment, EditorState, Prec, StateEffect } from '@codemirror/state';
import { indentUnit } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';

const sources = new WeakMap<
    EditorView,
    () => Map<string, unknown> | undefined
>();
export function readLocalOption(
    view: EditorView | undefined,
    name: string,
): unknown {
    return view ? sources.get(view)?.()?.get(name) : undefined;
}

const BEHAVIORAL = new Set(['tabstop', 'shiftwidth', 'expandtab', 'textwidth']);
interface ViewOptions {
    path: string;
    compartment: Compartment;
    revision: number;
}

/** Owns only Lua local overrides; removing the compartment restores host facets. */
export class LocalOptions {
    private values = new Map<string, Map<string, unknown>>();
    private views = new Map<EditorView, ViewOptions>();

    get(path: string, name: string): unknown {
        return this.values.get(path)?.get(name);
    }

    set(path: string, name: string, value: unknown): void {
        if (BEHAVIORAL.has(name)) {
            if (
                name === 'expandtab'
                    ? typeof value !== 'boolean'
                    : typeof value !== 'number' ||
                      !Number.isInteger(value) ||
                      value < (name === 'tabstop' ? 1 : 0)
            ) {
                throw new Error(`Invalid local option ${name}`);
            }
        }
        let options = this.values.get(path);
        if (!options) {
            options = new Map();
            this.values.set(path, options);
        }
        options.set(name, value);
        for (const [view, entry] of this.views)
            if (entry.path === path) this.apply(view, entry);
    }

    attach(view: EditorView, path: string): void {
        const existing = this.views.get(view);
        if (existing?.path === path) return;
        if (existing) this.detach(view);
        const entry = { path, compartment: new Compartment(), revision: 0 };
        this.views.set(view, entry);
        sources.set(view, () => this.values.get(path));
        this.apply(view, entry);
    }

    detach(view: EditorView): void {
        const entry = this.views.get(view);
        if (!entry) return;
        this.views.delete(view);
        sources.delete(view);
        if (entry.compartment.get(view.state) !== undefined) {
            queueMicrotask(() => {
                if (view.dom.isConnected)
                    view.dispatch({
                        effects: entry.compartment.reconfigure([]),
                    });
            });
        }
    }

    release(path: string): void {
        for (const [view, entry] of this.views)
            if (entry.path === path) this.detach(view);
        this.values.delete(path);
    }

    clear(): void {
        for (const view of this.views.keys()) this.detach(view);
        this.values.clear();
    }

    private apply(view: EditorView, entry: ViewOptions): void {
        const revision = ++entry.revision;
        // FileType may run during a CM update. Never dispatch reentrantly.
        queueMicrotask(() => {
            if (
                !view.dom.isConnected ||
                this.views.get(view) !== entry ||
                revision !== entry.revision
            )
                return;
            const options = this.values.get(entry.path);
            const tabstop = options?.get('tabstop');
            const shiftwidth = options?.get('shiftwidth');
            const expandtab = options?.get('expandtab');
            const size =
                typeof shiftwidth === 'number' && shiftwidth > 0
                    ? shiftwidth
                    : typeof tabstop === 'number'
                      ? tabstop
                      : view.state.tabSize;
            const extension = [];
            if (typeof tabstop === 'number')
                extension.push(EditorState.tabSize.of(tabstop));
            if (expandtab !== undefined || shiftwidth !== undefined)
                extension.push(
                    indentUnit.of(
                        (expandtab ?? view.state.facet(indentUnit) !== '\t')
                            ? ' '.repeat(size)
                            : '\t',
                    ),
                );
            const configuration = Prec.high(extension);
            view.dispatch({
                effects:
                    entry.compartment.get(view.state) === undefined
                        ? StateEffect.appendConfig.of(
                              entry.compartment.of(configuration),
                          )
                        : entry.compartment.reconfigure(configuration),
            });
        });
    }
}
