import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import {
    ensureLivePreview,
    sendVimEscape,
    setPluginSettingAndReload,
    setupEditor,
} from '../helpers';

/**
 * Yank highlight over Live Preview block widgets (#190 follow-up).
 *
 * A rendered callout or embed is a CodeMirror block widget, and a block widget
 * is unreachable by a mark decoration — `ContentBuilder.point` drops the active
 * marks for it — so `yG` over a callout used to flash every line around it and
 * leave the callout itself untouched. The renderer paints those elements
 * directly instead, on the same timer as the mark decorations.
 */

const CALLOUT_DOC = [
    '# Heading',
    '',
    '> [!note] Title',
    '> Body line one',
    '> Body line two',
    '',
    'Trailing paragraph',
].join('\n');

const EMBED_DOC = [
    '# Heading',
    '',
    '![[Target]]',
    '',
    'Trailing paragraph',
].join('\n');

const DURATION = 2000;

interface HighlightState {
    calloutRendered: boolean;
    embedRendered: boolean;
    /** Block widgets painted directly by the renderer. */
    widgets: number;
    /** Ordinary mark decorations — proves a yank happened at all. */
    marks: number;
    widgetFade: number;
    /** Computed opacity of the painted widget, '' when none is painted. */
    widgetOpacity: string;
}

async function highlightState(): Promise<HighlightState> {
    return (await browser.executeObsidian(() => {
        const widgets = Array.from(
            document.querySelectorAll('.vim-motions-yank-highlight-widget'),
        );
        const first = widgets[0] as HTMLElement | undefined;
        return {
            calloutRendered:
                document.querySelector(
                    '.cm-content > .cm-embed-block.cm-callout',
                ) !== null,
            embedRendered:
                document.querySelector(
                    '.cm-content > .internal-embed.markdown-embed',
                ) !== null,
            widgets: widgets.length,
            marks: document.querySelectorAll('.vim-motions-yank-highlight')
                .length,
            widgetFade: document.querySelectorAll(
                '.vim-motions-yank-highlight-widget-fade',
            ).length,
            widgetOpacity: first ? getComputedStyle(first).opacity : '',
        };
    })) as HighlightState;
}

async function waitForRendered(
    key: 'calloutRendered' | 'embedRendered',
): Promise<void> {
    await browser.waitUntil(async () => (await highlightState())[key], {
        timeout: 5000,
        interval: 100,
        timeoutMsg: `${key} never became true`,
    });
}

async function press(...keys: string[]): Promise<void> {
    for (const key of keys) {
        await browser.keys([key]);
        await browser.pause(60);
    }
}

describe('Yank highlight over rendered block widgets', function () {
    before(async function () {
        await browser.reloadObsidian({ vault: 'test-vault' });
        await obsidianPage.openFile('Welcome.md');
        await ensureLivePreview();
        await setPluginSettingAndReload('yankHighlightDuration', DURATION);
    });

    describe('solid mode', function () {
        beforeEach(async function () {
            await setPluginSettingAndReload('yankHighlightMode', 'solid');
            await setupEditor(CALLOUT_DOC, { line: 0, ch: 0 });
            await sendVimEscape();
            await browser.pause(150);
            // The cursor is on the heading, so the callout below it renders as
            // a block widget. Without this the scenarios below would assert
            // against source lines, which marks already cover.
            await waitForRendered('calloutRendered');
        });

        it('yG paints a callout that a mark decoration cannot reach', async function () {
            await press('y', 'G');

            const during = await highlightState();
            expect(during.calloutRendered).toBe(true);
            expect(during.widgets).toBe(1);
            expect(during.marks).toBeGreaterThan(0);
        });

        it('releases the callout when the highlight expires', async function () {
            await press('y', 'G');
            expect((await highlightState()).widgets).toBe(1);

            await browser.waitUntil(
                async () => (await highlightState()).widgets === 0,
                {
                    timeout: DURATION + 3000,
                    interval: 100,
                    timeoutMsg: 'widget highlight never cleared',
                },
            );
            await browser.pause(500);

            const after = await highlightState();
            expect(after.calloutRendered).toBe(true);
            expect(after.widgets).toBe(0);
        });

        it('leaves a callout the yank never covers unhighlighted', async function () {
            await press('y', 'y');

            const during = await highlightState();
            expect(during.calloutRendered).toBe(true);
            expect(during.marks).toBeGreaterThan(0);
            expect(during.widgets).toBe(0);
        });

        it('paints an embedded note the same way', async function () {
            await setupEditor(EMBED_DOC, { line: 0, ch: 0 });
            await sendVimEscape();
            await browser.pause(150);
            await waitForRendered('embedRendered');

            await press('y', 'G');

            const during = await highlightState();
            expect(during.embedRendered).toBe(true);
            expect(during.widgets).toBe(1);
        });
    });

    describe('fade mode', function () {
        beforeEach(async function () {
            await setPluginSettingAndReload('yankHighlightMode', 'fade');
            await setupEditor(CALLOUT_DOC, { line: 0, ch: 0 });
            await sendVimEscape();
            await browser.pause(150);
            await waitForRendered('calloutRendered');
        });

        after(async function () {
            await setPluginSettingAndReload('yankHighlightMode', 'solid');
        });

        it('fades the highlight without fading the callout it sits on', async function () {
            await press('y', 'G');
            await browser.pause(400);

            const during = await highlightState();
            expect(during.widgets).toBe(1);
            expect(during.widgetFade).toBe(1);
            // The mark decorations fade by animating opacity, which on a block
            // widget would fade the callout's own rendered content out with it.
            // The widget fade animates background-color instead, so the element
            // stays fully opaque throughout.
            expect(during.widgetOpacity).toBe('1');
        });
    });
});
