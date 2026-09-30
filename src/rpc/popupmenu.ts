import { MarkdownView, type App } from 'obsidian';
import { runCleanups } from '../util/cleanup';
import { getEditorView } from '../util/editor';
import { neovimByteToUtf16 } from './document-sync';
import type { NeovimCmdlineOverlay } from './cmdline';
import type { NeovimRedrawDispatcher } from './redraw';

interface PopupMenuItem {
    word: string;
    kind: string;
    menu: string;
    info: string;
}

interface PopupMenuState {
    items: PopupMenuItem[];
    selected: number;
    row: number;
    column: number;
    grid: number;
}

function finiteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function popupItem(value: unknown): PopupMenuItem | null {
    if (!Array.isArray(value) || value.length < 4) return null;
    if (!value.slice(0, 4).every((part) => typeof part === 'string'))
        return null;
    return {
        word: value[0] as string,
        kind: value[1] as string,
        menu: value[2] as string,
        info: value[3] as string,
    };
}

export class NeovimPopupMenuOverlay {
    private readonly cleanups: (() => void)[];
    private state: PopupMenuState | null = null;
    private element: HTMLElement | null = null;

    constructor(
        private readonly app: App,
        private readonly cmdline: NeovimCmdlineOverlay,
        dispatcher: NeovimRedrawDispatcher,
    ) {
        this.cleanups = [
            dispatcher.on('popupmenu_show', (args) => this.handleShow(args)),
            dispatcher.on('popupmenu_select', (args) =>
                this.handleSelect(args),
            ),
            dispatcher.on('popupmenu_hide', () => this.hide()),
        ];
    }

    dispose(): void {
        runCleanups(this.cleanups, 'Neovim popup-menu handlers');
        this.cleanups.length = 0;
        this.hide();
    }

    /**
     * Re-anchors after the mirror syncs.
     *
     * `popupmenu_show` and the buffer's line and cursor notifications arrive on
     * the same RPC stream with no ordering guarantee, so the CM6 cursor read
     * during the show can still predate the edit that produced the completion:
     * measured 399.5px of horizontal lag on a 45-character line even once the
     * anchor itself was correct. Waiting a frame does not fix it, because the
     * notifications are not guaranteed to have arrived by then either. The
     * document sync calls this after it applies them, which is the point at
     * which the cursor is known to be current.
     */
    reanchor(): void {
        if (!this.state || !this.element) return;
        const markdown = this.app.workspace.getActiveViewOfType(MarkdownView);
        const view = markdown ? getEditorView(markdown) : null;
        if (view) this.position(view);
    }

    private handleShow(value: unknown): void {
        if (!Array.isArray(value) || !Array.isArray(value[0])) return;
        const items = value[0].map(popupItem);
        if (items.some((item) => item === null)) return;
        const selected = finiteNumber(value[1]);
        const row = finiteNumber(value[2]);
        const column = finiteNumber(value[3]);
        const grid = finiteNumber(value[4]);
        if (
            selected === null ||
            row === null ||
            column === null ||
            grid === null
        )
            return;
        this.state = {
            items: items as PopupMenuItem[],
            selected,
            row,
            column,
            grid,
        };
        this.render();
    }

    private handleSelect(value: unknown): void {
        if (!Array.isArray(value) || !this.state) return;
        const selected = finiteNumber(value[0]);
        if (selected === null) return;
        this.state.selected = selected;
        this.renderSelection();
    }

    private hide(): void {
        this.state = null;
        this.element?.remove();
        this.element = null;
    }

    private render(): void {
        const state = this.state;
        if (!state || state.items.length === 0) {
            this.hide();
            return;
        }
        const markdown = this.app.workspace.getActiveViewOfType(MarkdownView);
        const view = markdown ? getEditorView(markdown) : null;
        if (!view) return;
        const document = view.dom.ownerDocument;
        if (!this.element || this.element.ownerDocument !== document) {
            this.element?.remove();
            this.element = document.win.createDiv();
            this.element.className = 'vim-motions-rpc-popupmenu';
        }
        this.element.dataset.grid = String(state.grid);
        this.element.dataset.row = String(state.row);
        this.element.dataset.column = String(state.column);
        this.element.replaceChildren();
        for (const [index, item] of state.items.entries()) {
            const row = document.win.createDiv();
            row.className = 'vim-motions-rpc-popupmenu-item';
            row.dataset.index = String(index);
            row.dataset.word = item.word;
            for (const [name, text] of [
                ['word', item.word],
                ['kind', item.kind],
                ['menu', item.menu],
                ['info', item.info],
            ] as const) {
                const column = document.win.createSpan();
                column.className = `vim-motions-rpc-popupmenu-${name}`;
                column.textContent = text;
                row.appendChild(column);
            }
            this.element.appendChild(row);
        }
        if (this.element.parentElement !== view.dom)
            view.dom.appendChild(this.element);
        this.renderSelection();
        this.position(view);
    }

    private renderSelection(): void {
        const state = this.state;
        if (!this.element || !state) return;
        this.element
            .querySelectorAll<HTMLElement>('.vim-motions-rpc-popupmenu-item')
            .forEach((row) => {
                row.classList.toggle(
                    'is-selected',
                    Number(row.dataset.index) === state.selected,
                );
            });
    }

    private position(
        view: NonNullable<ReturnType<typeof getEditorView>>,
    ): void {
        const state = this.state;
        const element = this.element;
        if (!state || !element) return;
        const viewRect = view.dom.getBoundingClientRect();
        if (state.grid === -1) {
            const cmdline = this.cmdline.getElement();
            if (!cmdline) return;
            const cmdlineRect = cmdline.getBoundingClientRect();
            const cmdlineStyle =
                view.dom.ownerDocument.win.getComputedStyle(cmdline);
            const row = cmdline.querySelector<HTMLElement>(
                '.vim-motions-rpc-cmdline-level:last-of-type',
            );
            const text = row?.textContent ?? '';
            const characterColumn = neovimByteToUtf16(text, state.column);
            element.style.left = `${
                cmdlineRect.left -
                viewRect.left +
                (Number.parseFloat(cmdlineStyle.paddingLeft) || 0) +
                characterColumn * view.defaultCharacterWidth
            }px`;
            element.style.top = `${
                cmdlineRect.top - viewRect.top - element.offsetHeight
            }px`;
            return;
        }
        // Insert completion belongs to the text the cursor sits in, so it is
        // anchored to the cursor's measured position -- the same choice the
        // float bridge makes for `relative = 'cursor'`. The reported row and
        // column are cells on the fixed 120x40 grid, which bears no relation to
        // proportional Markdown typography, wrapping, folds or the scroll
        // offset: measured 806.9px of horizontal drift on a 45-character line.
        // Grid cells remain the fallback for the case where CM6 cannot resolve
        // a cursor rectangle, which is the only situation they are better than.
        const cursor = view.coordsAtPos(view.state.selection.main.head);
        if (cursor) {
            element.style.left = `${cursor.left - viewRect.left}px`;
            element.style.top = `${cursor.bottom - viewRect.top}px`;
            return;
        }
        const scrollerRect = view.scrollDOM.getBoundingClientRect();
        const scrollerStyle = view.dom.ownerDocument.win.getComputedStyle(
            view.scrollDOM,
        );
        element.style.left = `${
            scrollerRect.left -
            viewRect.left +
            (Number.parseFloat(scrollerStyle.paddingLeft) || 0) +
            state.column * view.defaultCharacterWidth
        }px`;
        element.style.top = `${
            scrollerRect.top -
            viewRect.top +
            (Number.parseFloat(scrollerStyle.paddingTop) || 0) +
            (state.row + 1) * view.defaultLineHeight
        }px`;
    }
}
