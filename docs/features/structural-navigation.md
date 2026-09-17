---
title: Structural navigation
description: Jump between headings, list items, links, and open buffers with bracket motions that work with counts and operators.
tags:
    - features
    - keybindings
---

Jump between document structures using bracket motions. All navigation motions work with counts (e.g., `3]h` jumps 3 headings forward) and operators (e.g., `d]h` deletes to the next heading).

## Keybindings

![[keybindings#Structural navigation]]

## Headings

`]h` and `[h` jump to the next and previous heading of any level. For level-specific navigation, use `]1`–`]6` and `[1`–`[6` to jump to headings of that exact level (e.g., `]2` jumps to the next `##` heading).

Heading detection uses Markdown syntax — lines starting with `#` characters. Works in both Source mode and Live Preview.

With the Neovim RPC backend, these are buffer-local companion mappings backed by Neovim's bundled Markdown treesitter parser. Counts and operator-pending forms retain the bundled fork's ranges.

## List items

`]l` and `[l` jump between list items at the **same indentation level**. This means nested list items are skipped when navigating at the parent level, and vice versa. Supports all Markdown list types: unordered (`-`, `*`, `+`), ordered (`1.`), and task lists (`- [ ]`).

## Links

`]n` and `[n` jump between links in the document. Matches both wikilinks (`[[...]]`) and standard Markdown links (`[text](url)`).

## Code cells

`]x` and `[x` jump between fenced code blocks, landing on the first line of code rather than the fence. An empty block uses its fence line, so no cell is skipped. Useful in notebook-style notes, where `iC`/`aC` then operate on the cell you landed in.

## Diagnostics

`]d` and `[d` jump between diagnostics, wrapping around the document. Diagnostics come from a plugin that provides them through the [editor provider API](../development/editor-api.md); with none installed, both motions leave the cursor where it is.

## Buffers

`]b` and `[b` cycle through open tabs (buffers), equivalent to `gt` and `gT`. Useful in combination with operators or counts.

## Configuration

Toggle via **Settings → Vim Motions → Structural navigation** or `set navigation` / `set nonav` in vimrc.
