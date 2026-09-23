import type { EditorView } from '@codemirror/view';
import type { Node } from 'web-tree-sitter';
import { getTreeForView } from './tree-state';
import type { InlineNodeRange } from './runtime';

export type { InlineNodeRange };

export function getRootNode(view: EditorView): Node | null {
    return getTreeForView(view)?.rootNode ?? null;
}

export function getNodeAtPosition(
    view: EditorView,
    row: number,
    col: number,
): Node | null {
    const root = getRootNode(view);
    if (!root) return null;
    return root.descendantForPosition({ row, column: col });
}

export function hasAncestorOfType(node: Node, type: string): boolean {
    // A cursor cannot replace this walk: `node.walk()` is rooted at that node,
    // so `gotoParent()` returns false immediately and the ancestor is never
    // reached. The chain is also the low-risk shape -- each step allocates a
    // node and reads it straight away, rather than retaining several across
    // later allocations, which is what corrupted the heading walk.
    let current: Node | null = node.parent;
    while (current) {
        if (current.type === type) return true;
        current = current.parent;
    }
    return false;
}

export function findAncestorOfType(node: Node, type: string): Node | null {
    let current: Node | null = node.parent;
    while (current) {
        if (current.type === type) return current;
        current = current.parent;
    }
    return null;
}

export function findContainingNodeOfType(
    view: EditorView,
    row: number,
    col: number,
    type: string,
): Node | null {
    const node = getNodeAtPosition(view, row, col);
    if (!node) return null;
    if (node.type === type) return node;
    return findAncestorOfType(node, type);
}

/**
 * Plain data, extracted during the walk. A `Node` is a JavaScript object holding
 * an address into WASM linear memory, and any parse that grows that memory
 * replaces the backing buffer and leaves retained nodes pointing into a detached
 * one. Collecting nodes and reading them afterwards -- which is what this used
 * to do -- segfaulted the renderer: measured 8 of 16 runs against 0 of 16 with
 * the read removed. `TreeCursor` navigates in place and exposes types and
 * positions without allocating a node, so nothing survives to go stale.
 */
export interface NodeSummary {
    readonly type: string;
    readonly startRow: number;
    readonly startColumn: number;
    readonly endRow: number;
    readonly endColumn: number;
    readonly childTypes: readonly string[];
}

type Cursor = ReturnType<Node['walk']>;

function summariseAtCursor(cursor: Cursor): NodeSummary {
    const type = cursor.nodeType;
    const start = cursor.startPosition;
    const end = cursor.endPosition;
    const childTypes: string[] = [];
    if (cursor.gotoFirstChild()) {
        do {
            childTypes.push(cursor.nodeType);
        } while (cursor.gotoNextSibling());
        cursor.gotoParent();
    }
    return {
        type,
        startRow: start.row,
        startColumn: start.column,
        endRow: end.row,
        endColumn: end.column,
        childTypes,
    };
}

function collectSummaries(
    cursor: Cursor,
    types: string[],
    results: NodeSummary[],
): void {
    if (types.includes(cursor.nodeType))
        results.push(summariseAtCursor(cursor));
    if (!cursor.gotoFirstChild()) return;
    do {
        collectSummaries(cursor, types, results);
    } while (cursor.gotoNextSibling());
    cursor.gotoParent();
}

export function getNodeSummariesOfType(
    view: EditorView,
    type: string | string[],
): NodeSummary[] {
    const root = getRootNode(view);
    if (!root) return [];
    const types = Array.isArray(type) ? type : [type];
    const results: NodeSummary[] = [];
    const cursor = root.walk();
    try {
        if (cursor.gotoFirstChild()) {
            do {
                collectSummaries(cursor, types, results);
            } while (cursor.gotoNextSibling());
        }
    } finally {
        cursor.delete();
    }
    return results;
}

let _runtimeModule: typeof import('./runtime') | null = null;

export function setJsApiModules(runtime: typeof import('./runtime')): void {
    _runtimeModule = runtime;
}

export function isTreeAvailable(view: EditorView): boolean {
    return getTreeForView(view) !== null;
}

export function findContainingInlineNodeOfType(
    view: EditorView,
    row: number,
    col: number,
    type: string,
    accept?: (range: InlineNodeRange) => boolean,
): InlineNodeRange | null {
    const tree = getTreeForView(view);
    if (!tree || !_runtimeModule) return null;
    const docText = view.state.doc.toString();
    return _runtimeModule.findInlineNodeRange(
        tree,
        docText,
        row,
        col,
        type,
        accept,
    );
}

export function isInsideInlineNodeType(
    view: EditorView,
    row: number,
    col: number,
    type: string,
): boolean {
    return findContainingInlineNodeOfType(view, row, col, type) !== null;
}
