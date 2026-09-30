/**
 * Sign column — shows vim mark letters in a dedicated gutter column
 * using the CM6 gutter() API with GutterMarker + Compartment.
 */

import {
    Compartment,
    RangeSet,
    RangeSetBuilder,
    StateEffect,
    StateField,
    type EditorState,
    type Extension,
} from '@codemirror/state';
import { EditorView, GutterMarker, gutter } from '@codemirror/view';

// ── Constants ────────────────────────────────────────────

const MAX_GUTTER_MARKS = 3;
const DEFAULT_SIGN_WIDTH = 2;
const MAX_SIGN_WIDTH = 4;

// ── Types ────────────────────────────────────────────────

export interface SignEntry {
    pos: number;
    labels: string;
}

export interface ParsedSignColumnMode {
    base: 'auto' | 'yes' | 'no';
    width: number;
}

// ── Mode parsing ─────────────────────────────────────────

const SIGN_COLUMN_RE = /^(auto|yes|no)(?::([1-4]))?$/;

export function parseSignColumnMode(raw: string): ParsedSignColumnMode {
    const m = SIGN_COLUMN_RE.exec(raw);
    if (!m) return { base: 'auto', width: DEFAULT_SIGN_WIDTH };
    return {
        base: m[1] as 'auto' | 'yes' | 'no',
        width: m[2] ? Number(m[2]) : DEFAULT_SIGN_WIDTH,
    };
}

export function isValidSignColumnValue(raw: string): boolean {
    return SIGN_COLUMN_RE.test(raw);
}

// ── GutterMarker ─────────────────────────────────────────

export class SignMarker extends GutterMarker {
    readonly label: string;

    constructor(label: string) {
        super();
        this.label = label;
    }

    toDOM(): HTMLElement {
        const first = this.label[0] ?? '';
        const typeCls =
            first >= 'A' && first <= 'Z'
                ? 'vim-motions-sign-marker-global'
                : 'vim-motions-sign-marker-local';
        return createSpan({
            cls: `vim-motions-sign-marker ${typeCls}`,
            text: this.label,
        });
    }

    eq(other: SignMarker): boolean {
        return this.label === other.label;
    }
}

class SignSpacer extends GutterMarker {
    constructor(private readonly text: string) {
        super();
    }

    toDOM(): HTMLElement {
        return createSpan({
            cls: 'vim-motions-sign-spacer',
            text: this.text,
        });
    }

    eq(other: SignSpacer): boolean {
        return this.text === other.text;
    }
}

// ── StateEffect & StateField ─────────────────────────────

export const setSignsEffect = StateEffect.define<SignEntry[]>();

/**
 * Signs owned by the Neovim backend, kept separate from mark signs because the
 * two sources are recomputed independently: a single effect would mean whichever
 * dispatched last erased the other.
 */
export const setRpcSignsEffect = StateEffect.define<SignEntry[]>();

interface SignColumnState {
    marks: SignEntry[];
    rpc: SignEntry[];
    markers: RangeSet<GutterMarker>;
}

function buildMarkers(
    marks: SignEntry[],
    rpc: SignEntry[],
): RangeSet<GutterMarker> {
    const byPos = new Map<number, string>();
    for (const { pos, labels } of [...marks, ...rpc]) {
        byPos.set(pos, (byPos.get(pos) ?? '') + labels);
    }
    const builder = new RangeSetBuilder<GutterMarker>();
    for (const pos of [...byPos.keys()].sort((a, b) => a - b)) {
        const labels = byPos.get(pos) ?? '';
        const display =
            labels.length > MAX_GUTTER_MARKS
                ? labels.slice(0, MAX_GUTTER_MARKS) + '\u2026'
                : labels;
        builder.add(pos, pos, new SignMarker(display));
    }
    return builder.finish();
}

export const signColumnField = StateField.define<SignColumnState>({
    create() {
        return { marks: [], rpc: [], markers: buildMarkers([], []) };
    },
    update(value, tr) {
        let { marks, rpc } = value;
        let changed = false;
        for (const e of tr.effects) {
            if (e.is(setSignsEffect)) {
                marks = e.value;
                changed = true;
            } else if (e.is(setRpcSignsEffect)) {
                rpc = e.value;
                changed = true;
            }
        }
        if (changed) return { marks, rpc, markers: buildMarkers(marks, rpc) };
        return { marks, rpc, markers: value.markers.map(tr.changes) };
    },
});

/** Merged gutter markers; the field's own shape is an implementation detail. */
export function signMarkers(state: EditorState): RangeSet<GutterMarker> {
    return state.field(signColumnField).markers;
}

// ── Compartment ──────────────────────────────────────────

const signColumnCompartment = new Compartment();

// ── Extension factory ────────────────────────────────────

export function signColumnFieldExtension(): Extension {
    return signColumnField;
}

function createSignColumnGutter(width: number): Extension {
    const spacerText = 'a'.repeat(Math.min(width, MAX_SIGN_WIDTH));
    return gutter({
        class: 'vim-motions-sign-column',
        markers: (v) => signMarkers(v.state),
        initialSpacer() {
            return new SignSpacer(spacerText);
        },
        domEventHandlers: {
            click(view, line) {
                let hasMarker = false;
                signMarkers(view.state).between(line.from, line.from, () => {
                    hasMarker = true;
                });
                if (!hasMarker) return false;
                view.dispatch({
                    selection: { anchor: line.from },
                });
                view.focus();
                return true;
            },
        },
    });
}

// ── Public API ───────────────────────────────────────────

/**
 * Create a configurable sign-column extension.
 * Always register unconditionally — the Compartment handles enable/disable.
 */
export function createSignColumnExtension(raw: string): Extension {
    const mode = parseSignColumnMode(raw);
    return signColumnCompartment.of(
        mode.base === 'no' ? [] : createSignColumnGutter(mode.width),
    );
}

/**
 * Reconfigure the sign-column mode at runtime without full reload.
 */
export function reconfigureSignColumn(view: EditorView, raw: string): void {
    const mode = parseSignColumnMode(raw);
    const ext = mode.base === 'no' ? [] : createSignColumnGutter(mode.width);
    try {
        view.dispatch({ effects: signColumnCompartment.reconfigure(ext) });
    } catch {
        // noop — view may be destroyed or compartment not registered
    }
}
