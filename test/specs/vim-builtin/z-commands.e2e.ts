import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import {
    setupEditor,
    vimKeys,
    getCursorPos,
    sendVimEscape,
    ensureLivePreview,
    ensureSourceMode,
    setPluginSettingAndReload,
    PAUSE,
} from '../../helpers';

interface WrapGeometry {
    viewportHeight: number;
    lineHeight: number;
    /** Cursor's display row, relative to the top of the scroll viewport. */
    cursorTop: number;
    cursorBottom: number;
    /** First/last display row of the cursor's logical line, viewport-relative. */
    blockTop: number;
    blockBottom: number;
}

async function getWrapGeometry(): Promise<WrapGeometry | null> {
    return (await browser.executeObsidian(({ app, obsidian }) => {
        const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        if (!view) return null;
        const cm = (view.editor as unknown as Record<string, unknown>).cm as
            import('@codemirror/view').EditorView | undefined;
        if (!cm) return null;
        const head = cm.state.selection.main.head;
        const line = cm.state.doc.lineAt(head);
        const cursorCoords = cm.coordsAtPos(head);
        const startCoords = cm.coordsAtPos(line.from);
        const endCoords = cm.coordsAtPos(line.to);
        if (!cursorCoords || !startCoords || !endCoords) return null;
        const rect = cm.scrollDOM.getBoundingClientRect();
        return {
            viewportHeight: rect.height,
            lineHeight: cm.defaultLineHeight || 22,
            cursorTop: cursorCoords.top - rect.top,
            cursorBottom: cursorCoords.bottom - rect.top,
            blockTop: startCoords.top - rect.top,
            blockBottom: endCoords.bottom - rect.top,
        };
    })) as WrapGeometry | null;
}

async function getScrollTop(): Promise<number> {
    return (await browser.executeObsidian(({ app, obsidian }) => {
        const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        if (!view) return -1;
        const cm6 = (view.editor as unknown as Record<string, unknown>).cm as
            { scrollDOM: HTMLElement } | undefined;
        return cm6?.scrollDOM.scrollTop ?? -1;
    })) as number;
}

describe('Normal mode — z-prefix commands (Tier 1)', function () {
    before(async function () {
        await browser.reloadObsidian({ vault: 'test-vault' });
        await obsidianPage.openFile('Welcome.md');
    });

    afterEach(async function () {
        await sendVimEscape();
        await browser.pause(50);
    });

    describe('zz / zt / zb (scroll cursor to screen position)', function () {
        it('zz/zt/zb should produce distinct scroll positions in correct order', async function () {
            const lines = Array.from(
                { length: 200 },
                (_, i) => `line ${i + 1}`,
            ).join('\n');
            await setupEditor(lines, { line: 100, ch: 0 });

            await vimKeys('z', 'b');
            await browser.pause(100);
            const scrollZb = await getScrollTop();
            expect((await getCursorPos()).line).toBe(100);

            await vimKeys('z', 'z');
            await browser.pause(100);
            const scrollZz = await getScrollTop();
            expect((await getCursorPos()).line).toBe(100);

            await vimKeys('z', 't');
            await browser.pause(100);
            const scrollZt = await getScrollTop();
            expect((await getCursorPos()).line).toBe(100);

            expect(scrollZb).toBeLessThan(scrollZz);
            expect(scrollZz).toBeLessThan(scrollZt);
        });
    });

    describe('zz / zt / zb with visible frontmatter properties (#143)', function () {
        /**
         * When YAML frontmatter properties are rendered in Live Preview,
         * the .metadata-container occupies space inside scrollDOM but above
         * contentDOM. The scrollToCursor action uses charCoords (relative to
         * contentDOM) for the scroll target but scrollTo (which operates on
         * scrollDOM). Without adjusting for the metadata offset, zt/zz/zb
         * scroll to wrong positions — zt acts like zz, zz overshoots, etc.
         */

        const FRONTMATTER_PROPS = Array.from(
            { length: 15 },
            (_, i) => `prop${i + 1}: value${i + 1}`,
        );

        const BODY_LINES = Array.from(
            { length: 200 },
            (_, i) => `line ${i + 1}`,
        );

        const CONTENT_WITH_FM = [
            '---',
            ...FRONTMATTER_PROPS,
            '---',
            '',
            ...BODY_LINES,
        ].join('\n');

        before(async function () {
            await ensureLivePreview();
            await browser.pause(PAUSE.EDITOR_SETTLE);
        });

        it('zz/zt/zb should produce distinct scroll positions with frontmatter visible', async function () {
            // Line 100 in body = line ~118 in document (17 frontmatter lines + 1 blank)
            await setupEditor(CONTENT_WITH_FM, { line: 118, ch: 0 });
            await browser.pause(PAUSE.EDITOR_SETTLE);

            await vimKeys('z', 'b');
            await browser.pause(100);
            const scrollZb = await getScrollTop();
            expect((await getCursorPos()).line).toBe(118);

            await vimKeys('z', 'z');
            await browser.pause(100);
            const scrollZz = await getScrollTop();
            expect((await getCursorPos()).line).toBe(118);

            await vimKeys('z', 't');
            await browser.pause(100);
            const scrollZt = await getScrollTop();
            expect((await getCursorPos()).line).toBe(118);

            // Core invariant: zb < zz < zt (scroll positions must be distinct
            // and in correct order even when frontmatter is visible)
            expect(scrollZb).toBeLessThan(scrollZz);
            expect(scrollZz).toBeLessThan(scrollZt);
        });

        /**
         * Both assertions below are expressed in display rows against the
         * *measured* viewport and the *configured* `scrolloff`. Their previous
         * forms — "within the top 15% of the viewport" and "zt and zz differ
         * by more than 30% of the viewport" — encoded a `zt` that put the line
         * flush at row 0, which stopped being true once `zt` started holding
         * the `scrolloff` margin. Both passed on a 54-row window and on CI's
         * 37-row Linux runner, and both failed on its ~25-row macOS and
         * ~27-row Windows runners, at 0.202 and 161px respectively.
         */
        interface CursorLineGeometry {
            rowsFromTop: number;
            viewportRows: number;
            lineHeight: number;
            marginRows: number;
        }

        async function cursorLineGeometry(): Promise<CursorLineGeometry | null> {
            return (await browser.executeObsidian(({ app, obsidian }) => {
                const view = app.workspace.getActiveViewOfType(
                    obsidian.MarkdownView,
                );
                if (!view) return null;
                const cm = (view.editor as unknown as Record<string, unknown>)
                    .cm as import('@codemirror/view').EditorView | undefined;
                if (!cm) return null;
                const cursorLine = view.editor.getCursor().line;
                const coords = cm.coordsAtPos(
                    cm.state.doc.line(cursorLine + 1).from,
                );
                if (!coords) return null;
                const plugin = (
                    app as unknown as {
                        plugins: {
                            plugins: Record<
                                string,
                                { settings: { scrolloffLines: number } }
                            >;
                        };
                    }
                ).plugins.plugins['vim-motions'];
                const scrolloff = plugin?.settings.scrolloffLines ?? 0;
                const lineHeight = cm.defaultLineHeight || 22;
                const viewportRows = cm.scrollDOM.clientHeight / lineHeight;
                const rect = cm.scrollDOM.getBoundingClientRect();
                return {
                    rowsFromTop: (coords.top - rect.top) / lineHeight,
                    viewportRows,
                    lineHeight,
                    // The fork clamps an oversized margin to half the window.
                    marginRows: Math.min(
                        scrolloff,
                        Math.max(0, (viewportRows - 1) / 2),
                    ),
                };
            })) as CursorLineGeometry | null;
        }

        it('zt should place cursor line near the top of viewport, not center (#143)', async function () {
            await setupEditor(CONTENT_WITH_FM, { line: 118, ch: 0 });
            await browser.pause(PAUSE.EDITOR_SETTLE);

            await vimKeys('z', 't');
            await browser.pause(100);
            const geo = await cursorLineGeometry();
            const scrollAfterZt = await getScrollTop();

            await vimKeys('z', 'z');
            await browser.pause(100);
            const scrollAfterZz = await getScrollTop();

            expect(geo).not.toBeNull();
            // `zz` centres the line and `zt` leaves the margin above it, so the
            // gap is half the viewport less that margin. Derived from those two
            // Vim statements rather than from the fork's pixel formula, which
            // is why the tolerance is a whole two rows.
            const gapRows = (scrollAfterZt - scrollAfterZz) / geo!.lineHeight;
            const expectedGapRows = geo!.viewportRows / 2 - geo!.marginRows;
            expect(Math.abs(gapRows - expectedGapRows)).toBeLessThanOrEqual(2);
        });

        it('zt should place cursor line at the scrolloff margin, not the centre (#143)', async function () {
            await setupEditor(CONTENT_WITH_FM, { line: 118, ch: 0 });
            await browser.pause(PAUSE.EDITOR_SETTLE);

            await vimKeys('z', 't');
            await browser.pause(100);

            const geo = await cursorLineGeometry();
            expect(geo).not.toBeNull();
            expect(geo!.rowsFromTop).toBeGreaterThanOrEqual(0);
            expect(
                Math.abs(geo!.rowsFromTop - geo!.marginRows),
            ).toBeLessThanOrEqual(1);
        });
    });

    describe('zz on wrapped lines (#183)', function () {
        /**
         * Reference behaviour measured against Neovim 0.12.5 (`nvim -u NONE`,
         * 80x22 window, wrap on, scrolloff=0, smoothscroll off), cursor on the
         * final character of a single long line:
         *
         *   3 display rows  -> topline 12, skipcol 0    (3 rows below 9 above)
         *   15 display rows -> topline 18, skipcol 0    (15 rows below 3 above)
         *   38 display rows -> topline 21, skipcol 1280 (16 rows scrolled into)
         *
         * So `zz` centres the *whole* wrapped line rather than its first
         * display row, and once the line is taller than the window Vim scrolls
         * inside the line so the cursor stays on screen.
         */

        const FILLER = Array.from({ length: 120 }, (_, i) => `line ${i + 1}`);
        const LONG_LINE_INDEX = FILLER.length;
        const WORD = 'wrapped ';

        function docWith(longLine: string): string {
            return [...FILLER, longLine, ...FILLER].join('\n');
        }

        function lineOfRows(rows: number): string {
            return WORD.repeat(
                Math.ceil((charsPerRow * rows) / WORD.length),
            ).trim();
        }

        async function placeCursorAtEndOfLongLine(
            longLine: string,
        ): Promise<void> {
            await setupEditor(docWith(longLine), {
                line: LONG_LINE_INDEX,
                ch: longLine.length - 1,
            });
            await browser.pause(PAUSE.EDITOR_SETTLE);
        }

        let charsPerRow = 0;
        let viewportRows = 0;

        before(async function () {
            await ensureSourceMode();
            await browser.pause(PAUSE.EDITOR_SETTLE);

            const probe = WORD.repeat(250).trim();
            await placeCursorAtEndOfLongLine(probe);
            const geo = await getWrapGeometry();
            expect(geo).not.toBeNull();

            const probeRows = Math.round(
                (geo!.blockBottom - geo!.blockTop) / geo!.lineHeight,
            );
            expect(probeRows).toBeGreaterThan(1);
            charsPerRow = probe.length / probeRows;
            viewportRows = Math.floor(geo!.viewportHeight / geo!.lineHeight);
            expect(viewportRows).toBeGreaterThan(12);
        });

        it('zz should keep the cursor on screen when the line is taller than the viewport (#183)', async function () {
            await placeCursorAtEndOfLongLine(lineOfRows(viewportRows * 3));

            await vimKeys('z', 'z');
            await browser.pause(200);

            const geo = await getWrapGeometry();
            expect(geo).not.toBeNull();
            expect(geo!.blockBottom - geo!.blockTop).toBeGreaterThan(
                geo!.viewportHeight,
            );

            expect(geo!.cursorTop).toBeGreaterThanOrEqual(-1);
            expect(geo!.cursorBottom).toBeLessThanOrEqual(
                geo!.viewportHeight + 1,
            );
            expect(geo!.cursorBottom).toBeGreaterThan(
                geo!.viewportHeight - 2 * geo!.lineHeight,
            );
        });

        it('zz should centre the whole wrapped line, not its first display row (#183)', async function () {
            const rows = Math.max(6, Math.floor(viewportRows / 3));
            await placeCursorAtEndOfLongLine(lineOfRows(rows));

            await vimKeys('z', 'z');
            await browser.pause(200);

            const geo = await getWrapGeometry();
            expect(geo).not.toBeNull();
            const blockHeight = geo!.blockBottom - geo!.blockTop;
            expect(
                Math.round(blockHeight / geo!.lineHeight),
            ).toBeGreaterThanOrEqual(6);
            expect(blockHeight).toBeLessThan(
                geo!.viewportHeight - 4 * geo!.lineHeight,
            );

            const gapAbove = geo!.blockTop;
            const gapBelow = geo!.viewportHeight - geo!.blockBottom;
            expect(Math.abs(gapAbove - gapBelow)).toBeLessThanOrEqual(
                1.5 * geo!.lineHeight,
            );
        });

        /**
         * Measured against Neovim 0.12.5 (`nvim --clean`, 80x23 window, wrap
         * on, scrolloff 0, smoothscroll off) on one 11-display-row line:
         *
         *   cursor at line start  -> topline 35, skipcol 0, winline  7
         *   cursor at line middle -> topline 35, skipcol 0, winline 12
         *   cursor at line end    -> topline 35, skipcol 0, winline 17
         *
         * The viewport is identical in all three; only the cursor's row inside
         * it moves. `zz` positions the window from the buffer line alone and
         * never from the cursor's display row (Vim's `scroll_cursor_halfway`
         * works in whole-line heights). The #183 follow-up comment reports
         * this as a regression — it is not, and must not be "fixed" away.
         */
        it('zz scroll position must not depend on the cursor column within a wrapped line (#183)', async function () {
            const long = lineOfRows(Math.max(6, Math.floor(viewportRows / 3)));
            const columns = [0, Math.floor(long.length / 2), long.length - 1];
            const samples: {
                scrollTop: number;
                cursorRowInLine: number;
                blockRows: number;
            }[] = [];

            for (const ch of columns) {
                await setupEditor(docWith(long), {
                    line: LONG_LINE_INDEX,
                    ch,
                });
                await browser.pause(PAUSE.EDITOR_SETTLE);
                await vimKeys('z', 'z');
                await browser.pause(200);

                const geo = await getWrapGeometry();
                expect(geo).not.toBeNull();
                if (!geo) return;
                samples.push({
                    scrollTop: await getScrollTop(),
                    // Measured from the line's own first row, so this stays
                    // true whatever the scroll position under test turns out
                    // to be.
                    cursorRowInLine: Math.round(
                        (geo.cursorBottom - geo.blockTop) / geo.lineHeight,
                    ),
                    blockRows: Math.round(
                        (geo.blockBottom - geo.blockTop) / geo.lineHeight,
                    ),
                });
            }

            const [atStart, atMiddle, atEnd] = samples;
            if (!atStart || !atMiddle || !atEnd) {
                throw new Error(`expected 3 samples, got ${samples.length}`);
            }

            // Preconditions: the line really wraps, really fits the viewport,
            // and the three columns really land on different display rows —
            // otherwise the equality below would hold vacuously.
            expect(atStart.blockRows).toBeGreaterThanOrEqual(6);
            expect(atStart.blockRows).toBeLessThan(Math.floor(viewportRows));
            expect(atEnd.cursorRowInLine - atStart.cursorRowInLine).toBe(
                atStart.blockRows - 1,
            );
            expect(atStart.scrollTop).toBeGreaterThan(0);

            expect(atMiddle.scrollTop).toBe(atStart.scrollTop);
            expect(atEnd.scrollTop).toBe(atStart.scrollTop);
        });

        /**
         * Neovim 0.12.5, same window, cursor on the final character of a line
         * taller than the window:
         *
         *   24 display rows -> skipcol   80 ( 1 row into the line), winline 23
         *   30 display rows -> skipcol  560 ( 7 rows into the line), winline 23
         *   60 display rows -> skipcol 2960 (37 rows into the line), winline 23
         *
         * winline 23 of a 23-row window is the *last* row: Vim scrolls inside
         * the line by exactly enough to keep the cursor on screen, which puts
         * the cursor at the bottom. That is the placement the #183 follow-up
         * comment reports as wrong; it is what Vim does.
         */
        it('zz puts the cursor on the last visible row when the line is taller than the viewport (#183)', async function () {
            await placeCursorAtEndOfLongLine(
                lineOfRows(Math.floor(viewportRows) * 2),
            );

            await vimKeys('z', 'z');
            await browser.pause(200);

            const geo = await getWrapGeometry();
            expect(geo).not.toBeNull();
            expect(geo!.blockBottom - geo!.blockTop).toBeGreaterThan(
                geo!.viewportHeight,
            );

            // Not Math.round(): a sub-pixel overshoot makes it return -0, and
            // expect(-0).toBe(0) fails Object.is. CI hit exactly that while
            // this machine measured a clean 0. `< 0.5` is the same row-0
            // statement without the sign.
            const rowsBelowCursor =
                (geo!.viewportHeight - geo!.cursorBottom) / geo!.lineHeight;
            expect(Math.abs(rowsBelowCursor)).toBeLessThan(0.5);
        });

        it('zz should still centre a short unwrapped line', async function () {
            await setupEditor(docWith('short line'), {
                line: LONG_LINE_INDEX,
                ch: 0,
            });
            await browser.pause(PAUSE.EDITOR_SETTLE);

            await vimKeys('z', 'z');
            await browser.pause(200);

            const geo = await getWrapGeometry();
            expect(geo).not.toBeNull();
            expect(geo!.blockBottom - geo!.blockTop).toBeLessThan(
                geo!.lineHeight * 1.5,
            );

            const blockCentre = (geo!.blockTop + geo!.blockBottom) / 2;
            expect(
                Math.abs(blockCentre - geo!.viewportHeight / 2),
            ).toBeLessThanOrEqual(geo!.lineHeight);
        });

        /**
         * `scrolloff` reaches `zz` in exactly one situation: the cursor is in
         * the interior of a line taller than the window, where Vim raises
         * `skipcol` to hold the margin. Measured in Neovim 0.12.5 (80x23) with
         * the cursor on the middle character of a 46-display-row line:
         *
         *   so=0    -> skipcol   0, winline 23 (0 rows below the cursor)
         *   so=5    -> skipcol 400, winline 18 (5 rows below)
         *   so=9999 -> skipcol 880, winline 12 (centred; Vim centres outright
         *              once `w_height_inner <= so * 2`)
         *
         * A line that *fits* the window is never touched — all three values
         * give winline 7/12/17 for a 11-row line — because `zz` only sets a
         * whole-line `topline`, and `skipcol` stays 0. Nor is the margin
         * reachable at the line's first or last row: `skipcol` saturates at
         * 0 and at `lineRows - winheight`, which is why cursor-at-line-end
         * stays on the bottom row at every `scrolloff`.
         */
        describe('scrolloff inside a line taller than the viewport', function () {
            let originalScrolloff = 5;

            async function placeMidLongLine(rows: number): Promise<void> {
                const long = lineOfRows(rows);
                await setupEditor(docWith(long), {
                    line: LONG_LINE_INDEX,
                    ch: Math.floor(long.length / 2),
                });
                await browser.pause(PAUSE.EDITOR_SETTLE);
            }

            before(async function () {
                originalScrolloff = (await browser.executeObsidian(
                    ({ app }) => {
                        const plugin = (
                            app as unknown as {
                                plugins: {
                                    plugins: Record<
                                        string,
                                        { settings: { scrolloffLines: number } }
                                    >;
                                };
                            }
                        ).plugins.plugins['vim-motions'];
                        return plugin?.settings.scrolloffLines ?? 5;
                    },
                )) as number;
            });

            after(async function () {
                await setPluginSettingAndReload(
                    'scrolloffLines',
                    originalScrolloff,
                );
            });

            it('zz keeps scrolloff rows below the cursor inside a tall wrapped line', async function () {
                await setPluginSettingAndReload('scrolloffLines', 5);
                await placeMidLongLine(Math.floor(viewportRows) * 2);

                await vimKeys('z', 'z');
                await browser.pause(200);

                const geo = await getWrapGeometry();
                expect(geo).not.toBeNull();
                expect(geo!.blockBottom - geo!.blockTop).toBeGreaterThan(
                    geo!.viewportHeight,
                );

                const rowsBelowCursor =
                    (geo!.viewportHeight - geo!.cursorBottom) / geo!.lineHeight;
                expect(Math.round(rowsBelowCursor)).toBe(5);
            });

            it('zz centres the cursor row inside a tall wrapped line when scrolloff exceeds the viewport', async function () {
                await setPluginSettingAndReload('scrolloffLines', 9999);
                await placeMidLongLine(Math.floor(viewportRows) * 2);

                await vimKeys('z', 'z');
                await browser.pause(200);

                const geo = await getWrapGeometry();
                expect(geo).not.toBeNull();
                expect(geo!.blockBottom - geo!.blockTop).toBeGreaterThan(
                    geo!.viewportHeight,
                );

                const viewportRowCount = geo!.viewportHeight / geo!.lineHeight;
                const rowsAboveCursor = geo!.cursorTop / geo!.lineHeight;
                const rowsBelowCursor =
                    (geo!.viewportHeight - geo!.cursorBottom) / geo!.lineHeight;
                // Centred, not merely "off the bottom edge": both halves must
                // match, and both must be far from the ~1 row the bug left.
                // The floor is a fraction of the measured viewport rather than
                // a constant — a constant calibrated here (20) failed CI,
                // whose viewport is ~37 rows against this machine's ~54.
                expect(rowsBelowCursor).toBeGreaterThan(viewportRowCount / 4);
                expect(
                    Math.abs(rowsAboveCursor - rowsBelowCursor),
                ).toBeLessThanOrEqual(1);
            });

            it('scrolloff does not move zz on a line that fits the viewport', async function () {
                const rows = Math.max(6, Math.floor(viewportRows / 3));

                // `zz` is pressed twice on purpose. A single press measured
                // from a far-away scroll lands up to ~2 display rows off,
                // because CM6 estimates `coordsAtPos` for content outside the
                // rendered viewport; the second press starts from the first
                // one's output and converges. That artifact predates this
                // suite and is not what this test is about, so it is removed
                // rather than tolerated with a fuzzy comparison.
                async function settledLineTop(so: number): Promise<number> {
                    await setPluginSettingAndReload('scrolloffLines', so);
                    await placeMidLongLine(rows);
                    await vimKeys('z', 'z');
                    await browser.pause(200);
                    await vimKeys('z', 'z');
                    await browser.pause(200);
                    const geo = await getWrapGeometry();
                    expect(geo).not.toBeNull();
                    expect(geo!.blockBottom - geo!.blockTop).toBeLessThan(
                        geo!.viewportHeight,
                    );
                    return geo!.blockTop;
                }

                const withoutScrolloff = await settledLineTop(0);
                const withScrolloff = await settledLineTop(9999);

                expect(withoutScrolloff).toBeGreaterThan(0);
                expect(withScrolloff).toBe(withoutScrolloff);
            });
        });
    });

    /**
     * `zt` and `zb` hold a `scrolloff` margin past the cursor line on *any*
     * line, not only one taller than the window. Measured in Neovim 0.12.5
     * (80x23) on an ordinary one-row line, cursor line 61:
     *
     *   zt so=5    -> topline 56 (5 rows above the line),  winline  6
     *   zb so=5    -> topline 44 (5 rows below the line),  winline 18
     *   zt so=11   -> topline 50, winline 12  ]  identical to zz: once the
     *   zb so=11   -> topline 50, winline 12  ]  margin no longer fits, all
     *   zz so=11   -> topline 50, winline 12  ]  three centre the line
     *
     * so=12 and so=9999 reproduce the so=11 row exactly, so the margin
     * saturates at the centred position rather than overshooting it.
     */
    describe('zt / zb with scrolloff', function () {
        const DOC = Array.from({ length: 240 }, (_, i) => `line ${i + 1}`).join(
            '\n',
        );
        const TARGET = 120;
        let originalScrolloff = 5;

        // Two presses for the same reason as the zz case above: the first
        // measurement from a distant scroll is subject to CM6's estimated
        // coordinates for unrendered content.
        async function settledGeometry(
            so: number,
            key: string,
        ): Promise<WrapGeometry> {
            await setPluginSettingAndReload('scrolloffLines', so);
            await setupEditor(DOC, { line: TARGET, ch: 0 });
            await browser.pause(PAUSE.EDITOR_SETTLE);
            await vimKeys('z', key);
            await browser.pause(200);
            await vimKeys('z', key);
            await browser.pause(200);
            const geo = await getWrapGeometry();
            expect(geo).not.toBeNull();
            return geo!;
        }

        before(async function () {
            originalScrolloff = (await browser.executeObsidian(({ app }) => {
                const plugin = (
                    app as unknown as {
                        plugins: {
                            plugins: Record<
                                string,
                                { settings: { scrolloffLines: number } }
                            >;
                        };
                    }
                ).plugins.plugins['vim-motions'];
                return plugin?.settings.scrolloffLines ?? 5;
            })) as number;
        });

        after(async function () {
            await setPluginSettingAndReload(
                'scrolloffLines',
                originalScrolloff,
            );
        });

        it('zt leaves scrolloff rows above the cursor line', async function () {
            const geo = await settledGeometry(5, 't');
            expect(Math.round(geo.blockTop / geo.lineHeight)).toBe(5);
        });

        it('zb leaves scrolloff rows below the cursor line', async function () {
            const geo = await settledGeometry(5, 'b');
            expect(
                Math.round(
                    (geo.viewportHeight - geo.blockBottom) / geo.lineHeight,
                ),
            ).toBe(5);
        });

        it('zt, zb and zz agree once scrolloff exceeds half the viewport', async function () {
            const top = await settledGeometry(9999, 't');
            const bottom = await settledGeometry(9999, 'b');
            const centre = await settledGeometry(9999, 'z');

            // The shared value must be the centred one, not an edge both
            // happened to saturate at.
            expect(
                Math.abs(
                    centre.blockTop -
                        (centre.viewportHeight - centre.blockBottom),
                ),
            ).toBeLessThanOrEqual(centre.lineHeight);
            expect(top.blockTop).toBe(centre.blockTop);
            expect(bottom.blockTop).toBe(centre.blockTop);
        });
    });

    describe('zh / zl / zH / zL (horizontal scroll)', function () {
        it('zh should not move cursor vertically', async function () {
            await setupEditor('short line', { line: 0, ch: 0 });
            await vimKeys('z', 'h');
            expect((await getCursorPos()).line).toBe(0);
        });

        it('zl should not move cursor vertically', async function () {
            await setupEditor('short line', { line: 0, ch: 0 });
            await vimKeys('z', 'l');
            expect((await getCursorPos()).line).toBe(0);
        });
    });
});
