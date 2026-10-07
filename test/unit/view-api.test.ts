import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VimModeTracker } from '../../src/vim/mode-tracker';
import type { Plugin } from 'obsidian';
import { ViewRouter } from '../../src/integrations/view-router';
import { viewScopes } from '../../src/integrations/view-scopes';
import {
    getViewApi,
    installViewApi,
    uninstallViewApi,
} from '../../src/integrations/view-api';
import type { MotionsViewScopeDef } from '../../src/integrations/view-api-types';
import {
    createSandboxedState,
    destroyState,
    evalLua,
} from '../../src/lua/engine';
import { injectVimApi } from '../../src/lua/api';
import { AutocmdManager } from '../../src/lua/autocmd';
import fixtureData from '../fixtures/reader-vim/router.json';
const fixtures = fixtureData as unknown as Array<{
    keys: string[];
    action: string;
    count: number;
}>;

const overlayShow = vi.hoisted(() => vi.fn());
vi.mock('../../src/integrations/view-which-key', () => ({
    ViewWhichKey: class {
        show(...args: unknown[]) {
            overlayShow(...args);
        }
        hide() {}
        destroy() {}
        toggleDetails() {}
    },
}));
const owners: symbol[] = [];
const states: ReturnType<typeof createSandboxedState>[] = [];
const setMode = vi.fn();
const globalRun = vi.fn();
const scopeDef: MotionsViewScopeDef = {
    id: 'test.reader',
    name: 'Reader',
    defaultMode: 'reading',
    modes: [
        { id: 'reading', label: 'Reading' },
        {
            id: 'labels',
            label: 'Label',
            noCount: true,
            noTimeout: true,
            whichKey: 'immediate',
            fallthroughGlobal: false,
        },
    ],
    mappings: [{ modes: ['reading'], lhs: 'j', action: 'down' }],
    fallthroughGlobal: true,
};
beforeEach(() => {
    const events = new EventTarget();
    vi.stubGlobal('addEventListener', events.addEventListener.bind(events));
    vi.stubGlobal(
        'removeEventListener',
        events.removeEventListener.bind(events),
    );
    vi.stubGlobal('dispatchEvent', events.dispatchEvent.bind(events));
    installViewApi({
        leader: () => ' ',
        timeout: () => 100,
        hints: () => ({ enabled: true, delay: 0, order: 'which-key' }),
        setMode,
        globalMappings: (modes) => [
            { modes, lhs: '<C-w>h', action: 'view.global:<C-w>h' },
            { modes, lhs: '<leader>rf', action: 'view.global:record-files' },
            { modes, lhs: '<leader>ff', action: 'view.global:files' },
        ],
        runGlobal: globalRun,
    });
});
afterEach(() => {
    for (const L of states.splice(0)) destroyState(L);
    for (const owner of owners.splice(0)) viewScopes.clear(owner);
    uninstallViewApi();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
});
const attach = () =>
    getViewApi()!
        .registerScope(scopeDef)
        .attach({ containerEl: {} as HTMLElement, isFocused: () => true });

describe('non-editor view API', () => {
    it('keeps detached handles inert and rejects attachments to disposed scopes', () => {
        const api = getViewApi()!;
        const scope = api.registerScope(scopeDef);
        const instance = scope.attach({
            containerEl: {} as HTMLElement,
            isFocused: () => true,
        });
        instance.detach();
        setMode.mockClear();
        overlayShow.mockClear();
        instance.setFocused(true);
        instance.setMode('labels');
        instance.setLayer('late', [
            { modes: ['labels'], lhs: 'x', action: 'late' },
        ]);
        expect.soft(setMode.mock.calls).toEqual([]);
        expect.soft(overlayShow.mock.calls).toEqual([]);
        scope.dispose();
        expect
            .soft(() =>
                scope.attach({
                    containerEl: {} as HTMLElement,
                    isFocused: () => true,
                }),
            )
            .toThrow('disposed');
        api.dispose();
        expect.soft(() => api.registerScope(scopeDef)).toThrow('disposed');
    });
    it('cancels the previous view prefix when another instance gains focus', () => {
        vi.useFakeTimers();
        const run = vi.fn();
        getViewApi()!.registerAction({ id: 'short', desc: 'Short', run });
        const scope = getViewApi()!.registerScope({
            ...scopeDef,
            mappings: [
                { modes: ['reading'], lhs: 'g', action: 'short' },
                { modes: ['reading'], lhs: 'gg', action: 'long' },
            ],
        });
        const first = scope.attach({
            containerEl: {} as HTMLElement,
            isFocused: () => true,
        });
        const second = scope.attach({
            containerEl: {} as HTMLElement,
            isFocused: () => false,
        });
        first.handleKey('g');
        second.setFocused(true);
        vi.advanceTimersByTime(200);
        expect.soft(run).not.toHaveBeenCalled();
        setMode.mockClear();
        first.setMode('labels');
        expect.soft(setMode.mock.calls).toEqual([]);
    });
    it('uses the current view mode without leaking a previous action count', async () => {
        const run = vi.fn();
        getViewApi()!.registerAction({ id: 'down', desc: 'Down', run });
        const instance = attach();
        instance.handleKey('3');
        instance.handleKey('j');
        instance.setMode('labels');
        await getViewApi()!.runAction('down');
        expect.soft(run).toHaveBeenLastCalledWith(
            {},
            expect.objectContaining({
                mode: 'labels',
                count: 0,
                keys: [],
                instance,
            }),
        );
    });
    it('preserves numeric strings in Lua view modes and action arguments', () => {
        const L = createSandboxedState();
        states.push(L);
        injectVimApi(L, {
            onSettingOverride: () => {},
            handleExCommand: () => {},
            getVaultName: () => 'vault',
            onKeymap: () => {},
            onKeymapDel: () => {},
            autocmdManager: new AutocmdManager(L),
        });
        const result = evalLua(
            L,
            `vim.ob.view.keymap.set('numeric', '1', 'j', 'down', {args={id='001', count=2, enabled=false}})`,
        );
        expect.soft(result).toEqual({ ok: true });
        evalLua(
            L,
            `vim.ob.view.keymap.set('numeric', 'reading', 'k', 'down', {args={id='001', count=2, enabled=false}})`,
        );
        expect.soft(viewScopes.resolve('numeric').mappings).toEqual([
            expect.objectContaining({
                modes: ['1'],
                args: { id: '001', count: 2, enabled: false },
            }),
            expect.objectContaining({
                modes: ['reading'],
                args: { id: '001', count: 2, enabled: false },
            }),
        ]);
    });

    it('routes forwarded keys even when the host focus report lags', () => {
        const run = vi.fn();
        getViewApi()!.registerAction({ id: 'down', desc: 'Down', run });
        const instance = getViewApi()!
            .registerScope(scopeDef)
            .attach({
                containerEl: {} as HTMLElement,
                isFocused: () => false,
            });
        expect(instance.handleKey('j')).toBe('consumed');
        expect(run).toHaveBeenCalledTimes(1);
        expect(setMode).toHaveBeenLastCalledWith('reading', 'Reading');
        instance.detach();
        expect(instance.handleKey('j')).toBe('unhandled');
        expect(run).toHaveBeenCalledTimes(1);
    });
    it('runs scope actions immediately ahead of longer global prefixes', () => {
        const run = vi.fn();
        getViewApi()!.registerAction({ id: 'record', desc: 'Record', run });
        const instance = getViewApi()!
            .registerScope({
                ...scopeDef,
                mappings: [
                    { modes: ['reading'], lhs: '<leader>r', action: 'record' },
                ],
            })
            .attach({ containerEl: {} as HTMLElement, isFocused: () => true });
        instance.handleKey('<Space>');
        expect(instance.handleKey('r')).toBe('consumed');
        expect(run).toHaveBeenCalledTimes(1);
        instance.handleKey('<Space>');
        instance.handleKey('f');
        instance.handleKey('f');
        expect(globalRun).toHaveBeenCalledWith('files', 0);
    });
    it('keeps temporary label completions isolated from global keys', () => {
        const instance = attach();
        instance.setLayer('profile', [
            { modes: ['labels'], lhs: 'm', action: 'label', desc: 'Method' },
        ]);
        instance.setMode('labels');
        const entries = overlayShow.mock.calls.at(-1)![1] as Array<{
            key: string;
        }>;
        expect(entries.map((e) => e.key)).toEqual(['m']);
    });
    it('restores immediate hints when a temporary mode regains focus', () => {
        const instance = attach();
        instance.setLayer('profile', [
            { modes: ['labels'], lhs: 'm', action: 'label', desc: 'Method' },
        ]);
        instance.setMode('labels');
        instance.setFocused(false);
        overlayShow.mockClear();
        instance.setFocused(true);
        expect(overlayShow).toHaveBeenCalledWith(
            expect.any(String),
            [expect.objectContaining({ key: 'm', desc: 'Method' })],
            0,
            'which-key',
        );
    });
    it('never executes the bare leader action when a leader menu times out', () => {
        vi.useFakeTimers();
        const run = vi.fn();
        const router = new ViewRouter({ run, pending: () => {} }, 100);
        router.setLayer('defaults', [
            { modes: ['reading'], lhs: '<Space>', action: 'page-down' },
            { modes: ['reading'], lhs: '<leader>q', action: 'question' },
        ]);
        router.handle('<Space>', 'reading');
        vi.advanceTimersByTime(5000);
        expect(run.mock.calls).toEqual([]);
        router.dispose();
    });

    it.each(fixtures)('shared routing $keys', ({ keys, action, count }) => {
        const run = vi.fn();
        const router = new ViewRouter({ run, pending: () => {} });
        router.setLayer(
            'defaults',
            [
                ['j', 'down'],
                ['gg', 'top'],
                ['<leader>q', 'question'],
            ].map(([lhs, action]) => ({
                modes: ['reading'],
                lhs: lhs!,
                action: action!,
            })),
        );
        for (const key of keys) router.handle(key, 'reading');
        expect(run).toHaveBeenCalledWith(
            expect.objectContaining({ action }),
            count,
            keys.filter((k) => !/^\d$/.test(k)),
        );
        router.dispose();
    });
    it('queues Lua mappings before registration, keeps user over dynamic and releases them', () => {
        const owner = Symbol();
        owners.push(owner);
        viewScopes.set(owner, 'test.reader', {
            modes: ['reading'],
            lhs: 'j',
            action: 'user',
        });
        const api = getViewApi()!;
        const calls: string[] = [];
        for (const id of ['user', 'dynamic', 'down'])
            api.registerAction({
                id,
                desc: id,
                run: () => {
                    calls.push(id);
                },
            });
        const instance = attach();
        instance.setLayer('profile', [
            { modes: ['reading'], lhs: 'j', action: 'dynamic' },
        ]);
        instance.handleKey('j');
        viewScopes.clear(owner);
        instance.handleKey('j');
        instance.setLayer('profile', []);
        instance.handleKey('j');
        expect(calls).toEqual(['user', 'dynamic', 'down']);
        instance.detach();
        expect(instance.handleKey('j')).toBe('unhandled');
    });
    it('routes global sequences with a count and reports/clears focused modes', () => {
        const instance = attach();
        instance.handleKey('3');
        instance.handleKey('<C-w>');
        instance.handleKey('h');
        expect(globalRun).toHaveBeenCalledWith('<C-w>h', 3);
        instance.setMode('labels', 'Choose label');
        expect(setMode).toHaveBeenLastCalledWith('labels', 'Choose label');
        instance.setFocused(false);
        expect(setMode).toHaveBeenLastCalledWith(null);
    });
    it('waits on ambiguous prefixes and keeps label menus open past timeout', () => {
        vi.useFakeTimers();
        const run = vi.fn();
        const router = new ViewRouter(
            { run, pending: () => {} },
            100,
            (mode) => ({
                noTimeout: mode === 'labels',
                noCount: mode === 'labels',
            }),
        );
        router.setLayer('defaults', [
            { modes: ['reading'], lhs: 'g', action: 'short' },
            { modes: ['reading'], lhs: 'gg', action: 'long' },
            { modes: ['labels'], lhs: 'm1', action: 'label' },
        ]);
        router.handle('g', 'reading');
        expect(run).not.toHaveBeenCalled();
        vi.advanceTimersByTime(100);
        expect(run.mock.calls[0]![0].action).toBe('short');
        router.handle('m', 'labels');
        vi.advanceTimersByTime(5000);
        router.handle('1', 'labels');
        expect(run.mock.calls[1]![0].action).toBe('label');
        router.dispose();
    });
    it('runs Lua functions, exposes source context and removes mappings/actions on reload', () => {
        const L = createSandboxedState();
        states.push(L);
        injectVimApi(L, {
            onSettingOverride: () => {},
            handleExCommand: () => {},
            getVaultName: () => 'vault',
            onKeymap: () => {},
            onKeymapDel: () => {},
            autocmdManager: new AutocmdManager(L),
            getActiveFilePath: () => 'paper.md',
        });
        getViewApi()!.registerBufferContext('zotflow', (path) => ({
            title: path,
            reader_open: true,
        }));
        expect(
            evalLua(
                L,
                `calls = 0; vim.ob.view.keymap.set('test.reader', 'reading', 'j', function(args, ctx) calls = calls + ctx.count end, {desc='Lua down'}); vim.ob.view.whichkey.add('test.reader', {{'g', group='Go', mode='reading'}}); assert(vim.ob.context('zotflow').title == 'paper.md')`,
            ),
        ).toEqual({ ok: true });
        const instance = attach();
        instance.handleKey('2');
        instance.handleKey('j');
        expect(evalLua(L, 'assert(calls == 2, tostring(calls))')).toEqual({
            ok: true,
        });
        expect(getViewApi()!.listActions('view.lua:').length).toBe(1);
        destroyState(L);
        states.pop();
        expect(viewScopes.resolve('test.reader').mappings).toEqual([]);
        expect(getViewApi()!.listActions('view.lua:')).toEqual([]);
    });
});

// Exercise the real tracker: focused views overlay RPC, then the editor mode.
it('layers view mode over RPC and restores the adapter display', () => {
    const elements: Array<{ text: string; dataset: Record<string, string> }> =
        [];
    const plugin = {
        addStatusBarItem: () => {
            const el = {
                text: '',
                dataset: {},
                addClass() {},
                hide() {},
                remove() {},
                setText(text: string) {
                    this.text = text;
                },
            };
            elements.push(el);
            return el;
        },
    } as unknown as Plugin;
    const tracker = new VimModeTracker(plugin);
    tracker.setExternalMode('insert');
    tracker.setViewMode('caret', 'Caret');
    expect(elements[0]).toMatchObject({
        text: 'Caret',
        dataset: { vimMode: 'caret' },
    });
    tracker.setExternalMode('visual');
    expect(elements[0]?.text).toBe('Caret');
    tracker.setViewMode(null);
    expect(elements[0]).toMatchObject({
        text: 'VISUAL',
        dataset: { vimMode: 'visual' },
    });
    tracker.setExternalMode(null);
    expect(elements[0]?.text).toBe('NORMAL');
    tracker.destroy();
});
