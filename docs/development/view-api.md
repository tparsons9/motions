---
title: Non-editor view API
description: Register focused view scopes, named actions and source-note context in this fork.
tags:
    - development
    - keybindings
---

This fork exposes `window.VimMotions.view` with `apiVersion: 1`. The host retains
its view state and actions; Motions routes keys and renders which-key/status mode.
Listen for `vim-motions:view-api-ready` and `vim-motions:view-api-unload` on window.
Register scopes again when a new API arrives and release them when your plugin unloads.

```ts
const api = window.VimMotions.view;
const off = api.registerAction({
    id: 'paper.next',
    desc: 'Next page',
    run(args, ctx) {
        nextPage(ctx.count || 1);
    },
});
const scope = api.registerScope({
    id: 'paper.reader',
    name: 'Paper',
    defaultMode: 'reading',
    modes: [{ id: 'reading', label: 'Reading' }],
    mappings: [{ modes: ['reading'], lhs: 'j', action: 'paper.next' }],
    fallthroughGlobal: true,
});
const instance = scope.attach({ containerEl, isFocused: () => active });
instance.handleKey('j'); // consumed | pending | unhandled, synchronous
instance.setFocused(active);
// On teardown: instance.detach(); scope.dispose(); off();
```

Mappings resolve as Lua user > dynamic layers > defaults > global fall-through.
`setLayer(name, mappings, groups)` replaces a dynamic layer. `setMode(id, label?)`
clears pending input. Modes may set `noCount`, `noTimeout`, or
`whichKey: 'immediate'`; label menus commonly set all three and `fallthroughGlobal: false` to keep picker keys isolated. Which-key reuses the
configured delay and sorting and adds color swatches and `?` detail expansion.
`cancel()` clears pending input. Focused view mode wins over RPC and editor modes.
Host plugins must report focus changes, including modal focus. A forwarded
`handleKey` call establishes focus even if the host callback still reports false
(for example during an iframe focus transition). Detached instances remain inert.
Scope default actions also suppress global mappings that extend the same prefix
in that mode: `<leader>r` runs immediately instead of waiting for a global
`<leader>rf`. Unrelated global sequences still fall through; Lua scope mappings
retain highest priority.

`registerBufferContext(name, path => objectOrNull)` exposes metadata to Lua through
`vim.ob.context(name)`. Resolvers must be synchronous and return null outside their
source notes. The returned function unregisters the resolver. `runAction(id,args)`
uses the active view context, or a context with `instance: null` when invoked from
a source note; host actions must handle that case. `list` is exposed in Lua.

The API does not observe iframe documents. A same-origin host explicitly intercepts
its iframe keys and calls `handleKey`; cross-origin iframes remain inaccessible.
No new settings are introduced: both existing settings UIs continue to configure
which-key delay, visibility and sorting.

Global fall-through is limited to workspace (`<C-w>`) and leader mappings.
A leader that prefixes a longer sequence opens the menu without executing its
bare action on timeout. Hints use a responsive grid, and immediate-mode hints
return when the host reports focus again.
