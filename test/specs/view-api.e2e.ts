import { setPluginSetting } from '../helpers';
import { browser, expect } from '@wdio/globals';
import type {
    MotionsViewApi,
    MotionsViewInstance,
    MotionsViewScope,
} from '../../src/integrations/view-api-types';

declare global {
    interface Window {
        __testView?: {
            instance: MotionsViewInstance;
            scope: MotionsViewScope;
            el: HTMLElement;
            total: number;
            off: () => void;
        };
    }
}

describe('fork non-editor view API', () => {
    afterEach(async () => {
        await browser.execute(() => {
            const host = window.__testView;
            host?.instance.detach();
            host?.scope.dispose();
            host?.off();
            host?.el.remove();
            delete window.__testView;
        });
    });
    it('routes real DOM input, displays swatches and releases the detached view', async () => {
        await setPluginSetting('whichKeyMode', 'all');
        await browser.executeObsidian(() => {
            const api = (
                window as unknown as { VimMotions: { view: MotionsViewApi } }
            ).VimMotions.view;
            const el = document.body.createDiv();
            el.tabIndex = 0;
            const scope = api.registerScope({
                id: 'test.view',
                name: 'Test view',
                defaultMode: 'reading',
                modes: [
                    { id: 'reading', label: 'Reading' },
                    {
                        id: 'labels',
                        label: 'Label',
                        whichKey: 'immediate',
                        noCount: true,
                        noTimeout: true,
                    },
                ],
                mappings: [
                    { modes: ['reading'], lhs: 'j', action: 'test.down' },
                ],
            });
            const instance = scope.attach({
                containerEl: el,
                isFocused: () => document.activeElement === el,
            });
            const off = api.registerAction({
                id: 'test.down',
                desc: 'Down',
                run: (_args, ctx) => {
                    window.__testView!.total += ctx.count || 1;
                },
            });
            window.__testView = { instance, scope, el, total: 0, off };
            el.addEventListener('keydown', (event) => {
                if (instance.handleKey(event.key) !== 'unhandled') {
                    event.preventDefault();
                    event.stopPropagation();
                }
            });
            el.focus();
            instance.setFocused(true);
        });
        await browser.keys(['2', 'j']);
        await expect(
            await browser.execute(() => window.__testView!.total),
        ).toBe(2);
        await browser.execute(() => {
            const h = window.__testView!;
            h.instance.setLayer('labels', [
                {
                    modes: ['labels'],
                    lhs: 'm',
                    action: 'test.down',
                    desc: 'Method',
                    color: '#cba6f7',
                    detail: 'Data and design',
                },
            ]);
            h.instance.setMode('labels');
        });
        await expect(
            await browser.execute(
                () =>
                    document.querySelector('.vim-motions-view-swatch')
                        ?.textContent,
            ),
        ).toBe('m');
        await browser.keys('?');
        await expect(
            await browser.execute(() =>
                document
                    .querySelector('.vim-motions-view-which-key')
                    ?.classList.contains('show-details'),
            ),
        ).toBe(true);
        // Negative control: detached instances cannot consume keys or run actions.
        const control = await browser.execute(() => {
            const h = window.__testView!;
            h.instance.detach();
            return {
                route: h.instance.handleKey('m'),
                total: h.total,
                overlays: h.el.querySelectorAll('.vim-motions-view-which-key')
                    .length,
            };
        });
        await expect(control).toEqual({
            route: 'unhandled',
            total: 2,
            overlays: 0,
        });
    });
});
