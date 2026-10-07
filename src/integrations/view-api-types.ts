/**
 * Contract with Vim Motions' view API (window.VimMotions.view, apiVersion 1).
 * Canonical host contract for this fork.
 *
 * A host plugin with a non-editor view (ZotFlow's reader) registers a scope
 * with modes, default mappings and named actions. Motions owns routing
 * (counts, sequences, timeouts, user Lua overrides), which-key and the
 * status-bar mode; the host owns what the actions do.
 */

export interface MotionsViewMapping {
    modes: string[];
    lhs: string;
    /** A registered action id. */
    action: string;
    args?: Record<string, unknown>;
    desc?: string;
    /** CSS color for a which-key swatch, e.g. "rgb(var(--zf-anno-red))". */
    color?: string;
    /** Longer text shown when which-key details are expanded with "?". */
    detail?: string;
    icon?: string;
}

export interface MotionsViewGroup {
    modes: string[];
    lhs: string;
    label: string;
    color?: string;
    detail?: string;
    icon?: string;
}

export interface MotionsViewMode {
    id: string;
    /** Status-bar label, e.g. "READING". */
    label: string;
    /** "immediate" opens which-key as soon as the mode starts (label menus). */
    whichKey?: 'delayed' | 'immediate';
    /** Digits are keys, not counts, in this mode. */
    noCount?: boolean;
    /** Sequences wait for the next key indefinitely. */
    noTimeout?: boolean;
    /** Disable global fallback in temporary modes such as label pickers. */
    fallthroughGlobal?: boolean;
}

export interface MotionsViewScopeDef {
    /** Scope id, e.g. "zotflow.reader". Lua refers to it by this id. */
    id: string;
    /** Human name shown in which-key titles. */
    name: string;
    modes: MotionsViewMode[];
    defaultMode: string;
    mappings: MotionsViewMapping[];
    groups?: MotionsViewGroup[];
    /** Unmatched keys fall through to Motions' global mappings (<C-w>, leader). */
    fallthroughGlobal?: boolean;
}

export interface MotionsActionContext {
    count: number;
    mode: string;
    keys: string[];
    scope: string;
    instance: MotionsViewInstance | null;
}

export interface MotionsViewActionDef {
    id: string;
    desc: string;
    run(args: Record<string, unknown>, ctx: MotionsActionContext): void;
}

export type MotionsRouteResult = 'consumed' | 'pending' | 'unhandled';

export interface MotionsViewInstance {
    /** Route one key in vim notation ("j", "<C-d>", "<Esc>"). Synchronous. */
    handleKey(token: string): MotionsRouteResult;
    /** Switch mode; also drives the status-bar mode while focused. */
    setMode(mode: string, label?: string): void;
    readonly mode: string;
    /** Replace a dynamic layer (e.g. "labels" from the active profile). */
    setLayer(
        name: string,
        mappings: MotionsViewMapping[],
        groups?: MotionsViewGroup[],
    ): void;
    /** Clear a pending sequence and hide which-key. */
    cancel(): void;
    /** Tell Motions whether this view has keyboard focus (status bar, which-key). */
    setFocused(focused: boolean): void;
    detach(): void;
}

export interface MotionsViewScope {
    attach(options: {
        containerEl: HTMLElement;
        isFocused(): boolean;
    }): MotionsViewInstance;
    dispose(): void;
}

export interface MotionsBufferContext {
    [key: string]: unknown;
}

export interface MotionsViewApi {
    apiVersion: 1;
    registerScope(def: MotionsViewScopeDef): MotionsViewScope;
    registerAction(def: MotionsViewActionDef): () => void;
    runAction(id: string, args?: Record<string, unknown>): Promise<unknown>;
    /**
     * Expose host context for a note to Lua as `vim.ob.context(name)`, e.g. ZotFlow source-note metadata.
     */
    registerBufferContext(
        name: string,
        resolve: (path: string) => MotionsBufferContext | null,
    ): () => void;
    /** The configured <leader>, as a key ("<Space>" or a character). */
    getLeaderKey(): string;
}
