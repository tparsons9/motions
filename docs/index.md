---
title: Vim Motions
description: A polished, Neovim-native experience inside Obsidian. Markdown-aware text objects, structural navigation, EasyMotion, workspace control, and more.
tags:
    - getting-started
---

A polished, Neovim-native experience inside [Obsidian](https://obsidian.md). Vim Motions adds what's missing from Obsidian's built-in Vim mode: Markdown-aware text objects, structural navigation, hard-wrap formatting, workspace keyboard control, EasyMotion, a telescope-style fuzzy picker, Lua configuration with `vim.keymap.set` / `vim.opt` / `vim.fn` / `vim.api` / `vim.ob` / `vim.tbl_*` / autocommands / timers / highlight groups / global keymaps / which-key labels, and a built-in `.obsidian.vimrc` loader.

## Feature highlights

- **[[text-objects|Markdown text objects]]** — operate on bold, italic, code, math, links, blockquotes, code blocks, tables, and more with standard Vim operators
- **[[structural-navigation|Structural navigation]]** — jump between headings, lists, links, and buffers with `]h`, `]l`, `]n`, `]b`
- **[[lua-config|Lua configuration]]** — `.obsidian.init.lua` with `vim.keymap.set`, `vim.opt` (including `guicursor`), `vim.fn` (including `undotree()`), `vim.api` (buffer APIs, `nvim_set_hl`), `vim.ob` (68 Obsidian-specific functions: metadata, filesystem, UI, cursor, surround, leader), `vim.tbl_*`, `vim.json`, `vim.inspect`, `vim.regex` (ECMAScript RegExp), `vim.schedule`/`vim.uv` timers, 19 autocommand events, buffer-local keymaps, `vim.obsidian.keymap` (global keymaps), `vim.obsidian.whichkey` (which-key labels), async file reading (`vim.ob.fs.read`), multi-file configs via `require()`, fuzzy picker API, and hot-reload on save
- **[[vimrc|Built-in vimrc]]** — `.obsidian.vimrc` loader with 75+ configurable settings and hot-reload on save
- **[[flash|Flash motions]]** — enhanced `f`/`F`/`t`/`T` with jump labels, incremental `s` search, post-commit `/`/`?` labels, clever-f
- **[[easymotion|EasyMotion / Hop]]** — jump to any visible position with two keystrokes
- **[[workspace-navigation|Workspace keyboard control]]** — navigate panes, tabs, and sidebar without a mouse
- **[[surround|Surround]]** — add, change, or delete surrounding delimiters (nvim-surround parity, custom pairs)
- **[[hardwrap|Hard-wrap formatting]]** — Markdown-aware `gq`/`gw` operators
- **[[ex-commands|100+ ex commands]]** — `:sp`, `:vs`, `:e`, `:grep`, `:ob`, fuzzy picker commands, and more
- **[[hint-mode|Vimium-style hints]]** — navigate the entire Obsidian UI with keyboard hints
- **[[undo-tree|Undo tree]]** — branching undo history visualization with `g-`/`g+` chronological navigation, `:earlier`/`:later` time travel, sidebar tree view, and optional persistence

## Get started

> [!tip] New to Vim Motions?
> Start with [[installation]] to install the plugin, then follow [[recommended-setup]] to configure Obsidian for the best experience.

## Quick links

- **[[keybindings|Keybinding cheat sheet]]** — complete reference for all motions, text objects, operators, and commands
- **[[settings|Settings reference]]** — all 100 configurable items with defaults and vimrc equivalents
- **[[known-limitations|Known limitations]]** — architectural constraints and workarounds

## What's new in 1.0.0

- **Optional Neovim backend** — a desktop-only msgpack-RPC connection to your own Neovim 0.12+. Neovim owns text, keys, mode, cursor, registers, undo, folds, dot-repeat and macros, while Obsidian renders: extmarks, virtual text and floating windows become CM6 decorations and positioned overlays, native IME composition is forwarded on commit, and Neovim's messages, command line, popup-menu completion and mode display drive Obsidian's own UI. Opt-in — enabling it runs the binary and configuration you supply as arbitrary code, with no sandbox ([[neovim-backend|Neovim backend]])
- **Obsidian features keep working while Neovim owns the keys** — the picker, Oil, Harpoon, cross-note `<C-o>`/`<C-i>`, marks, workspace splits and tabs, go-to-definition, hint mode, the undo-tree sidebar, and `:ob <command-id>` for any Obsidian command. Structural heading, list and link motions plus 26 Markdown text objects run inside Neovim as treesitter-backed mappings, with native `gq`/`gw` at your configured `textwidth` ([[structural-navigation|structural navigation]], [[text-objects|text objects]])
- **Generate a Neovim configuration from your settings** — **Vim engine → Set up Neovim** translates your enabled features into `nvim-surround`, `dial.nvim`, `spider.nvim`, `yanky.nvim`, `flash.nvim`, `mini.operators` and `LuaSnip` (writing the bundled snippets out beside it), previews exactly what will be fetched and written, and applies only on confirmation ([[settings|settings reference]])
- **Renderer crash fixed** — structural heading motions leaked a `web-tree-sitter` cursor, so garbage collection later freed a tree the editor had already released and corrupted the WASM allocator, segfaulting Obsidian. Measured 24 of 46 runs before the fix and 0 of 16 after. Three further unowned tree-sitter handles in the Lua API were given owners ([[known-limitations|known limitations]])
- **`]h` and `[h` move immediately again** — both had become a prefix of longer mappings and waited out the full 1-second ambiguity timeout before moving. Also fixed: `g-`/`g+` navigating the wrong undo tree, Oil's sort cycling, hidden-file toggle and `y.` register, and Harpoon losing stored cursor positions on same-pane navigation ([[undo-tree|undo tree]], [[oil-explorer|Oil explorer]])
- **Minimum Obsidian version is now 1.8.7** — up from 1.7.2, for the notice styling the Neovim backend needs. Vaults on 1.7.2 through 1.8.6 will not receive this release ([[installation]])

See the [[changelog|full changelog]] for details.
