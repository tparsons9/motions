import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';

import { PAUSE, loadSingleFileWorkspace, sendVimEscape } from '../helpers';

interface ProbeRect {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
}

interface OccludedPoint {
    x: number;
    y: number;
    topEl: string;
}

interface CmdlineOcclusion {
    error: string | null;
    inputValue: string;
    panelRect: ProbeRect | null;
    inputRect: ProbeRect | null;
    statusBarRect: ProbeRect | null;
    textSpan: { start: number; end: number } | null;
    textSpansStatusBarColumns: boolean;
    panelSpansStatusBarRows: boolean;
    occludedCount: number;
    occludedPoints: OccludedPoint[];
}

/**
 * Measures whether the vim ex command line's typed text is painted over by
 * Obsidian's status bar.
 *
 * The assertion is hit-testing rather than geometry: `elementFromPoint` returns
 * the element actually on top at a viewport coordinate, so it reports real
 * occlusion regardless of whether a fix moves the command line, shrinks it, or
 * lifts it above the status bar in paint order.
 */
async function probeCmdlineOcclusion(): Promise<CmdlineOcclusion> {
    return (await browser.executeObsidian(() => {
        const toRect = (el: Element): ProbeRect => {
            const r = el.getBoundingClientRect();
            return {
                left: Math.round(r.left),
                right: Math.round(r.right),
                top: Math.round(r.top),
                bottom: Math.round(r.bottom),
                width: Math.round(r.width),
                height: Math.round(r.height),
            };
        };
        const describe = (el: Element | null): string => {
            if (!el) return 'null';
            const cls =
                typeof el.className === 'string' ? el.className.trim() : '';
            return cls
                ? `${el.tagName.toLowerCase()}.${cls}`
                : el.tagName.toLowerCase();
        };

        const empty: CmdlineOcclusion = {
            error: null,
            inputValue: '',
            panelRect: null,
            inputRect: null,
            statusBarRect: null,
            textSpan: null,
            textSpansStatusBarColumns: false,
            panelSpansStatusBarRows: false,
            occludedCount: 0,
            occludedPoints: [],
        };

        const inputs = Array.from(
            document.querySelectorAll<HTMLInputElement>('.cm-vim-panel input'),
        );
        if (inputs.length === 0) {
            return {
                ...empty,
                error: 'no .cm-vim-panel input in the document',
            };
        }
        const active = document.activeElement;
        const input =
            inputs.find((candidate) => candidate === active) ?? inputs[0];
        if (!input) {
            return { ...empty, error: 'no usable .cm-vim-panel input' };
        }
        const panel = input.closest<HTMLElement>('.cm-vim-panel');
        if (!panel) {
            return {
                ...empty,
                error: 'ex input has no .cm-vim-panel ancestor',
            };
        }
        const statusBar = document.querySelector<HTMLElement>('.status-bar');
        if (!statusBar) {
            return { ...empty, error: 'no .status-bar in the document' };
        }

        const panelRect = toRect(panel);
        const inputRect = toRect(input);
        const statusBarRect = toRect(statusBar);

        const style = window.getComputedStyle(input);
        const font =
            style.font ||
            `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        let textWidth = 0;
        if (ctx) {
            ctx.font = font;
            textWidth = ctx.measureText(input.value).width;
        }

        // The input scrolls once its value overflows, so visible glyphs never
        // extend past the input box; clamp the sampled span to it.
        const paddingLeft = parseFloat(style.paddingLeft) || 0;
        const textStart = inputRect.left + paddingLeft;
        const textEnd = Math.min(textStart + textWidth, inputRect.right - 1);
        const y = inputRect.top + inputRect.height / 2;

        const occludedPoints: OccludedPoint[] = [];
        let occludedCount = 0;
        for (let x = textStart; x <= textEnd; x += 2) {
            const hit = document.elementFromPoint(x, y);
            if (hit && (hit === statusBar || hit.closest('.status-bar'))) {
                occludedCount++;
                if (occludedPoints.length < 8) {
                    occludedPoints.push({
                        x: Math.round(x),
                        y: Math.round(y),
                        topEl: describe(hit),
                    });
                }
            }
        }

        // Anti-vacuity, phrased about the scenario rather than the outcome so
        // the repair cannot satisfy it: both held on the broken build, where
        // this probe measured 32 and 228 occluded points. The first caught the
        // 8-character case passing while its glyphs never reached the bar.
        const textSpansStatusBarColumns =
            textStart < statusBarRect.right && textEnd > statusBarRect.left;
        const panelSpansStatusBarRows =
            panelRect.top < statusBarRect.bottom &&
            panelRect.bottom > statusBarRect.top;

        return {
            error: null,
            inputValue: input.value,
            panelRect,
            inputRect,
            statusBarRect,
            textSpan: {
                start: Math.round(textStart),
                end: Math.round(textEnd),
            },
            textSpansStatusBarColumns,
            panelSpansStatusBarRows,
            occludedCount,
            occludedPoints,
        };
    })) as CmdlineOcclusion;
}

async function openCmdline(text: string): Promise<void> {
    await browser.executeObsidian(({ app, obsidian }) => {
        app.workspace
            .getActiveViewOfType(obsidian.MarkdownView)
            ?.editor.focus();
    });
    await browser.pause(PAUSE.MODE_SWITCH);
    await sendVimEscape();
    await browser.pause(PAUSE.MODE_SWITCH);
    await browser.keys([':']);
    await browser.pause(PAUSE.EDITOR_SETTLE);
    const exInput = await browser.$('.cm-vim-panel input');
    await exInput.waitForExist({ timeout: 5000 });
    await browser.keys(text);
    await browser.pause(PAUSE.EDITOR_SETTLE);
}

async function closeCmdline(): Promise<void> {
    await browser.keys(['Escape']);
    await browser.pause(PAUSE.EDITOR_SETTLE);
    await sendVimEscape();
    await browser.pause(PAUSE.MODE_SWITCH);
}

describe('Ex command line vs. status bar (#194)', function () {
    before(async function () {
        await browser.reloadObsidian({ vault: 'test-vault' });
        await obsidianPage.openFile('Welcome.md');
        await browser.pause(PAUSE.OBSIDIAN_LOAD);
    });

    afterEach(async function () {
        await closeCmdline();
    });

    it('keeps typed text visible in the right-most of three vertical splits', async function () {
        await obsidianPage.loadWorkspaceLayout({
            main: {
                id: 'cmdline-root',
                type: 'split',
                direction: 'vertical',
                children: [
                    {
                        id: 'cmdline-tabs-1',
                        type: 'tabs',
                        dimension: 45,
                        children: [
                            {
                                id: 'cmdline-leaf-1',
                                type: 'leaf',
                                state: {
                                    type: 'markdown',
                                    state: {
                                        file: 'Welcome.md',
                                        mode: 'source',
                                    },
                                },
                            },
                        ],
                    },
                    {
                        id: 'cmdline-tabs-2',
                        type: 'tabs',
                        dimension: 45,
                        children: [
                            {
                                id: 'cmdline-leaf-2',
                                type: 'leaf',
                                state: {
                                    type: 'markdown',
                                    state: {
                                        file: 'Target.md',
                                        mode: 'source',
                                    },
                                },
                            },
                        ],
                    },
                    {
                        id: 'cmdline-tabs-3',
                        type: 'tabs',
                        dimension: 10,
                        children: [
                            {
                                id: 'cmdline-leaf-3',
                                type: 'leaf',
                                state: {
                                    type: 'markdown',
                                    state: {
                                        file: 'Welcome.md',
                                        mode: 'source',
                                    },
                                },
                            },
                        ],
                    },
                ],
            },
            active: 'cmdline-leaf-3',
            lastOpenFiles: [],
        });
        await browser.pause(PAUSE.OBSIDIAN_LOAD);

        await openCmdline('00000000');

        const probe = await probeCmdlineOcclusion();
        expect(probe.error).toBeNull();
        expect(probe.inputValue).toBe('00000000');
        expect(probe.textSpansStatusBarColumns).toBe(true);
        expect(probe.panelSpansStatusBarRows).toBe(true);

        expect({
            occludedCount: probe.occludedCount,
            occludedPoints: probe.occludedPoints,
        }).toEqual({ occludedCount: 0, occludedPoints: [] });
    });

    it('keeps a long command visible in a single full-width pane', async function () {
        await loadSingleFileWorkspace('Welcome.md');
        await browser.pause(PAUSE.OBSIDIAN_LOAD);

        const long = '0'.repeat(300);
        await openCmdline(long);

        const probe = await probeCmdlineOcclusion();
        expect(probe.error).toBeNull();
        expect(probe.inputValue.length).toBe(300);
        expect(probe.textSpansStatusBarColumns).toBe(true);
        expect(probe.panelSpansStatusBarRows).toBe(true);

        expect({
            occludedCount: probe.occludedCount,
            occludedPoints: probe.occludedPoints,
        }).toEqual({ occludedCount: 0, occludedPoints: [] });
    });
});
