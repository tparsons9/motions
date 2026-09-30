---
title: Installation
description: Install the personal Vim Motions fork with BRAT or manually from GitHub releases.
tags:
    - getting-started
    - installation
---

## With BRAT

Add `tparsons9/motions` in BRAT and install the published fork release. The community directory installs the original upstream plugin rather than this fork.

## Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/tparsons9/motions/releases)
2. Create a folder `vim-motions-tparsons9` in `<your-vault>/.obsidian/plugins/`
3. Copy the downloaded files into that folder
4. Restart Obsidian and enable the plugin in **Settings → Community plugins**

## Mobile

The plugin is **disabled by default on mobile**. If you're using a hardware keyboard on a tablet or phone, enable it in **Settings → Vim Motions → Mobile → Enable on mobile** (reload required). You can also toggle it from the command palette: **Vim Motions: Toggle enable on mobile**.

See [[settings#Mobile]] for details and [[known-limitations#Mobile support]] for platform-specific feature availability.

## Verify installation

After enabling the plugin (on desktop, or on mobile with the setting enabled):

1. Open any Markdown file
2. Press `Esc` to enter Normal mode — the status bar should show **NORMAL**
3. Try `]h` to jump to the next heading — if it works, the plugin is active

## Next steps

- See [[recommended-setup]] to configure Obsidian for the best experience, including whether to use the built-in vim engine or the enhanced bundled fork.
- See [[quickstart]] for a 5-minute hands-on guide, including setting up `.obsidian.init.lua` for Lua configuration.

## Personal fork installation

This fork uses plugin ID `vim-motions-tparsons9` and is updated through BRAT using `tparsons9/motions`. The community directory entry belongs to upstream `vim-motions`. See the repository README for migrating the old fork installation, preserving `data.json`, and updating command prefixes. Keep only one Vim Motions implementation enabled.
