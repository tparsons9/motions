import BUNDLED_GLOBAL from '../snippets/bundled/global.json';
import BUNDLED_OBSIDIAN_MARKDOWN from '../snippets/bundled/obsidian-markdown.json';

export const GENERATED_MODULE_NAME = 'vim_motions';

// First line of every generated file. Its absence means the user has taken
// the file over, and we must not overwrite their work.
export const GENERATED_SENTINEL = '-- vim-motions:generated';

export interface ConfigExportSettings {
    leaderKey: string;
    textwidth: number;
    snippets: boolean;
    /** Absolute paths to VS Code-format snippet JSON files Neovim can read. */
    snippetPaths: readonly string[];
    surround: boolean;
    dial: boolean;
    subwordMotions: boolean;
    yankRing: boolean;
    flash: boolean;
    easyMotion: boolean;
    replaceWithRegister: boolean;
}

export const SNIPPET_DIRECTORY = 'vim-motions-snippets';

// The bundled snippets live inside main.js, so Neovim cannot read them until
// they are written out. They are plain VS Code format, which LuaSnip loads
// verbatim -- verified by expanding `date` from global.json through a real
// LuaSnip, which produced the resolved date rather than the literal variables.
export const BUNDLED_SNIPPET_FILES: Readonly<Record<string, unknown>> = {
    'global.json': BUNDLED_GLOBAL,
    'obsidian-markdown.json': BUNDLED_OBSIDIAN_MARKDOWN,
};

const SNIPPET_BODY = [
    "local luasnip = require('luasnip')",
    "local from_vscode = require('luasnip.loaders.from_vscode')",
    'for _, path in ipairs(SNIPPET_PATHS) do',
    '    pcall(from_vscode.load_standalone, { path = path })',
    'end',
    // Without an expansion key the snippets load and then do nothing, which
    // is the shape of a feature that looks wired up but is not.
    "vim.keymap.set({ 'i', 's' }, '<Tab>', function()",
    '    if luasnip.expand_or_jumpable() then',
    '        luasnip.expand_or_jump()',
    '    else',
    "        vim.api.nvim_feedkeys(vim.keycode('<Tab>'), 'n', false)",
    '    end',
    'end)',
    "vim.keymap.set({ 'i', 's' }, '<S-Tab>', function()",
    '    if luasnip.jumpable(-1) then luasnip.jump(-1) end',
    'end)',
].join('\n    ');

export interface PluginBlock {
    readonly setting: keyof ConfigExportSettings;
    readonly module: string;
    readonly repo: string;
    readonly label: string;
    readonly body: string;
}

// Each block is the Neovim plugin the corresponding Vim Motions feature was
// modelled on, so a user who liked the feature gets the thing it came from.
// Nothing here installs anything: a missing plugin makes the pcall fail and
// the block is skipped.
const PLUGIN_BLOCKS: readonly PluginBlock[] = [
    {
        setting: 'surround',
        module: 'nvim-surround',
        repo: 'https://github.com/kylechui/nvim-surround',
        label: 'Surround',
        body: "require('nvim-surround').setup({})",
    },
    {
        setting: 'dial',
        module: 'dial.map',
        repo: 'https://github.com/monaqa/dial.nvim',
        label: 'Enhanced increment/decrement',
        body: [
            // dial.nvim's defaults are decimal, hex numbers, dates and
            // Japanese weekdays. Booleans, hex colours and checkboxes are the
            // ones this plugin's own increment handles and dial does not
            // enable by default, so they are added explicitly.
            "local augend = require('dial.augend')",
            "require('dial.config').augends:register_group({",
            '    default = {',
            '        augend.integer.alias.decimal,',
            '        augend.integer.alias.hex,',
            "        augend.date.new({ pattern = '%Y-%m-%d', default_kind = 'day' }),",
            "        augend.date.new({ pattern = '%Y/%m/%d', default_kind = 'day' }),",
            '        augend.constant.alias.bool,',
            '        augend.hexcolor.new({ case = "lower" }),',
            "        augend.constant.new({ elements = { '[ ]', '[x]' }, word = false, cyclic = true }),",
            '    },',
            '})',
            "vim.keymap.set('n', '<C-a>', require('dial.map').inc_normal())",
            "vim.keymap.set('n', '<C-x>', require('dial.map').dec_normal())",
            "vim.keymap.set('v', '<C-a>', require('dial.map').inc_visual())",
            "vim.keymap.set('v', '<C-x>', require('dial.map').dec_visual())",
        ].join('\n    '),
    },
    {
        setting: 'subwordMotions',
        module: 'spider',
        repo: 'https://github.com/chrisgrieser/nvim-spider',
        label: 'Subword motions',
        body: [
            "for _, key in ipairs({ 'w', 'e', 'b', 'ge' }) do",
            "    vim.keymap.set({ 'n', 'o', 'x' }, key, function()",
            "        require('spider').motion(key)",
            '    end)',
            'end',
        ].join('\n    '),
    },
    {
        setting: 'yankRing',
        module: 'yanky',
        repo: 'https://github.com/gbprod/yanky.nvim',
        label: 'Yank-ring paste cycling',
        body: [
            "require('yanky').setup({})",
            "vim.keymap.set({ 'n', 'x' }, 'p', '<Plug>(YankyPutAfter)')",
            "vim.keymap.set({ 'n', 'x' }, 'P', '<Plug>(YankyPutBefore)')",
            "vim.keymap.set('n', '<C-p>', '<Plug>(YankyPreviousEntry)')",
            "vim.keymap.set('n', '<C-n>', '<Plug>(YankyNextEntry)')",
        ].join('\n    '),
    },
    {
        setting: 'flash',
        module: 'flash',
        repo: 'https://github.com/folke/flash.nvim',
        label: 'Flash motions',
        body: [
            "require('flash').setup({})",
            "vim.keymap.set({ 'n', 'x', 'o' }, 's', function()",
            "    require('flash').jump()",
            'end)',
        ].join('\n    '),
    },
    {
        setting: 'easyMotion',
        module: 'flash',
        repo: 'https://github.com/folke/flash.nvim',
        label: 'EasyMotion / Hop',
        body: [
            "vim.keymap.set({ 'n', 'x', 'o' }, '<leader><leader>', function()",
            "    require('flash').jump({ search = { mode = 'search' } })",
            'end)',
        ].join('\n    '),
    },
    {
        setting: 'snippets',
        module: 'luasnip',
        repo: 'https://github.com/L3MON4D3/LuaSnip',
        label: 'Snippets',
        body: SNIPPET_BODY,
    },
    {
        setting: 'replaceWithRegister',
        module: 'mini.operators',
        repo: 'https://github.com/echasnovski/mini.operators',
        label: 'Replace-with-register',
        body: "require('mini.operators').setup({ replace = { prefix = 'gr' } })",
    },
];

export function enabledPluginBlocks(
    settings: ConfigExportSettings,
): readonly PluginBlock[] {
    return PLUGIN_BLOCKS.filter((block) => settings[block.setting] === true);
}

export function referencedRepos(settings: ConfigExportSettings): string[] {
    return [
        ...new Set(enabledPluginBlocks(settings).map((block) => block.repo)),
    ].sort();
}

// Neovim installs and activates these itself, at the user's explicit request,
// into its own data directory. Nothing here touches the vault or the fengari
// fetch store; `force` is what keeps `update` from opening its review buffer
// and blocking the connection.
export async function installPlugins(
    host: ExportHost,
    repos: readonly string[],
): Promise<{ ok: boolean; error?: string }> {
    if (repos.length === 0) return { ok: true };
    const result = await host.request('nvim_exec_lua', [
        `local specs = ...
local ok, err = pcall(vim.pack.add, specs)
if not ok then return tostring(err) end
local names = {}
for _, plugin in ipairs(vim.pack.get()) do
    names[#names + 1] = plugin.spec.name
end
if #names > 0 then pcall(vim.pack.update, names, { force = true }) end
return true`,
        [repos],
    ]);
    return result === true
        ? { ok: true }
        : { ok: false, error: String(result) };
}

export function referencedModules(settings: ConfigExportSettings): string[] {
    return [
        ...new Set(enabledPluginBlocks(settings).map((block) => block.module)),
    ].sort();
}

function luaString(value: string): string {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function generateNeovimConfig(settings: ConfigExportSettings): string {
    const snippetPaths = `{ ${settings.snippetPaths.map(luaString).join(', ')} }`;
    const blocks = enabledPluginBlocks(settings).map(
        (block) =>
            `-- ${block.label}\nif pcall(require, ${luaString(block.module)}) then\n    ${block.body.replace('SNIPPET_PATHS', snippetPaths)}\nend`,
    );
    return [
        GENERATED_SENTINEL,
        '--',
        '-- Generated from your Vim Motions settings. Regenerating overwrites',
        '-- this file, so edit your own configuration instead of this one.',
        '--',
        '-- Opt in by adding this line to your init.lua:',
        `--     require(${luaString(GENERATED_MODULE_NAME)})`,
        '--',
        '-- Every block below is guarded, so requiring this file is safe even',
        '-- with none of these plugins installed. Vim Motions never installs',
        '-- them; it only configures what you already have. If you already',
        '-- configure one of them yourself, delete that block or place your',
        '-- own setup after the require.',
        '',
        `vim.g.mapleader = ${luaString(settings.leaderKey)}`,
        `vim.opt.textwidth = ${String(Math.trunc(settings.textwidth))}`,
        ...(blocks.length > 0 ? ['', blocks.join('\n\n')] : []),
        '',
    ].join('\n');
}

export function isGeneratedFile(contents: string): boolean {
    return contents.trimStart().startsWith(GENERATED_SENTINEL);
}

// Compares generated output rather than the settings object, so a setting the
// export does not use cannot report the file as stale.
export type ExportOutcome =
    | { status: 'written'; path: string }
    | { status: 'foreign'; path: string }
    | { status: 'failed'; reason: string };

export interface ExportHost {
    request(method: string, args: unknown[]): Promise<unknown>;
    readFile(path: string): Promise<string | null>;
    writeFile(path: string, contents: string): Promise<boolean>;
}

function isAbsolutePath(value: string): boolean {
    return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

function joinPath(directory: string, ...segments: string[]): string {
    const separator = directory.includes('\\') ? '\\' : '/';
    return [directory.replace(/[\\/]+$/, ''), ...segments].join(separator);
}

// Asked of Neovim rather than reconstructed from XDG_CONFIG_HOME and
// NVIM_APPNAME: those were measured during M2a not to describe the real
// config directory when nvim is a wrapper script, as it is on NixOS.
export async function resolveGeneratedConfigPath(
    host: ExportHost,
    configuredConfigPath: string,
): Promise<string | null> {
    const trimmed = configuredConfigPath.trim();
    if (trimmed) {
        const separator = trimmed.includes('\\') ? '\\' : '/';
        const parent = trimmed.slice(0, trimmed.lastIndexOf(separator));
        if (!parent) return null;
        return joinPath(parent, 'lua', `${GENERATED_MODULE_NAME}.lua`);
    }
    const directory = await host.request('nvim_exec_lua', [
        "return vim.fn.stdpath('config')",
        [],
    ]);
    if (typeof directory !== 'string' || !directory) return null;
    return joinPath(directory, 'lua', `${GENERATED_MODULE_NAME}.lua`);
}

export async function exportNeovimConfig(
    host: ExportHost,
    configuredConfigPath: string,
    settings: ConfigExportSettings,
): Promise<ExportOutcome> {
    const path = await resolveGeneratedConfigPath(host, configuredConfigPath);
    if (!path)
        return {
            status: 'failed',
            reason: 'Could not determine the Neovim configuration directory.',
        };
    const existing = await host.readFile(path);
    if (existing !== null && !isGeneratedFile(existing))
        return { status: 'foreign', path };
    const separator = path.includes('\\') ? '\\' : '/';
    const root = path.slice(0, path.lastIndexOf(separator));
    if (settings.snippets) {
        for (const [name, content] of Object.entries(BUNDLED_SNIPPET_FILES))
            await host.writeFile(
                [root, SNIPPET_DIRECTORY, name].join(separator),
                JSON.stringify(content, null, 2),
            );
    }
    // Neovim resolves a relative path against its working directory, which is
    // the vault, not the configuration directory these files were written to.
    const resolved: ConfigExportSettings = {
        ...settings,
        // Split on either separator before rejoining: a relative path arrives
        // with a literal `/`, so joining it as-is on Windows references the
        // file as `…\lua\vim-motions-snippets/global.json` while it was
        // written to the all-backslash form. Windows opens both, so the only
        // symptom is two spellings of one path.
        snippetPaths: settings.snippetPaths.map((snippetPath) =>
            isAbsolutePath(snippetPath)
                ? snippetPath
                : [root, ...snippetPath.split(/[\\/]/)].join(separator),
        ),
    };
    const written = await host.writeFile(path, generateNeovimConfig(resolved));
    return written
        ? { status: 'written', path }
        : { status: 'failed', reason: `Could not write ${path}.` };
}

export async function probeModules(
    host: ExportHost,
    modules: readonly string[],
): Promise<Record<string, boolean>> {
    if (modules.length === 0) return {};
    const loaded = await host.request('nvim_exec_lua', [
        `local found = {}
for _, name in ipairs(...) do found[name] = (pcall(require, name)) end
return found`,
        [modules],
    ]);
    const result: Record<string, boolean> = {};
    for (const name of modules)
        result[name] =
            typeof loaded === 'object' &&
            loaded !== null &&
            (loaded as Record<string, unknown>)[name] === true;
    return result;
}

export function configFingerprint(settings: ConfigExportSettings): string {
    const body = generateNeovimConfig(settings);
    let hash = 0x811c9dc5;
    for (let index = 0; index < body.length; index++) {
        hash ^= body.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}
