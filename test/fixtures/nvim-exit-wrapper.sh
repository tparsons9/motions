#!/usr/bin/env bash
# Records how Neovim exited, because every other channel dies with the
# WebDriver session: the browser diagnostic reports "invalid session id", the
# plugin's own exit Notice becomes unreadable, and NVIM_LOG_FILE stays empty
# since Neovim writes it only for some levels. /proc tells us the child is gone
# but not why.
#
# neovimBinaryPath is a plugin setting, so pointing it here needs no product
# change. The wrapper is named differently from nvim, so the bare name below
# resolves to the real binary on PATH rather than recursing.
set -u

NVIM_EXIT_LOG="${NVIM_EXIT_LOG:-/tmp/nvim-exit.log}"

# Obsidian's spawned environment does not necessarily carry the PATH this
# script was written against, so resolve the real binary explicitly and fall
# back to the bare name only as a last resort.
REAL_NVIM="${NVIM_REAL:-}"
if [ -z "$REAL_NVIM" ]; then
    for candidate in /usr/bin/nvim /usr/local/bin/nvim /opt/homebrew/bin/nvim; do
        [ -x "$candidate" ] && REAL_NVIM="$candidate" && break
    done
fi
[ -z "$REAL_NVIM" ] && REAL_NVIM="$(command -v nvim || echo nvim)"

# exec is load-bearing. Without it the tree is Obsidian -> bash -> nvim and the
# plugin's `child` is the shell, so the SIGKILL in disconnectChild leaves the
# nvim grandchild alive holding the inherited stdio pipes. Node emits 'close'
# only once every write end is gone, so it never fires and the disconnect await
# never settles. exec gives the plugin the real process.
#
# This costs the rc recording, which needed the shell to outlive Neovim, and
# that has already answered its question: healthy teardown records rc=0. Both
# readers of NVIM_EXIT_LOG are guarded and degrade to empty.
exec "$REAL_NVIM" "$@"
