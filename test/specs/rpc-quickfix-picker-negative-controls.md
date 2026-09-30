# RPC quickfix picker negative controls

Controls for `test/specs/rpc-quickfix-picker.e2e.ts` (**3 passing**). Both
sabotages were restored and the spec returned to 3 passing, 0 failing.

1. **Returning `[]` from the source's `items()`** produced **1 passing, 2
   failing**. `lists Neovim quickfix entries in the picker` and `shows each
entry as a vault-relative path and line` both failed at
   `the quickfix picker to list both seeded entries`. `lists nothing when the
quickfix list is empty` stayed green, correctly — it asserts the empty case
   and cannot distinguish an empty list from a broken source on its own, which
   is why the other two exist.

2. **Returning the absolute path from `vaultRelative()`** produced **2 passing,
   1 failing**, and only the path assertion moved:

    ```
    Received array: ["/tmp/nix-shell.XXXX/test-vault-YYYY/Welcome.md:2",
                     "/tmp/nix-shell.XXXX/test-vault-YYYY/Target.md:1"]
    ```

    Neovim reports absolute paths and Obsidian navigates by vault-relative ones,
    so this is the conversion that silently produces an unopenable entry. The
    assertion pairs an exact `Welcome.md:2` match with
    `not.toContain('/')`, because an exact match alone would still pass if a
    second, absolute entry were present.

## macOS firmlink regression, caught by CI

`shows each entry as a vault-relative path and line` failed on the
`macos-latest` shard while passing on every Linux shard:

```
Expected value: "Welcome.md:2"
Received array: ["/private/var/folders/.../test-vault-S0WuO7/Welcome.md:2", ...]
```

This was a product defect rather than a test artefact. macOS reaches `/var`
through a firmlink to `/private/var`; Neovim resolves it when naming a buffer
and Obsidian's adapter does not, so the prefix test in `vaultRelative()` never
matched and every entry fell back to the "outside the vault" representation —
absolute label, and `onSelect` doing nothing.

The regression is now held by `test/unit/picker/quickfix-path.test.ts` rather
than only by a macOS runner, which required making `vaultRelative()` pure and
taking a base path instead of an `App`. Control: removing the `/private`
normalisation fails exactly the two firmlink cases and leaves the other four
green.
