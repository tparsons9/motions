import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { setupEditor, getEditorValue, PAUSE } from '../helpers';

async function loadLuaConfig(content: string): Promise<void> {
    await browser.reloadObsidian({ vault: 'test-vault' });
    await obsidianPage.openFile('Welcome.md');
    await browser.waitUntil(
        async () =>
            (await browser.executeObsidian(({ app }) => {
                const plugin = (
                    app as unknown as {
                        plugins: {
                            plugins: Record<string, { vimrcLoaded?: boolean }>;
                        };
                    }
                ).plugins.plugins['vim-motions'];
                return plugin?.vimrcLoaded === true;
            })) as boolean,
        { timeout: 10000, interval: 200 },
    );
    await browser.executeObsidian(async ({ app }, luaContent: string) => {
        const configPath = `${app.vault.configDir}.init.lua`;
        await app.vault.adapter.write(configPath, luaContent);
    }, content);
    await browser.executeObsidian(async ({ app }) => {
        const plugin = (
            app as unknown as {
                plugins: {
                    plugins: Record<
                        string,
                        { loadLuaConfigForTest?: () => Promise<void> }
                    >;
                };
            }
        ).plugins.plugins['vim-motions'];
        await plugin?.loadLuaConfigForTest?.();
    });
    await browser.waitUntil(
        async () =>
            (await browser.executeObsidian(({ app }) => {
                const plugin = (
                    app as unknown as {
                        plugins: {
                            plugins: Record<string, { luaLoaded?: boolean }>;
                        };
                    }
                ).plugins.plugins['vim-motions'];
                return plugin?.luaLoaded === true;
            })) as boolean,
        { timeout: 10000, interval: 200 },
    );
}

// Reads back the vim.g flags the configuration above computed. A flag the
// config never reached is absent from the JSON rather than null, because
// vim.json.encode drops nil values -- so a config that errors part-way through
// fails the assertion for every later flag instead of reporting nothing.
//
// This replaces a `plugin.luaLoadResult.error` read. No such member exists on
// the plugin, so that helper returned null unconditionally and all 12
// assertions in this file passed against `this is not valid lua @@@ ###`.
async function readLuaFlags(
    ...names: string[]
): Promise<Record<string, unknown>> {
    await setupEditor('', { line: 0, ch: 0 });
    const collect = names
        .map((name) => `out[${JSON.stringify(name)}] = vim.g.${name}`)
        .join('\n');
    await browser.executeObsidian(({ app }, luaCode: string) => {
        const plugin = (
            app as unknown as {
                plugins: {
                    plugins: Record<
                        string,
                        { executeLuaForTest?: (code: string) => void }
                    >;
                };
            }
        ).plugins.plugins['vim-motions'];
        if (!plugin?.executeLuaForTest)
            throw new Error('readLuaFlags: executeLuaForTest is unavailable');
        plugin.executeLuaForTest(luaCode);
    }, `local out = {}\n${collect}\nvim.api.nvim_buf_set_lines(0, 0, -1, false, { vim.json.encode(out) })`);
    await browser.pause(PAUSE.EDITOR_SETTLE);
    const raw = (await getEditorValue()).trim();
    try {
        return JSON.parse(raw) as Record<string, unknown>;
    } catch {
        throw new Error(`readLuaFlags: buffer was not JSON:\n${raw}`);
    }
}

describe('vim.treesitter e2e', () => {
    before(async () => {
        await obsidianPage.openFile('Welcome.md');
    });

    it('vim.treesitter namespace is accessible without errors', async () => {
        await loadLuaConfig(`
            vim.g.__ts_ok = (type(vim.treesitter) == "table")
            vim.g.__ts_lang_ok = (type(vim.treesitter.language) == "table")
            vim.g.__ts_query_ok = (type(vim.treesitter.query) == "table")
        `);
        const flags = await readLuaFlags(
            '__ts_ok',
            '__ts_lang_ok',
            '__ts_query_ok',
        );
        expect(flags).toEqual({
            __ts_ok: true,
            __ts_lang_ok: true,
            __ts_query_ok: true,
        });
    });

    it('vim.treesitter.language.get_lang works', async () => {
        await loadLuaConfig(`
            local lang = vim.treesitter.language.get_lang("markdown")
            vim.g.__md_lang = lang
        `);
        const flags = await readLuaFlags('__md_lang');
        expect(flags.__md_lang).toBe('markdown');
    });

    it('vim.treesitter.language.register does not error', async () => {
        await loadLuaConfig(`
            vim.treesitter.language.register("markdown", "md")
            vim.g.__alias_lang = vim.treesitter.language.get_lang("md")
        `);
        const flags = await readLuaFlags('__alias_lang');
        expect(flags.__alias_lang).toBe('markdown');
    });

    it('get_string_parser parses markdown without error', async () => {
        await loadLuaConfig(`
            local tree = vim.treesitter.get_string_parser("# Hello\\n\\nWorld\\n", "markdown")
            local root = tree:root()
            vim.g.__root_type = root:type()
        `);
        const flags = await readLuaFlags('__root_type');
        expect(flags.__root_type).toBe('document');
    });

    it('TSNode methods work without errors', async () => {
        await loadLuaConfig(`
            local tree = vim.treesitter.get_string_parser("# Heading\\n\\nParagraph\\n", "markdown")
            local root = tree:root()
            local t = root:type()
            local sr, sc, sb = root:start()
            local er, ec, eb = root:end_()
            local cc = root:child_count()
            local named = root:named()
            local sexpr = root:sexpr()
            local bl = root:byte_length()
            local child = root:child(0)
            local parent_nil = (root:parent() == nil)
            vim.g.__ts_node_ok = (t ~= nil and cc > 0 and named and sexpr ~= nil and bl > 0 and child ~= nil and parent_nil)
        `);
        const flags = await readLuaFlags('__ts_node_ok');
        expect(flags.__ts_node_ok).toBe(true);
    });

    it('query.parse and iter_captures work', async () => {
        await loadLuaConfig(`
            local tree = vim.treesitter.get_string_parser("# Hello\\n\\n## World\\n", "markdown")
            local root = tree:root()
            local q = vim.treesitter.query.parse("markdown", "(atx_heading) @heading")
            local count = 0
            for id, node, metadata in q:iter_captures(root, 0) do
                count = count + 1
            end
            vim.g.__capture_count = count
        `);
        const flags = await readLuaFlags('__capture_count');
        expect(flags.__capture_count).toBe(2);
    });

    it('query.parse and iter_matches work', async () => {
        await loadLuaConfig(`
            local tree = vim.treesitter.get_string_parser("# One\\n\\nPara\\n", "markdown")
            local root = tree:root()
            local q = vim.treesitter.query.parse("markdown", "(paragraph) @para")
            local count = 0
            for pattern, match, metadata in q:iter_matches(root, 0) do
                count = count + 1
            end
            vim.g.__match_count = count
        `);
        const flags = await readLuaFlags('__match_count');
        expect(flags.__match_count).toBe(1);
    });

    it('get_parser returns LanguageTree for active document', async () => {
        await loadLuaConfig(`
            local parser = vim.treesitter.get_parser(0, "markdown")
            vim.g.__parser_lang = parser:lang()
            local root = parser:root()
            if root then
                vim.g.__doc_root_type = root:type()
            end
        `);
        const flags = await readLuaFlags('__parser_lang', '__doc_root_type');
        expect(flags).toEqual({
            __parser_lang: 'markdown',
            __doc_root_type: 'document',
        });
    });

    it('LanguageTree:for_each_tree iterates trees', async () => {
        await loadLuaConfig(`
            local parser = vim.treesitter.get_parser(0, "markdown")
            local count = 0
            parser:for_each_tree(function(tree, ltree)
                count = count + 1
            end)
            vim.g.__tree_count = count
        `);
        const flags = await readLuaFlags('__tree_count');
        expect(flags.__tree_count).toBe(1);
    });

    it('vim.treesitter.is_ancestor works correctly', async () => {
        await loadLuaConfig(`
            local tree = vim.treesitter.get_string_parser("# Hi\\n\\nBody\\n", "markdown")
            local root = tree:root()
            local child = root:child(0)
            vim.g.__is_ancestor = vim.treesitter.is_ancestor(root, child)
            vim.g.__not_ancestor = vim.treesitter.is_ancestor(child, root)
        `);
        const flags = await readLuaFlags('__is_ancestor', '__not_ancestor');
        expect(flags).toEqual({ __is_ancestor: true, __not_ancestor: false });
    });

    it('vim.treesitter.language.inspect returns grammar info', async () => {
        await loadLuaConfig(`
            local info = vim.treesitter.language.inspect("markdown")
            vim.g.__has_abi = (info.abi_version ~= nil)
            vim.g.__is_wasm = info._wasm
        `);
        const flags = await readLuaFlags('__has_abi', '__is_wasm');
        expect(flags).toEqual({ __has_abi: true, __is_wasm: true });
    });

    it('stub functions do not error', async () => {
        await loadLuaConfig(`
            local ok1 = pcall(vim.treesitter.start)
            local ok2 = pcall(vim.treesitter.stop)
            local ok3 = pcall(vim.treesitter.foldexpr)
            local ok4 = pcall(vim.treesitter.select)
            local ok5 = pcall(vim.treesitter.inspect_tree)
            vim.g.__stubs_ok = (ok1 and ok2 and ok3 and ok4 and ok5)
        `);
        const flags = await readLuaFlags('__stubs_ok');
        expect(flags.__stubs_ok).toBe(true);
    });
});
