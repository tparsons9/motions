---
title: Configuration API
description: Read-only Lua definitions and loaded keymap inspection for companion editors.
tags:
    - development
---

# Configuration API

The fork exposes `plugin.configurationApi` separately from editor API v1. Consumers must check `apiVersion === 1` and capability methods; they must tolerate a missing API during unload or older releases. This API does not attach editors or change Vim behavior.

- `definitions()` returns `{ version, text }`, an embedded LuaLS metadata library. API/fn names follow the registered surface; common configuration calls have signatures, other supported calls have permissive signatures, and compatibility stubs are deprecated. Lua 5.3 applies to the bundled runtime; the library is not for native Neovim.
- `snapshot(buffer?)` returns backend, generation, load status, bounded source snapshots, and mappings. Pass the same buffer identity used for editor attachment, including `file:` for CCC external files. Entries carry normalized keys, mode, scope, action/description, origin, optional source path/one-based line, and informational findings.
- `subscribe(callback)` returns an unsubscribe function. Notifications are batched; consumers must dispose subscriptions. Inspector reads never trigger reloads or evaluate Lua. Consumers should also handle editor API ready/unload events and provide explicit refresh for focus, backend, and host-hotkey changes.

Only the bundled backend supports mapping inspection. Unobserved engine/Vimrc mappings have no source location or replacement history. Dynamic/generated chunks may have no source location. Active buffer overlays can conceal an unobserved underlying engine mapping; observation does not temporarily remove overlays to reconstruct it. Host hotkey access is capability-checked and reports unavailable data instead of assuming defaults. Potential host conflicts do not prove which component will handle a key.

Limits are 5,000 observed mappings, 128 loaded sources, and 2 MiB of retained source text. Source text remains in memory and is returned locally so a companion can distinguish loaded configuration from edited buffers. No network requests, persistent snapshots, or source logging are introduced.

## Upstream merge hook inventory

All new analysis lives under `src/configuration/`. Existing-file edits are intentionally limited:

| Hook                  | Purpose                                                                                                          | Evidence                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `main.ts`             | Construct/dispose the optional API and pass its tracker into Lua loading                                         | Static gates; companion lifecycle and inspector E2E |
| `lua/loader.ts`       | Begin/complete generations, bind the source tracker, observe existing callbacks, and release buffer observations | Observer unit tests; real configuration load E2E    |
| `lua/api.ts`          | Optional source metadata on mapping records and capture at existing set entry points                             | Real Lua source-location unit test; exact-line E2E  |
| `lua/obsidian-api.ts` | Capture source for workspace mapping registrations                                                               | Shared observer tests                               |
| `lua/engine.ts`       | Optional named chunk for async configuration compilation                                                         | Lua engine suite and source test                    |
| `lua/package.ts`      | Honor the already-supplied chunk name in sandboxed `load`                                                        | Lua runtime suite and named-module fixture          |

No vendored Fengari, codemirror-vim, key dispatch, mapping precedence, or settings UI changes are required. Keep these hook edits together when rebasing. New APIs remain optional so CCC can ship independently. Editor API v1 and existing command IDs remain unchanged.
