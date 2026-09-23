const VIM_PANEL_CLASS = 'cm-vim-panel';

function isVimPanel(node: Node): node is HTMLElement {
    return (node as HTMLElement).classList?.contains(VIM_PANEL_CLASS) === true;
}

function applyStatusBarClearance(panel: HTMLElement): void {
    const statusBar = panel.doc.querySelector<HTMLElement>('.status-bar');
    if (!statusBar) return;

    const panelRect = panel.getBoundingClientRect();
    const barRect = statusBar.getBoundingClientRect();
    if (panelRect.right <= barRect.left || panelRect.left >= barRect.right) {
        return;
    }
    const overlap = panelRect.bottom - barRect.top;
    if (overlap <= 0) return;

    panel.style.paddingBottom = `${Math.ceil(overlap)}px`;
}

/**
 * Lifts the vim command line clear of Obsidian's status bar.
 *
 * The command line is a CodeMirror bottom panel, so it is a descendant of
 * `.workspace-leaf`, which Obsidian gives `contain: strict !important` and
 * `isolation: isolate`. Both force a stacking context, so no `z-index` inside
 * an editor can reach past the status bar's fixed `--layer-status-bar`. The
 * overlap has to be removed geometrically instead: padding the panel keeps its
 * bottom edge anchored while moving the input up out from under the bar.
 */
export class ExPanelClearance {
    private observer: MutationObserver | null = null;

    attach(container: HTMLElement): void {
        this.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of Array.from(mutation.addedNodes)) {
                    if (isVimPanel(node)) applyStatusBarClearance(node);
                }
            }
        });
        this.observer.observe(container, { childList: true, subtree: true });
    }

    destroy(): void {
        this.observer?.disconnect();
        this.observer = null;
    }
}
