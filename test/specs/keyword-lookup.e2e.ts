/**
 * Regression test for issue #188:
 * `K` on a wikilink must open Obsidian's page preview straight away — without
 * the user also pressing Ctrl/Cmd — and the popover must stay on screen
 * instead of disappearing again within a second.
 */
import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { ensureLivePreview, PAUSE, setupEditor, vimRawKeys } from '../helpers';

/** Body text of `test-vault/Target.md`, the note the wikilink resolves to. */
const TARGET_PREVIEW_TEXT = 'target note for link navigation tests';

interface PopoverState {
    present: boolean;
    text: string;
}

async function popoverState(): Promise<PopoverState> {
    return (await browser.executeObsidian(() => {
        const el = document.querySelector('.hover-popover');
        return { present: el !== null, text: el?.textContent ?? '' };
    })) as PopoverState;
}

async function waitForPopover(timeout: number): Promise<PopoverState> {
    let last: PopoverState = { present: false, text: '' };
    await browser
        .waitUntil(
            async () => {
                last = await popoverState();
                return last.present && last.text.includes(TARGET_PREVIEW_TEXT);
            },
            { timeout, interval: 100 },
        )
        .catch(() => {});
    return last;
}

/**
 * Page preview lets the user require Ctrl/Cmd per hover-link source. The
 * reporter had that on, which is why `K` alone did nothing for them and the
 * preview only flashed up once Cmd was pressed. Forcing it on for every
 * registered source reproduces that configuration without depending on which
 * source name the plugin passes.
 */
async function setRequireModForAllSources(): Promise<Record<string, boolean>> {
    return (await browser.executeObsidian(({ app }) => {
        const instance = app.internalPlugins.getEnabledPluginById(
            'page-preview',
        ) as unknown as { options?: Record<string, boolean> } | null;
        if (!instance) throw new Error('page-preview core plugin not enabled');
        const options = (instance.options ??= {});
        const saved = { ...options };
        for (const source of [
            ...Object.keys(app.workspace.hoverLinkSources),
            'preview',
            'editor',
        ]) {
            options[source] = true;
        }
        return saved;
    })) as Record<string, boolean>;
}

async function restoreHoverSourceOptions(
    saved: Record<string, boolean>,
): Promise<void> {
    await browser.executeObsidian(
        ({ app }, previous: Record<string, boolean>) => {
            const instance = app.internalPlugins.getEnabledPluginById(
                'page-preview',
            ) as unknown as { options?: Record<string, boolean> } | null;
            if (instance) instance.options = previous;
        },
        saved,
    );
}

async function hidePopover(): Promise<void> {
    await browser.executeObsidian(({ app, obsidian }) => {
        const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        (
            view as unknown as { hoverPopover?: { hide?: () => void } } | null
        )?.hoverPopover?.hide?.();
        for (const el of Array.from(
            document.querySelectorAll('.hover-popover'),
        )) {
            el.remove();
        }
    });
    await browser.pause(PAUSE.EDITOR_SETTLE);
}

describe('Keyword lookup page preview (#188)', function () {
    before(async function () {
        this.timeout(60000);
        await obsidianPage.openFile('Welcome.md');
        await browser.pause(PAUSE.OBSIDIAN_LOAD);
        await ensureLivePreview();
    });

    afterEach(async function () {
        await hidePopover();
    });

    it('K on a wikilink opens the page preview when page preview requires Ctrl/Cmd', async function () {
        this.timeout(60000);
        const saved = await setRequireModForAllSources();
        try {
            await setupEditor('See [[Target]] for details.', {
                line: 0,
                ch: 8,
            });
            expect((await popoverState()).present).toBe(false);

            // Only `K` is pressed — no Ctrl, no Cmd, at any point.
            await vimRawKeys('K');

            const shown = await waitForPopover(5000);
            expect(shown.present).toBe(true);
            expect(shown.text).toContain(TARGET_PREVIEW_TEXT);
        } finally {
            await restoreHoverSourceOptions(saved);
        }
    });

    it('the page preview opened by K stays visible', async function () {
        this.timeout(60000);
        await setupEditor('See [[Target]] for details.', { line: 0, ch: 8 });
        await vimRawKeys('K');

        const shown = await waitForPopover(5000);
        expect(shown.present).toBe(true);

        // Obsidian re-checks every 500ms whether the last recorded pointer
        // position is still inside the popover's target element, and starts a
        // 300ms hide timer when it is not. 2.5s is well past the window in
        // which the reported build lost the preview.
        await browser.pause(2500);

        const later = await popoverState();
        expect(later.present).toBe(true);
        expect(later.text).toContain(TARGET_PREVIEW_TEXT);
    });
});
