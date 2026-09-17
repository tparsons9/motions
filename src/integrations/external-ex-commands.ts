import { Notice } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import type { CmAdapter } from '../types/vim-api';
import type { ExternalEditorEntry } from './external-editors';

/** Finds the host of an editor another plugin attached Vim to. */
export type ExternalEditorLookup = (
    view: EditorView,
) => ExternalEditorEntry | null;

interface WriteEvents {
    fire(event: string, data: { file: string }): void;
}

export function externalEditorFor(
    cm: CmAdapter | undefined,
    lookup: ExternalEditorLookup | undefined,
): ExternalEditorEntry | null {
    const view = cm?.cm6;
    return view && lookup ? lookup(view) : null;
}

/**
 * Saves through the host plugin, firing the same write autocommands as a
 * vault save. Resolves to whether the save succeeded.
 */
export async function saveExternalEditor(
    entry: ExternalEditorEntry,
    events?: WriteEvents,
): Promise<boolean> {
    const { host } = entry;
    if (!host.save) {
        new Notice(`Vim Motions: ${host.path} cannot be written from Vim.`);
        return false;
    }
    events?.fire('BufWritePre', { file: host.path });
    try {
        await host.save();
    } catch (error) {
        new Notice(
            `Vim Motions: could not write ${host.path}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
    }
    events?.fire('BufWritePost', { file: host.path });
    return true;
}

/**
 * Closes through the host plugin. Returns false when the host has no close
 * handler, so the caller can decide what to do instead; a handler that throws
 * is reported rather than escaping as an unhandled rejection.
 */
export function closeExternalEditor(entry: ExternalEditorEntry): boolean {
    if (!entry.host.close) return false;
    try {
        entry.host.close();
    } catch (error) {
        new Notice(
            `Vim Motions: could not close ${entry.host.path}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    return true;
}

/** Whether `entry`'s editor lives inside `leaf`'s DOM. */
export function isInLeaf(
    entry: ExternalEditorEntry,
    container: HTMLElement | null | undefined,
): boolean {
    return !!container && container.contains(entry.view.dom);
}
