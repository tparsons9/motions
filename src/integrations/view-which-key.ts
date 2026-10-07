import { resolveIconColor, sortWhichKeyEntries } from '../ui/which-key';
import { displayToken } from './view-keys';
import type { Completion } from './view-router';

export class ViewWhichKey {
    private el: HTMLElement;
    private timer: number | undefined;
    private details = false;
    constructor(container: HTMLElement) {
        this.el = container.createDiv({
            cls: 'vim-motions-which-key vim-motions-view-which-key',
        });
        this.el.hidden = true;
    }
    toggleDetails(): void {
        this.details = !this.details;
        this.el.toggleClass('show-details', this.details);
    }
    show(
        title: string,
        entries: Completion[],
        delay: number,
        order: 'which-key' | 'groups-first',
    ): void {
        if (this.timer) window.clearTimeout(this.timer);
        const draw = () => {
            this.el.empty();
            this.el.hidden = !entries.length;
            this.el.createDiv({
                cls: 'vim-motions-which-key-title',
                text: title,
            });
            const grid = this.el.createDiv('vim-motions-which-key-grid');
            const sorted = sortWhichKeyEntries(
                entries.map((e) => ({
                    key: e.key,
                    description: e.desc,
                    group: e.isGroup,
                    color: e.color,
                    icon: e.icon,
                })),
                order,
            );
            for (const entry of sorted) {
                const source = entries.find((e) => e.key === entry.key);
                const row = grid.createDiv('vim-motions-which-key-entry');
                const key = row.createSpan({
                    cls: 'vim-motions-which-key-key',
                    text: displayToken(entry.key),
                });
                if (entry.color) {
                    key.addClass('vim-motions-view-swatch');
                    key.style.setProperty(
                        '--vim-view-swatch',
                        resolveIconColor(entry.color),
                    );
                }
                row.createSpan({
                    cls: 'vim-motions-which-key-description',
                    text: entry.description,
                });
                if (source?.detail)
                    row.createDiv({
                        cls: 'vim-motions-view-detail',
                        text: source.detail,
                    });
            }
            if (entries.some((e) => e.detail))
                this.el.createDiv({
                    cls: 'vim-motions-which-key-title',
                    text: '? descriptions',
                });
        };
        if (delay <= 0 || !this.el.hidden) draw();
        else this.timer = window.setTimeout(draw, delay);
    }
    hide(): void {
        if (this.timer) window.clearTimeout(this.timer);
        this.timer = undefined;
        this.el.hidden = true;
    }
    destroy(): void {
        this.hide();
        this.el.remove();
    }
}
