# Intermittently failing tests

Every test that fails intermittently is a defect. The only question is where:

- **Test-side** — the test does not control a precondition, so it sometimes
  exercises the buggy path and sometimes does not.
- **Product-side** — the product is nondeterministic, so the same inputs
  sometimes produce the bug.

There is no third category. An environmental condition outside our control
(GPU compositing, runner speed) is still test-side: the test must assert or
skip on that condition explicitly rather than silently vary.

## Rules

1. **No entry may terminate at "flaky."** That word has repeatedly been used
   in this repository as a synonym for "unexplained," which is how `g-` — a
   real bug that broke the feature for every user after any file switch —
   survived for months looking like noise.
2. **Classification requires evidence.** Either a root cause, or a forced
   failure. Record observed values, not "it failed" (see
   `.agents/skills/negative-control/SKILL.md`).
3. **Forcing failure comes before fixing.** You cannot reliably force a
   failure you do not understand, so a forced failure _is_ the proof that the
   mechanism is known. N green runs never prove determinism; the 110/110 green
   run on `0815d5c` was luck, and the same commit failed twice on re-run.
4. **A fix is proven by the forcing probe going green**, not by CI passing
   once.

## Inventory

| Test                                                                       | Platform        | Observed                | Status                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------- | --------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `g- does not crash at root`                                                | all three       | 4 runs                  | **Resolved — product.** Stale `this.undoTree` captured at registration; `activateUndoTreeForFile()` swaps it per note. Fixed in `ff8442a`.                                                                                                   |
| `zc on callout folds it`                                                   | macOS           | 3/5, then 2/3           | **Resolved — environment.** The CI window starts without OS focus; waiting for it to arrive fixes the suite (0/8 cold failures, 0 skips). 16/16 correlation.                                                                                 |
| `editor:unfold-all clears all folds including custom`                      | macOS           | with the above          | **Resolved — environment.** Same cause.                                                                                                                                                                                                      |
| `cursor follows cursor movement`                                           | macOS           | 2 of last 3             | **Resolved — environment.** Same unfocused-window cause as the fold pair; `document.hasFocus()` matched the outcome 8/8. No link to #181.                                                                                                    |
| `]3 should jump to next H3`                                                | macOS and Linux | 4                       | **Resolved — product.** `isTreeAvailable()` reports a tree exists; `getAllNodesOfType` returns `[]` for one that is absent, stale or freed, and the motion returned the cursor unmoved with no fallback. Fixed in `src/motions/headings.ts`. |
| `the animated cursor picks up a shape change (#181)`                       | macOS           | 1                       | Unknown. Fails on its canvas-paint precondition, not on the scroll defect #181 describes.                                                                                                                                                    |
| `focuses the expected pane in all four directions`                         | macOS           | 3                       | **Focus excluded, three samples.** Latest: `cmFocused` true, focused window, 28-char document, no notices. A test rather than a hook, so possibly distinct from the hook cluster.                                                            |
| `"after each" hook — RPC key delegation`                                   | macOS           | 1                       | Unknown.                                                                                                                                                                                                                                     |
| `"after each" hook — RPC structural navigation`                            | Linux           | 2/5 in CI, ~1/3 locally | Unknown. A cascade, not a cause: the session dies in the preceding test.                                                                                                                                                                     |
| `matches counted operator-pending heading motion edits`                    | Linux           | 1                       | Unknown.                                                                                                                                                                                                                                     |
| `matches backward operator-pending heading motion edits`                   | Linux           | 2                       | Unknown. Primary failure in the run whose afterEach then cascades.                                                                                                                                                                           |
| `matches the fork for operators, visual selections, registers, and counts` | Windows         | 1                       | Unknown.                                                                                                                                                                                                                                     |
| `which-key shows after space press`                                        | Windows         | 1                       | Unknown. Polls 2000 ms for behaviour gated by `operatorshadowtimeout`'s 1000 ms deferral, so the margin is thin by construction.                                                                                                             |
| `a config reload closes an open picker instead of leaking it`              | Windows         | 1                       | Unknown. New in `2b6bc75`.                                                                                                                                                                                                                   |
| `uses the host jumplist for two cross-note older jumps`                    | Windows, Linux  | 2                       | **Focus excluded**: failed with `cmFocused` true and a correct 19-char document.                                                                                                                                                             |

## What "resolved" means for the two product bugs

**`g-`** — defect fixed and guarded. `undo-tree.e2e.ts:168` asserts the live
tree's sequence moves, and its negative control was recorded: the unfixed
build reported `Expected: 19, Received: 20`.

**Vim toggle** — defect fixed, and guarded only at the settings level.
`vim-toggle.e2e.ts` "rapid toggle applies both requests and ends enabled"
fails when the cooldown is un-awaited, so it does catch the mechanism.

Nothing asserts the consequence that actually hurt: that extension-slot
features survive a rapid toggle. An attempt to add one was removed because it
could not be made to fail — with the awaited cooldown reverted it still
passed, since the serialised chain and the deferred callback checks prevent
the drop on their own. A test that cannot fail is worse than none, so it went
rather than staying as decoration.

Closing this properly needs a control that reverts all three parts of
`34168dd` at once, not one of them.

## Fold and canvas hold in production CI

Two consecutive real runs after the focus fixes, `f5d3502` and `80d4918`:
zero macOS failures in either, 99 and 98 jobs green. Every CI shard job is a
cold start, which is the condition that used to break both clusters, so this
is the case they used to fail rather than a warm rehearsal.

Remaining in production: the Linux RPC entries, and one Windows jumplist
failure.

## `]3` is a behavioural failure, not an environmental one

`3848e23` failed it on **Linux**, having previously only failed on macOS, and
the diagnostic added earlier names the difference:

    cursor never reached line 4:
      {"lastObserved":0,"probeKeys":["]","3"],"viaHandleKey":0}

`viaHandleKey` replays the same keys through `Vim.handleKey`, bypassing DOM
delivery. It also leaves the cursor at line 0, so the motion does not move
regardless of how it is invoked. That excludes key delivery, the platform, and
the focus cause behind the fold and canvas clusters.

A heading motion that finds no heading is the shape of structural navigation
running before its heading data exists. `AGENTS.md` records that the heading
provider falls back to regex only when treesitter metadata is unavailable, so
metadata readiness is the first thing to measure.

This one is user-relevant: opening a note and immediately pressing `]3` is an
ordinary thing to do, and nothing here depends on CI.

## The RPC cluster is larger than five entries

Applying the focus fix to `rpc-obsidian-bridge` and `rpc-keys` on the strength
of the fold and canvas results did not help: six cold macOS samples, two
failures, and a different test each time — `keeps source-rendered frontmatter
fully navigable` and `forwards the count from 2<C-o> to the host jumplist`.
`focuses the expected pane in all four directions`, the failure that prompted
the change, did not recur at all.

That is the signature of the Neovim-exit cause rather than an unfocused
window: the failing test moves between runs because whichever test is running
when the child exits is the one that fails. It also means the cluster spans
`rpc-structural-nav`, `rpc-obsidian-bridge`, `rpc-keys` and `rpc-text-objects`
rather than the entries originally listed, and that entry names are a poor
key for it.

The fix was applied from a prior instead of a measurement, which is the
departure that produced this. The change itself is kept because it aligns the
two focus paths, which had unequal strength for no reason, but it resolved
nothing here.

## Why Neovim exits: still open, and how to get at it

Six more cold Linux samples, four failures, `dead:no-proc` confirmed again.
Reading Neovim's own log from the default locations returned nothing: Neovim
writes `stdpath('log')` only for some levels, and the spawned child does not
necessarily resolve the paths guessed from the runner's `HOME`.

The reliable version is to set `NVIM_LOG_FILE` to a known path in the
workflow environment. Obsidian inherits the runner environment and the plugin
spawns the child from Obsidian, so the setting propagates, and the file is
then readable from Node after the session dies.

Two failures also reported an empty pid set with no test state at all, which
means the hook failed before a pid was recorded. Those are a different shape
from the `dead:no-proc` case and should not be counted with it.

An earlier note here claimed the host fails to notice a dead child and that
this was a ready-to-fix defect. Reading the code before fixing showed it is
not: `neovim-connection.ts` registers `child.on('close')`, and `handleClose`
calls `rpc.dispose(new Error('Neovim process exited'))`, which rejects every
pending request, then shows a Notice naming the exit code or signal.

The hang is also not an RPC call. `getEditorValue` runs
`view.editor.getValue()`, which is CM6 only and involves no RPC, so the
renderer is not waiting on Neovim when it stops answering. What makes the
renderer unresponsive around the time the child exits is unknown, and
`spawnSync`-style synchronous work in teardown is the first thing to look
for, since a synchronous block would produce exactly this shape: no completed
long task, a trivial document, and `execute/sync` never returning.

## RPC entries: Neovim exits, and the renderer then hangs

Six cold Linux samples, three failures, and the Node-side process state names
the primary event:

|                               | document                 | Neovim             |
| ----------------------------- | ------------------------ | ------------------ |
| boundaries before the failure | 13-32 chars              | `alive:S`          |
| the failing boundary          | unreadable, session gone | **`dead:no-proc`** |

Two replicas showed it on the same test, `matches counted operator-pending
heading motion edits`. The renderer stall is the consequence, not the cause:
the child exits, and the host is left waiting on a process that is gone.

This is the measurement that browser-side probes could never make. Every
failing replica reported `docLength` and `longtasks` as null, because by the
time `afterEach` ran the session had already died. Reading `/proc` from Node
survives that.

Open and user-relevant: why the child exits. A crash in the companion Lua, an
unhandled RPC message, or the operating system reclaiming it are all live,
and they differ in whether a user can hit them. The 30-second request timeout
added earlier should have rejected the pending call when the stream closed,
so the host's handling of a dead child is worth auditing regardless of the
cause.

## RPC entries: narrowed to a native block

`connectionRetryTimeout` did not fix the stall, but it changed a dead session
with no test name into a clean 180-second abort carrying a stack:

    WebDriverError: The operation was aborted due to timeout on execute/sync
      at getEditorValue (test/helpers.ts:39)
      at forkSnapshots (rpc-structural-nav.e2e.ts:161)

Excluded by measurement since:

- **Document size.** 13 to 32 characters at every test boundary up to the
  failure, so `getValue()` is not walking anything large.
- **A JavaScript long task.** None is ever reported. That is consistent with
  being stuck inside one rather than evidence against it, because a
  `PerformanceObserver` emits a `longtask` entry only once the task finishes —
  reading it as "not JavaScript" would have sent the next round chasing GC and
  IPC for nothing.
- **Neovim being dead.** The child is `alive:S`, sleeping normally, at every
  boundary that reports.

So the renderer stops answering `execute/sync` for 180 seconds with a trivial
document and no completed long task. Browser-side instrumentation returns null
once the session dies, which is precisely when the evidence is wanted, so the
process state is now read from Node and survives.

Local rate is roughly one run in six against four in six on CI, so CI remains
the better sampling ground.

## RPC entries: the connection timeout did not fix them

Six cold Linux samples: four failed. The signature is unchanged --
22 `invalid session id` and 2 `Timed out receiving message from renderer:
30.000`, with no failing test names at all, because the session dies before
any test reports.

`connectionRetryTimeout` addresses the HTTP client's patience. The 30-second
limit in the message is ChromeDriver waiting on the renderer, which that
setting does not govern, so the change could not have helped and the quiet
runs since it landed were normal CI happening not to sample the case.

A renderer that stops responding for thirty seconds is a main-thread block.
If it is our main thread it is a user-visible freeze, so this one is not
dismissible as environment until that is settled.

## UI-lifecycle entries: not reproduced, and three replicas were harness noise

Eight Windows replicas: five ran and all five passed; three died in setup on
`EPERM`, which `e2e.yml` retries and the stress workflow did not, so they
looked like spec failures. The retry is now in both.

Focus was reported on every run rather than only on failures. Locally these
specs show `hasFocus` true with `cm-focused` false and the body as active
element, which is expected since neither puts a cursor in an editor -- so the
discriminator that resolved the fold and canvas clusters does not transfer
here, and applying that fix blind could have passed for the wrong reason.

## Canvas entries: resolved

Focusing the window after the spec's own reload cleared them: eight cold
macOS starts, eight passes, no skips, `document.hasFocus()` true on every one.
Against four and five failures in eight before, each failure unfocused.

Placement was what took two attempts. `beforeSuite` runs before the spec calls
`reloadObsidian`, and the reload discards the focus, so the global wait left
five of eight still failing. The call has to come after the spec's own load,
which is what the fold specs were already doing.

|                                    | cold failures | focus on failures           |
| ---------------------------------- | ------------- | --------------------------- |
| before                             | 4/8, then 5/8 | `hasFocus` false every time |
| focus wait in beforeSuite          | 5/8           | false every time            |
| focus wait after the spec's reload | 0/8           | n/a, all true               |

## Canvas entries: the same unfocused window

Eight cold macOS starts with the environment reported unconditionally:

| replicas      | result | reducedMotion | hasFocus |
| ------------- | ------ | ------------- | -------- |
| 1, 3, 4, 6, 7 | fail   | true          | false    |
| 2, 5, 8       | pass   | true          | true     |

`prefers-reduced-motion: reduce` is active on every macOS replica, passing and
failing alike, so it is incidental. On failure data alone it looked like the
cause, because the give-up diagnostic only ran when the test failed; the
passing rows are what excluded it. `document.hasFocus()` matched the outcome
8 times out of 8.

The failing canvas is present, 1024x676 with a matching client rect, display
block and opacity 1 — it exists, is sized and visible, and is never drawn on.

An earlier note here claimed the canvas specs pass while unfocused and used
that to exclude focus for this cluster. That came from a single run in which
only the fold specs happened to fail, and it was wrong.

The focus wait therefore moved from the fold spec to `beforeSuite`, so every
spec gets it rather than the one cluster that was investigated first.

## Fold pair: an unfocused CI window

`document.hasFocus()` matched the outcome 16 times out of 16 across two runs
of eight cold macOS starts:

|            | hasFocus | cm-focused | callout                      | placeholders | result |
| ---------- | -------- | ---------- | ---------------------------- | ------------ | ------ |
| 9 replicas | true     | present    | editable lines               | 1            | pass   |
| 7 replicas | false    | absent     | `.cm-embed-block.cm-callout` | 0            | fail   |

Without OS focus CodeMirror never registers focus, Live Preview keeps the
callout rendered as a widget, nothing can fold inside it, and the document
content is correct throughout — which is why eleven hypotheses looking for a
macOS-versus-Linux behavioural difference found nothing.

Waiting for focus fixes it. `editor.focus()` cannot raise a window and
`Page.bringToFront` addresses the renderer rather than the OS window, so
neither helped. But focus does arrive on a cold start, just not immediately:
`ensureWindowFocused` retries for five seconds, and the suite then runs in the
focused state the assertions need. The skip is a fallback that should rarely
fire.

Measured across eight cold macOS starts per configuration:

|                        | cold failures | suites skipped                                   |
| ---------------------- | ------------- | ------------------------------------------------ |
| no guard               | 2/8, then 5/8 | —                                                |
| focus sampled once     | —             | 6/8, over-skipping suites that would have passed |
| focus awaited up to 5s | 0/8           | 0/8                                              |

Sampling focus once was itself a defect of the same family as a vacuous
assertion: it reported safety that had never been established, disabling six
suites to absorb a failure rate of two to five in eight.

A user's window is focused while they type in it, so this describes the
runner and not the plugin. **The canvas entries are not explained by it**:
both canvas specs ran on the unfocused replicas and passed.

## Fold pair: cause identified, fix not yet found

Live Preview renders a callout as a `.cm-embed-block.cm-callout` widget and
unrenders it to editable lines only once the cursor is inside. On a cold start
the cursor placement had not taken effect when the fold was attempted, so the
callout was still a widget, no placeholder could render inside it, and `zc`
produced nothing.

Measured, cold versus warm on the same runner and commit:

|                           | cold (fail)                          | warm (pass)                                 |
| ------------------------- | ------------------------------------ | ------------------------------------------- |
| callout / embed elements  | 1 / 1                                | 0 / 0                                       |
| third `.cm-content` child | `div.cm-embed-block.cm-callout[125]` | `div.cm-line…HyperMD-callout…cm-active[24]` |
| `.cm-foldPlaceholder`     | 0                                    | 1                                           |

The obvious fix does not work. Waiting for `.cm-embed-block.cm-callout` to
disappear before folding **times out on a cold start**, turning two failures
into four: `callout line is foldable` and `callout fold placeholder contains
callout type` were passing only because `foldable()` returns a range for a
widget-rendered region, so they were passing vacuously in exactly the state
that breaks the other two. The wait was reverted rather than left on master.

So the callout never becomes editable on a cold start, which means the cursor
never lands inside it — `setupEditor`'s cursor placement is not taking effect
there. That is the next thing to measure: the cursor position and editor focus
immediately after `setupEditor` on a cold iteration, not the callout markup
that follows from them.

`waitUntilFoldable` cannot see this: `foldable()` is a state query and returns
a range while the region is still a widget, so the precondition it checked was
not the precondition the assertion needed. `waitUntilCalloutEditable` waits for
the widget to clear.

Reproduced locally on demand, which no earlier hypothesis managed: placing the
cursor outside the callout gives `embed=1` and the widget element, placing it
inside gives `embed=0` and three `HyperMD-quote-1` lines. That is the cold
state on demand, and it also proves the new wait is not a no-op.

Classified **test-side**: a real user folds a callout with the cursor on it,
which unrenders the widget first.

## The fold pair fails on a cold start, and renders differently when it does

Two stress runs, and both failed on **iteration 1**:

|                       | iter 1 (fail) | iters 2-8 (pass) |
| --------------------- | ------------- | ---------------- |
| `.cm-foldPlaceholder` | 0             | 1                |
| `.cm-line` count      | 4             | 5                |
| content height        | 563           | 490              |
| editor height         | 598           | 598              |
| `getMode()`           | source        | source           |
| `directFoldEffect`    | stuck         | stuck            |

The fold reaches state either way. What differs is rendering: on the cold
iteration the callout occupies fewer line elements and more vertical space,
which is a decorated block rather than plain lines, and no fold placeholder
appears. Mode is `source` in both, so this is not reading view.

**This invalidates how the stress tool's rates should be read.** A shard job
in `e2e.yml` runs wdio exactly once, so every real CI job is iteration 1. A
stress run of N iterations contains one cold start and N-1 warm ones, which
is why the same spec measures ~7% under stress and ~60% in CI. Stress
underestimates any cold-start failure by roughly a factor of N.

Refuted along the way: state accumulation within the spec (`foldable` stays
true after all eight tests), and every earlier platform-difference
hypothesis, since the discriminator is warm-versus-cold on one runner rather
than macOS-versus-Linux.

The remaining question is what the callout is decorated with on a cold start.
The next probe should capture the callout element's own markup and computed
box in both states rather than aggregate counts.

## Next hypothesis for the fold pair: state within the spec

Run `35025641995` failed the fold pair again with a payload identical to every
previous one. Comparing it against the always-on probe in the same file is the
part that had not been done:

- the `before()` hook reports `directFoldEffect: "stuck"` — folding works
- `zc on callout folds it` (test 4 of 8) and `editor:unfold-all` (8 of 8)
  produce no fold at all

Folding therefore works at the start of the spec and stops working later in
the same file, on the same runner, in the same process. That is state
accumulating across tests, not a property of the platform — and it is
consistent with every refuted hypothesis so far, all of which looked for a
macOS-versus-Linux difference.

A probe must record foldability after **each** test in `fold-providers`, on a
runner where it fails, and find the first test after which it stops. All eight
pass locally, so this needs CI or a forced local equivalent of whatever that
test leaves behind.

## Canvas entries are intermittent, confirmed

`cursor follows cursor movement` passed on macOS in `35008278154` and failed
on macOS in `35025641995`, with no code change between them affecting it. It
is intermittent on that runner rather than impossible there.

## RPC entries after the connection timeout

Two consecutive runs (`35008278154`, `35025641995`) contain no RPC failures,
against three of five before `9fda566`. Encouraging and far from proven; the
prior green run `0815d5c` was followed by two red ones on the same commit.

## Runner capability, measured

|                    | Linux       | macOS    | Windows     |
| ------------------ | ----------- | -------- | ----------- |
| cores              | 4           | 3        | 4           |
| device memory      | 8 GB        | 8 GB     | 8 GB        |
| WebGL              | SwiftShader | **none** | SwiftShader |
| `directFoldEffect` | stuck       | stuck    | stuck       |

macOS is the only runner with no WebGL context, and the only one where the
canvas entries fail. That is suggestive, but it is **not** a capability wall:
`9fda566` added `canvasPaintSupported`, which skips a canvas spec when 2D
paint and readback are unavailable, and across 36 macOS jobs in run
`35008278154` it never fired. Both canvas tests ran and passed there.

So the canvas entries are intermittent on macOS, not impossible on macOS, and
"a runner artifact that cannot affect real users" is **not** established.

Note the guard checks an offscreen 2D readback, which is weaker than what the
feature needs (an onscreen composited canvas). It not firing rules out the
strongest form of incapability, not every form.

Fold works on all three runners, so no graphics explanation applies to it.

## The renderer tab crashes after going unresponsive for 30 s

The driver log says it outright:

```
chromedriver: [SEVERE]: Timed out receiving message from renderer: 30.000
webdriver: WebDriverError: unknown error: session deleted because of page crash
from tab crashed
```

The `obsidian` process count goes 3 -> 6 and never reaches 0, so the main
process is fine; it is the **renderer** that dies. No Crashpad `.dmp` is
written, and `dmesg` is not readable inside the container, though an OOM kill
was already excluded at 852 MiB peak against 8 GiB.

That is the whole chain, and it makes every earlier observation consistent:

1. the renderer main thread blocks
2. ChromeDriver gives up at its 30 s renderer timeout
3. the tab is declared crashed and the session is deleted
4. every later `executeObsidian` returns `invalid session id`

Steps 3 and 4 are what the section below describes, and they are downstream.
The single 78 s `waitRpcOff` throw was not the anomaly I dismissed it as: a
renderer blocked long enough to trip a 30 s driver timeout is exactly a single
`getRpcState()` round trip taking tens of seconds. Both readings were the same
event seen from different ends.

So the question is now specific and answerable: **what blocks the renderer main
thread for more than 30 s?** An unresolved Promise cannot do it, so something
synchronous is running. This spec exercises treesitter-backed structural
motions with WASM grammars alongside RPC, which is where to look first --
a synchronous parse or query loop is the shape that fits. The remaining
measurement is a main-thread profile or a sampling stack at the moment the
driver's 30 s timer starts, not more environment permutation.

## The RPC cluster is the WebDriver session dying

Reading the actual error instead of counting passes and failures settles it.
Three consecutive failing container runs, identical error, different call site:

```
WebDriverError: invalid session id when running "execute/sync"
  at async rpcSnapshots   (run 1)
  at async waitForRpc     (run 2)
  at async getNotices     (run 3)
```

The session is **gone**, so every later `executeObsidian` fails instantly. That
is why the count is always exactly `2 failing`: the test that first touches the
dead session, plus the `after each` hook that touches it next. The test _name_
varies only by when the death lands, which is the whole reason this looked like
six unrelated flaky specs with a rotating cast of failures.

So it is not a hang, not teardown, and not an RPC problem. Obsidian or its
renderer is dying mid-run, and everything downstream is an artefact of asking a
dead session questions.

This also corrects the section below. The 78 s `waitRpcOff` throw was one
atypical instance and I generalised from it; `did not become disconnected` did
not recur in any of the **nine** runs after it. The two `disconnectChild`
defects found along the way are real and are fixed, but they are not this
cluster: with both fixed, 3 of 5 runs still failed, against a baseline near 2
in 3.

Not yet known: why the process dies. Memory is already excluded (852 MiB peak
against 8 GiB, and the cgroup figure falls during a run), so this is not an OOM
kill. The open candidates are an Electron renderer crash under Xvfb, a
ChromeDriver-side session timeout, and a main-process crash. The next
measurement is the ChromeDriver log, the Electron exit code and `dmesg` from
inside the container, none of which have been looked at yet.

Worth noting for whoever picks this up: the failure names were available from
the first container run and I spent this phase counting `N passing / N failing`
instead of reading them. The error was one `grep` away the whole time.

## The RPC cluster is teardown, not a renderer death

Timing every step from Node — `STEP n start/ok/THREW <label> <ms>`, so a call
that starts and never finishes names itself — caught it in the act:

```
STEP 161 ok    rpc:getLines0      6ms
STEP 162 ok    rpc:getCursor0     5ms
STEP 163 ok    fork:rpcOff       22ms
STEP 164 THREW fork:waitRpcOff  78147ms
```

Every RPC request runs in 5-6 ms and `getValue`/`getCursor` in 2-4 ms right up
to the end. There is no latency creep and no gradual degradation: the failure
is abrupt, and it is `waitForRpc(false)` — waiting for the backend to report
_disconnected_ — hanging and throwing.

That explains the shape of the whole cluster. Half of these failures land in
`before each`/`after each`, which is exactly where `setRpcEnabled(false)` and
`waitForRpc(false)` run, and it is why the failing _test name_ varies from run
to run while the specs stay the same. It also fits the exit wrapper reporting a
clean `rc=0`: the child does exit correctly, just far too slowly.

The 78 s is itself evidence. `waitForRpc` has a **10 s** timeout, and
`browser.waitUntil` only checks the clock between iterations, so a 10 s budget
can overshoot to 78 s only if a single `getRpcState()` round trip blocked for
roughly 68 s. The renderer was unresponsive during teardown — which is what the
earlier "stall inside `executeObsidian`" reading was seeing, from the wrong end.

`disconnectChild` in `src/rpc/neovim-connection.ts` has two defects that fit:

1. `await this.featureBridge?.stop()` is the **first** statement, and it issues
   RPC round trips to a Neovim that is on its way out. `this.connected = false`
   is not reached until ~20 lines later, so every observer keeps seeing
   `connected === true` for however long that await takes. `waitForRpc(false)`
   is one such observer.
2. The close-Promise settles **only** via `child.once('close', ...)`. The
   `GRACEFUL_EXIT_TIMEOUT_MS` timer sends `SIGKILL` but never resolves, so if
   `close` does not arrive the await is permanent. This is the inverse of the
   `promise-owned-listener` shape the project's own ast-grep rule targets, and
   worth checking against the test harness: `neovimBinaryPath` points at
   `nvim-exit-wrapper.sh`, and unless that wrapper `exec`s, `SIGKILL` on the
   shell leaves an `nvim` grandchild holding the inherited stdio pipes open,
   which is precisely a `close` that never fires.

Not yet proven: which of the two produces the 68 s renderer block, and whether
an unresolved Promise alone can account for it (it should not — an orphaned
Promise does not block a main thread, so something synchronous is still
unexplained). Clearing `connected` before the awaits and giving the Promise a
settle path are both correct regardless, and the second is testable directly by
checking whether the wrapper `exec`s.

The wrapper mechanism is real and was fixed, and it is **not** the cause. The
wrapper ran `"$REAL_NVIM" "$@"` without `exec`, so the tree really was
Obsidian -> bash -> nvim with the shell as the plugin's `child`, and the
grandchild really would hold the pipes open past a `SIGKILL`. Converting it to
`exec` did not move the failure rate: **2 of 4 runs still failed**, against a
baseline of roughly 5 in 7. Those two rates are indistinguishable at this
sample size, and two clean runs is precisely the evidence that made
`--privileged` look like an answer an hour earlier.

Neither of those two failures carried `did not become disconnected`, so at
least one failure mode exists that is not the teardown hang. The 78 s hang was
observed once, is real, and is not the whole cluster.

What stands regardless of flakiness: the `exec` fix, because the plugin should
own the real process rather than a shell that swallows its signals; and the two
`disconnectChild` defects above, because clearing `connected` after an awaited
call that can hang, and a Promise whose only settle path is an event that may
never arrive, are both wrong on their own terms.

Reproducing: wrap each step of `forkSnapshots`/`rpcSnapshots` in a `timed()`
helper that logs from Node, run the container loop, and read the last STEP line.

## No container setting explains it, and privileged was luck

Seven axes, one run each unless noted, against a baseline that fails roughly
seven times in ten:

| Axis                                          | Result                   |
| --------------------------------------------- | ------------------------ |
| baseline `--cpus=4 --memory=8g --shm-size=2g` | fail                     |
| `--security-opt seccomp=unconfined`           | fail                     |
| `--ipc=host`                                  | fail                     |
| `--privileged`                                | 1 clean, then **2 fail** |
| `--cap-add=SYS_ADMIN`                         | fail                     |
| `--security-opt apparmor=unconfined`          | fail                     |
| no cpu or memory limits                       | fail                     |

The single clean `--privileged` run looked like the answer and was not. At a
baseline failure rate near 70%, one clean run is a coin toss; the two
confirmation runs settled it. The same mistake as concluding "memory" from one
4 GiB failure and one 8 GiB pass an hour earlier — a reminder that the
confirmation run is not optional when the base rate is this high.

So the container is not reproducing the bug _through_ any setting. It is
reproducing it because it is a different and slower execution environment, and
the bug is timing-sensitive. Capabilities, seccomp, apparmor, IPC namespace,
`/dev/shm` and cgroup limits are all eliminated.

What the container gives is the thing that was missing for the whole
investigation: a five-minute reproduction at roughly 70%. The mechanism is
still unidentified, and the next step is to use that loop for timing
instrumentation inside a failing run rather than for more environment
permutations, which have now been exhausted.

## Reproduced locally in a resource-constrained container

Running the real spec inside the CI image with `--cpus=2 --memory=4g`
reproduces it on demand: two runs, both 10 passing and 2 failing, both with
`invalid session id` and one naming
`matches navigation across nested list items` and the `"after each"` hook.

```
docker run --rm --cpus=2 --memory=4g --shm-size=2g \
  -v "$PWD:/work" -w /work -e CI=true \
  --entrypoint bash ghcr.io/saberzero1/motions/e2e-runner:latest -lc '
    Xvfb :77 -screen 0 1280x1024x24 & sleep 3; export DISPLAY=:77
    herbstluftwm & sleep 1
    npx wdio run ./wdio.conf.mts --spec test/specs/rpc-structural-nav.e2e.ts'
```

The image's own entrypoint fails to start Xvfb on `:99` under a bind mount, so
the display is started by hand on `:77`.

It reproduces in the container, not because of any particular limit: 5 of 7
container runs failed against roughly one in six on the host. The container is
the trigger, and it is also what CI uses, which is the point.

Eliminated by measurement while looking for the limit that mattered:

| Candidate                 | Measurement                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| total memory              | peaked at **852 MiB** against an 8 GiB cap, and 8 GiB runs fail too                                             |
| memory growth             | cgroup `memory.current` _declines_ over a run, 682 → 575 MiB                                                    |
| `/dev/shm`                | fails identically at `--shm-size=256m` and `8g`                                                                 |
| CPU count                 | fails at both 2 and 4 cores; the one clean container run was 2 cores                                            |
| process or handle buildup | `obsidian` holds at 6 processes from early to late in a run that failed; `esbuild` at 2; zombies never exceed 1 |

The buildup hypothesis was worth testing and is **not supported**. An earlier
reading of "obsidian 3 → 10" came from a sampler whose `pgrep -c ... || echo 0`
split each record across two lines; with that fixed the count is flat, and the
3 was startup ramp rather than a leak.

So the mechanism is still unidentified — but the loop is now five minutes
instead of forty-five, which is the thing that was missing all along.

## Bisect of the RPC cycle against its surroundings

Each variant is six cold Linux replicas at twelve cycles, so 72 cycles per row,
on the platform where the full spec fails about four runs in six.

| Variant            | Adds                                                | Result                                      |
| ------------------ | --------------------------------------------------- | ------------------------------------------- |
| `bare`             | nothing                                             | 72/72 settled                               |
| `workspace`        | `loadSingleFileWorkspace` per cycle                 | 72/72 settled                               |
| `workspace+source` | …plus `useSourceProperties`                         | 72/72 settled (Linux), 6/6 replicas (macOS) |
| `editor`           | …plus `setupEditor`, cursor moves, `getEditorValue` | 72/72 both platforms                        |

About 432 cycles across four variants and both platforms without a single
failure. Decomposition is exhausted: no element of the connect/disconnect path,
the workspace load, source properties, or the editor work reproduces the
failure, on either platform, and the `editor` variant calls the very function
the stall lands inside.

So the failure needs something none of the variants has: most likely the volume
and interleaving of the real spec — fourteen tests, dozens of RPC round trips,
repeated connect and disconnect under sustained load — rather than any single
element of it. Four clean decompositions are themselves the finding.

The next step is therefore to stop decomposing and stress the real spec, which
is the only configuration known to fail and already carries the Node-side
instrumentation: `/proc` state, the wrapper's exit status, and the per-test log
delta, none of which the browser-side diagnostic can reach once the session
dies.

The same variant now runs on macOS with nothing else changed, since a clean
Linux bisect says nothing about the platform where most recent failures land.

Note the platform split: the bisect runs on Linux, while recent failures have
been macOS RPC hooks — `"after each" hook for Neovim RPC connection lifecycle`
and `… key delegation` on `d09d53e`. The cluster spans both, so a Linux bisect
that stays clean does not exonerate the macOS side; if `workspace+source` also
settles, the next variant should carry the editor work, and a macOS dispatch is
worth running alongside it.

## The RPC failures are concentrated in setup and teardown

Across seven runs, every RPC-related failure:

| Failure                                                  | Count | Kind |
| -------------------------------------------------------- | ----- | ---- |
| `"after each"` — structural navigation                   | 3     | hook |
| `"before each"` — structural navigation                  | 1     | hook |
| `"after each"` — text synchronisation                    | 1     | hook |
| `"after each"` — key delegation                          | 1     | hook |
| `matches backward operator-pending heading motion edits` | 2     | test |
| `keeps source-rendered frontmatter fully navigable`      | 1     | test |
| `uses the host jumplist for two cross-note older jumps`  | 2     | test |

**Half are hooks, across three different specs**, and the failing tests vary
between runs rather than repeating. So no consistent subset of tests is at
fault; what the hooks share is `setRpcEnabled` and `waitForRpc` — starting and
stopping Neovim.

**The cycle alone is exonerated.** Six cold Linux replicas ran twelve
connect/disconnect cycles each — 72 in total, on the platform where the full
spec fails about four runs in six — and every one settled:

    {"cycles":"UD UD UD UD UD UD UD UD UD UD UD UD","completed":12,"settled":true}

repeated for all six replicas. If the cycle carried the failure probability,
72 of them would not come back clean.

So starting and stopping Neovim is not fragile in itself. The cause is an
interaction with what the real hooks put around it:
`loadSingleFileWorkspace`, `useSourceProperties`, and editor work between
cycles.

That is a bisect rather than a search. Add one element back at a time — the
workspace load first, since it is the heaviest and touches the same editor the
stall appears in — and the first variant that fails names the interaction.

## Neovim is not crashing, and the exit may be incidental

The wrapper answered on its first failing run:

    RPCTASKS {"after":"matches navigation across nested list items",
              "tasks":null,"nvim":[],"nvimLog":"",
              "nvimExit":"21:30:33 pid=3486 rc=0"}

`rc=0`. Not 139 for SIGSEGV, not 137 for a kill, not an error code. **Neovim
is not crashing**, so a crash in the companion Lua, a fatal signal and the OOM
killer are all excluded.

That also undermines the causal story recorded earlier. `rc=0` is exactly what
a healthy disconnect produces — passing runs record the same — and
`beforeEach` calls `setRpcEnabled(false)`, which shuts Neovim down on purpose.
So the earlier claim that the child exits and the renderer hang follows from it
is **not supported**: a clean exit at a teardown boundary is indistinguishable
from the teardown itself, and `dead:no-proc` was consistent with normal
shutdown all along.

What remains is the original question in its earlier form: why does the
renderer stop answering `execute/sync`? Known about it:

- no completed long task, which is consistent with being stuck inside one
- a trivial document, 13 to 32 characters
- no RPC request pending, since `getEditorValue` is CM6 only
- Neovim exiting cleanly rather than dying

The next measurement should establish whether the exit precedes the stall or
follows it, because the current data cannot order them. A timestamp on the
renderer's last successful call, compared against the wrapper's exit line,
would do it.

## What identifying the RPC cause still needs

The remaining question is why the Neovim child exits, and every channel we
have dies with the WebDriver session:

| Channel                  | Result                                                  |
| ------------------------ | ------------------------------------------------------- |
| browser diagnostic       | `unavailable: invalid session id`                       |
| Node `/proc`             | `dead:no-proc` — gone, not why                          |
| `NVIM_LOG_FILE`          | empty; Neovim writes it only for some levels            |
| the plugin's exit Notice | computed correctly, unreadable once the session is gone |

`neovimBinaryPath` is a plugin setting, so pointing it at a wrapper that
records the child's exit status needs no product change and survives the
session. `test/fixtures/nvim-exit-wrapper.sh` does that, and standalone it
passes arguments through and records the status.

The first wiring attempt failed with 2 failing, 0 passing and an empty exit
log. The PATH theory offered for it was wrong; capturing the error named the
real cause in one run:

    javascript error: resolvePath is not defined

`resolvePath` had been called inside the `executeObsidian` callback, which
runs in the browser where `node:path` does not exist. The path is now resolved
in Node and passed as an argument.

It works: the spec stays at 14 passing and the exit log fills with `rc=0`
entries, so the wrapper is genuinely running rather than silently absent. A
healthy disconnect is a clean exit; a signalled child reads as 128+signal, so
a crash and an orderly quit are distinguishable from that one number.

Confirming the instrument ran, rather than inferring it from the absence of
failures, is what separated this attempt from the last one.

## After the heading fix

`83bd881` carried the fix and failed three jobs; `871639a` on top of it was
110/110 green. **No heading motion failed in either** — not `]3`, `]h` or
`[h` — which is the first evidence the fix holds in CI rather than only under
the forced empty tree.

The three failures were all known shapes, plus one new entry:

- Linux `"after each"` and `matches backward operator-pending heading motion
edits`, the latter reporting `unavailable: invalid session id` — the
  child-exit cluster, where the browser diagnostic cannot run by definition.
- Windows `uses the host jumplist for two cross-note older jumps` with
  `cmFocused` true and a 19-character document. That is the second such
  sample, so focus is excluded for it on repeated measurement rather than one
  observation.
- macOS `keeps source-rendered frontmatter fully navigable`, an RPC spec.
- Linux `vim.plugins.add fetches mini.comment from GitHub`, which fetches over
  the network during the test. Its diagnostic is unremarkable — focused
  window, no editor open — so a fetch failure is the likely shape rather than
  anything in the editor, and it belongs with the installer failures as
  infrastructure rather than with the rest.

## The recurring shape: a guard that checks something adjacent

Three defects this session share one form — a check that answers a question
_near_ the one the code depends on:

| Where                              | Checked                            | Needed                                |
| ---------------------------------- | ---------------------------------- | ------------------------------------- |
| `waitUntilFoldable`                | `foldable()`, a state query        | the region rendered as editable lines |
| `isTreeAvailable` in `headings.ts` | a tree exists                      | the tree yields headings              |
| `callout fold placeholder…`        | an `if` guard around the assertion | the assertion running at all          |

Each passed while the thing it protected was broken, which is why all three
survived so long.

**Audited the treesitter consumers for the same shape.** Only headings had it.
The other four decide on the _result_ rather than the predicate and are
correct as written:

| File                         | Shape                                                  |
| ---------------------------- | ------------------------------------------------------ |
| `text-objects/code-block.ts` | `treesitterCodeBlock(...) ?? findContainingBlock(...)` |
| `text-objects/blockquote.ts` | `treesitterBlockquoteRange(...) ?? …`                  |
| `text-objects/delimiter.ts`  | `if (tsRange) return …;` then the regex path           |
| `snippets/context.ts`        | `if (tsResult) return tsResult;` then the regex path   |

A wider scan for readiness-style predicates gating behaviour found only
`isEnabled() || isInsertMode()` in `snippets/tab-expand.ts`, which is a
feature gate rather than a fallback decision.

So the product side is clean apart from the one fixed. The shape recurs mostly
in **test** code, where a wait or a guard stands in for the real
precondition — worth suspecting first whenever a test passes in a state that
should have broken it.

## `]3`: resolved, and it was every heading motion

`isTreeAvailable(view)` answers whether a tree exists, not whether it yields
headings. `getAllNodesOfType` returns `[]` for a root that is absent, stale or
already freed, so `treesitterHeadingMotion` returned the cursor unmoved — and
the regex fallback never ran, because the choice had already been made by
`isTreeAvailable`.

The same shape as `waitUntilFoldable`: a guard checking something adjacent to
what the code actually needs.

Negative control, forcing the treesitter path to yield zero headings:

|                                  | result               |
| -------------------------------- | -------------------- |
| empty tree, with the fallback    | 16 passing           |
| empty tree, without it (pre-fix) | 8 passing, 8 failing |

The failures were `]h`, `[h`, `]h with count` and the level-specific motions,
so the defect was never specific to `]3` — every heading motion fails while
the tree is unavailable, and `]3` was whichever test ran at the wrong moment.
That is also why it looked intermittent and crossed platforms.

User-visible: open a note and press `]h` before the parse settles.

## The global diagnostic classified two entries on its first run

`203ba65` is the commit that added it, and its four failing jobs were nearly
discarded as superseded. Two carried the payload:

    ]3 should jump to next H3
      cmFocused true, docHasFocus true, docLength 25,
      no callout widget, no cursor canvases

    uses the host jumplist for two cross-note older jumps
      cmFocused true, docHasFocus true, docLength 19

**Focus is excluded for both.** They failed with the editor focused and the
document correct, so the cause behind the fold and canvas clusters does not
apply.

For `]3` that settles the classification. The editor is focused, the document
is the expected 25 characters, and the motion still does not move — already
known not to be key delivery, since `viaHandleKey` leaves the cursor at line 0
as well. It is a behavioural defect, and an ordinary one to hit: open a note
and press `]3`.

The other two failing jobs were the macOS RPC key-delegation hook, which
reports nothing because the session is gone, and a Windows **Install pinned
Neovim** step, which never ran a test at all.

So one run classified two entries, confirmed a third as the RPC shape, and
contained one failure that was not a test failure — none of which needed a
round trip to interrogate.

## First eliminations from the forced matrix

`d5ab229` came back 110/110 green, so it offered nothing to diagnose. The
forced conditions do not need a failure to be useful.

**Focus is excluded for `which-key shows after space press` and `a config
reload closes an open picker instead of leaking it`.** Blurring the active
element before the suite left both passing, 12 and 10. They also sit at
`activeEl BODY` with `cm-focused` false in normal operation, because neither
puts a cursor in an editor, so they are already unfocused when they pass.

That is two entries and one condition closed in a single local run, with no
CI involved. Eliminations are permanent: these two never need testing against
focus again, whatever else they turn out to be.

Remaining for them: cold start, and whatever is not yet on the list. Several
of the other unidentified entries live in RPC specs, where the child-exit
cause is the more likely explanation than any of these.

## Identifying the rest without waiting for CI to fail

Three failure conditions are now known, and each can be applied deliberately
instead of sampled:

| Condition          | How to force it                         |
| ------------------ | --------------------------------------- |
| editor not focused | blur the active element                 |
| cold start         | one iteration per job, several replicas |
| Neovim child gone  | kill the tracked pid mid-test           |

The first is demonstrated. Blurring `document.activeElement` put the callout
back into `.cm-embed-block.cm-callout` immediately, locally, on the first
attempt:

    focusedBefore True  widgetBefore False
    focusedAfter  True  widgetAfter  True

Note `document.hasFocus()` stayed true throughout. The discriminator is
CodeMirror focus rather than window focus; the window mattered only as a
precondition for it, and blurring the element reaches the same state directly.
That also makes the condition reproducible on a developer machine, which the
window-level version was not.

So the remaining entries do not need CI to fail by chance. Run each suspect
spec under each forced condition: whatever fails is identified, and whatever
survives all three is genuinely something else and can be separated from the
pile. That converts an open-ended wait into a finite matrix of
specs x conditions.

## Do the entries share a cause?

Two structural factors were checked and neither discriminates:

- **Position in the spec file.** Spread evenly (4/8, 8/8, 4/7, 11/16, 2/2,
  11/29, 10/14, 5/14, 1/1, 2/12, 7/10, 24/29), so this is not per-spec setup
  hitting the first tests.
- **Synchronisation style.** `zc on callout folds it` has seven `browser.pause`
  calls and four `waitUntil`s and fails; `which-key`, the operator-pending pair
  and the jumplist entry have none of either and fail too.

What does partition cleanly is the subsystem each one waits on, and it
correlates with platform:

| Cluster         | Entries                                        | Asserts on                                  | Platform         |
| --------------- | ---------------------------------------------- | ------------------------------------------- | ---------------- |
| Rendering/paint | fold pair, animated cursor pair                | CM6 decorations, canvas pixels              | all macOS        |
| RPC lifecycle   | structural-nav pair, text-objects, bridge pair | cross-process parity; two are hook failures | Linux-dominant   |
| UI lifecycle    | which-key, picker leak, pane focus             | transient overlay, modal, focus             | Windows-dominant |

Every entry asserts on state an asynchronous subsystem must produce in
reaction to an event, never on synchronous in-memory state. That is necessary
but not sufficient — most passing e2e tests do the same.

The clustering argues against a single root cause. Treat the three groups as
three investigations, and force each at the conditions its own cluster runs
under.

## Two runs of one commit share no failures

`2b6bc75` was run twice with no code change between them:

| Run A                                                                   | Run B          |
| ----------------------------------------------------------------------- | -------------- |
| `"after each" hook — RPC structural navigation` (Linux)                 | —              |
| `matches backward operator-pending heading motion edits` (Linux)        | —              |
| `zc on callout folds it` (macOS)                                        | —              |
| `editor:unfold-all clears all folds including custom` (macOS)           | —              |
| `a config reload closes an open picker instead of leaking it` (Windows) | —              |
| `uses the host jumplist for two cross-note older jumps`                 | Windows, Linux | 2   | **Focus excluded**: failed with `cmFocused` true and a correct 19-char document. |

The sets are disjoint. Whatever selects the failures on a given run, it is not
the commit, so a single green run says nothing and a single red one identifies
only which test drew the short straw that time.

Measured across the five runs containing `34168dd`: the fold pair failed in
three and the RPC structural-nav pair in three, both matching their pre-fix
rates. That is the basis for saying the toggle fix did not touch them.

## What each diagnostic can and cannot see

`NVIM_LOG_FILE` is one path per runner, so it is isolated across shards but
shared by every test inside a job, and this spec starts a fresh Neovim per
test. Reading the tail would therefore attribute an earlier test's bytes to
the failure; `afterEach` records the file offset at the start of each test and
reads only the delta.

It may still yield nothing. A local reproduction with the variable set left
the file at zero bytes, because Neovim writes that log only for some levels,
so a crash need not appear in it at all.

The plugin already derives the exit reason itself: `handleClose` formats the
code or signal into a Notice. The global `afterTest` diagnostic reads visible
Notices for that reason.

But the browser-side diagnostic cannot run at all when the session has died,
which is exactly the RPC failure mode: it reports `unavailable` and nothing
else. The division is therefore:

| Failure shape                       | What sees it                                          |
| ----------------------------------- | ----------------------------------------------------- |
| session survives (fold, canvas, UI) | `afterTest` FAILDIAG, including Notices               |
| session dies (RPC)                  | Node-side `RPCTASKS`: `/proc` state and the log delta |

Neither alone covers both, which is why both exist.

## A red job is not always a failing test

Run `d162ff1` showed three failing macOS jobs. Two of them failed at
**Install pinned Neovim**, after 0 and 1 minutes, before any test ran; only
the third reached the suite. Reading the count as three test failures
overstates the problem by a factor of three.

The failure summary runs after wdio, so a job that dies in setup produces a
red square with no summary at all, which looks the same at a glance as a test
failure that reported nothing. Check the failing **step** before the failing
test: `.steps[] | select(.conclusion=="failure") | .name`, or simply the job
duration, since a setup failure is over in about a minute.

Worth adding to the reporting: name the failing step in the summary, so
installer and network failures are separable from test failures without
opening the job.

## Shard numbers do not identify specs

`e2e (macos-latest, shard 3)` reported `cursor follows cursor movement`, but
that test is defined in `animated-cursor.e2e.ts`, which the same round-robin
places in shard 1; shard 3 holds `animated-cursor-scroll.e2e.ts`, which does
not define it. Recomputing the discover job's distribution locally therefore
does **not** reliably reproduce the mapping a given run used.

Read the failing test name from the job log or the step summary. Do not infer
the spec from the shard index, and do not infer a root cause from the spec you
think the shard contains — that is how the #181 attribution above was made.

## Fold providers lost by the vim-mode toggle

Refuted first, so they are not re-tested:

| Hypothesis                       | Measurement                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Key delivery                     | `viaCommand: true, foldedAfterCommand: false` — folding fails through Obsidian's own `editor:toggle-fold` too |
| Degenerate provider range        | `range {from:39,to:88}`, `degenerate: false`                                                                  |
| Viewport too small to parse      | `viewport {from:0,to:106}` over a 106-character document, `viewportCoversLine: true`                          |
| Fold applied but not detected    | `foldedRanges: []`, `placeholders: 0`                                                                         |
| CM6 folding unavailable on macOS | `directFoldEffect: "stuck"` on all three platforms                                                            |
| Obsidian version                 | 1.13.7 on macOS and Linux alike                                                                               |
| Window size                      | 8/8 folds at 1024x676 (macOS CI), 1274x984 (Linux CI), 2538x1380                                              |
| Runner slowness                  | 40/40 folds at CPU throttle 1x, 4x, 8x, 16x, 32x                                                              |

Forced by replaying what `wdio.conf.mts` does before **every** spec — disable
vim, pause, enable vim, pause:

```
pause 800ms -> 6/6 folded (FFFFFF)
pause 200ms -> 3/6 folded (.F.F.F)  foldableMisses: 3
pause  50ms -> 3/6 folded (.F.F.F)  foldableMisses: 3
pause   0ms -> 3/6 folded (.F.F.F)  foldableMisses: 3
```

`foldableMisses` equals the failure count exactly: when it fails,
`foldable()` returns null, so `zc` correctly folds nothing. Isolating the
toggle from the editing:

```
baselineFoldable: true -> afterEachCycle: "FFFFFFFF" -> afterSettle3s: false
```

Folding does not recover. A user who toggles vim mode loses folding until
Obsidian reloads.

### Mechanism, as far as it is established

```
disable0 -> vimEnabled false
enable0  -> false            <- fails when it follows a real disable
settled0 -> false, foldable false
disable1 -> false (no-op)
enable1  -> true,  foldable true   <- succeeds when it follows a no-op
```

`enableVim` fails only when it follows a _real_ disable, so `disableVim()`
resolves before its teardown has finished: there is un-awaited async work
continuing past the returned promise, and the enable races it.

Two fixes were attempted and **both proven insufficient**, so neither shipped:

1. Serialising toggles through a promise chain — `FFFFFFFF`, unchanged.
   Serialising on a promise that settles too early cannot help.
2. Deferring the `settings.vimEnabled` check out of the command callbacks —
   `FFFFFFFF`, unchanged. It does fix a real secondary defect
   (`enable-vim-mode` reads the flag synchronously, so with a disable pending
   the enable was never queued at all), but not this.

### The toggle defect is real but is not this cause

`34168dd` fixed a genuine, user-facing bug: a rapid disable/enable left Vim
off and every extension-slot feature unregistered until Obsidian reloaded.
Forced deterministically before the fix, `TTTTTTTT` after it.

It did **not** fix the fold failures. `zc on callout folds it` and
`editor:unfold-all` failed again in `953c8e6` and `4b688c6`, both of which
contain the fix, at roughly the pre-fix rate.

The error was an inference, not a measurement. The forced reproduction used a
**0 ms** gap between disable and enable; at the **800 ms** gap `wdio.conf.mts`
actually uses, the _unfixed_ code folded 6/6. Claiming CI was affected
required assuming a slow macOS runner makes 800 ms behave like 0 ms, which
was never measured and is now refuted.

The fold cause is therefore still unknown, and this is the eleventh refuted
hypothesis for it. Anything proposed next must be forced at the gap CI
actually uses.

### Toggle fix detail (`34168dd`)

Both `disableVim` and `enableVim` cleared `toggleInProgress` from a 500 ms
timer armed in `finally`, so the returned promise resolved while the flag was
still set. The opposite toggle, arriving inside that window, hit its own guard
and was discarded with nothing to retry it.

Three changes were needed, and each was individually insufficient:

1. **Await the cooldown** before clearing the flag, so the promise reflects
   completion. The chain alone still resolved into the window.
2. **Serialise toggles** through a promise chain, so the next starts after the
   previous finishes.
3. **Defer the `settings.vimEnabled` check** out of the command callbacks.
   Reading it synchronously made `enable-vim-mode` skip queueing a toggle whose
   predecessor had not yet updated the flag, so the guard was never reached.

The probe now reports `afterEachCycle: "TTTTTTTT"` with `vimEnabled: true`.

`vim-toggle.e2e.ts`'s `rapid toggle is debounced` asserted `vimEnabled` false
after a rapid disable/enable — the dropped request, encoded as intent. It now
asserts the state that was asked for. This is a deliberate behaviour change:
a rapid double toggle applies both halves instead of swallowing the second. If
the debounce was guarding against real thrash, the better design is coalescing
(record the desired end state, apply once) rather than applying both.

### Every extension-slot feature was exposed

`setupVimSubsystems()` nests the per-feature slots inside the one the toggle
emptied — `animatedCursorSlot` (`src/main.ts:2831`), `undoTreeSlot` (:2746)
and the three snippet slots (:2785-2787). A dropped enable therefore took all
of them down together, not folding alone.

That makes one mechanism a candidate for several entries above, including
both animated-cursor entries, whose CI signature is a canvas that never
paints. **Not yet confirmed by measurement.** Two probe attempts failed on their own
preconditions rather than on the subject:

1. `setPluginSetting` stores the value without reloading features, giving
   `canvases: 0` at baseline. Use `setPluginSettingAndReload`.
2. With that fixed, `canvases: 1` but `painted: false` _at baseline_, before
   any toggling — the canvas is sampled once after 500 ms, while the real
   assertion polls up to 5.4 s (`pollPaintedCursor`). A single sample is too
   early to mean anything.

A valid probe must reuse the spec's own polling helper rather than a
point-in-time read. Until then this remains a source-level observation.

### Why this may not be only about folding

`wdio.conf.mts` cycles vim mode before every spec, and `AGENTS.md` records
that `animatedCursor`, `enableSnippets`, `snippetTriggerMode` and
`enableUndoTree` all shipped broken for want of a runtime slot. Any
extension-slot feature is exposed to the same teardown race, so this one cause
may account for several macOS entries above. Test them against this lever
before investigating them separately — `34168dd` may already have cleared
some of them, which the next CI run will show.
