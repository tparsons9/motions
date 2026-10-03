import type { EditorView } from '@codemirror/view';
import type { ExternalEditorEntry } from '../integrations/external-editors';

/** Scoped callbacks never change physical focus or the active mapping overlay. */
export class LuaEditorContext {
    private scoped: ExternalEditorEntry | null = null;
    constructor(
        private readonly entries: () => ExternalEditorEntry[],
        private readonly fallback: () => ExternalEditorEntry | null,
    ) {}

    current(): ExternalEditorEntry | null {
        return (
            this.scoped ??
            this.entries().find((entry) => entry.view.hasFocus) ??
            this.fallback()
        );
    }

    withEntry<T>(entry: ExternalEditorEntry, callback: () => T): T {
        const previous = this.scoped;
        this.scoped = entry;
        try {
            return callback();
        } finally {
            this.scoped = previous;
        }
    }

    withPath<T>(path: string, callback: () => T): T {
        const entry = this.entries().find(
            (candidate) => candidate.host.path === path,
        );
        return entry ? this.withEntry(entry, callback) : callback();
    }

    withView<T>(view: EditorView, callback: () => T): T {
        const entry = this.entries().find(
            (candidate) => candidate.view === view,
        );
        return entry ? this.withEntry(entry, callback) : callback();
    }
}
