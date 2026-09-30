# M7 latency certification negative controls

This file records the executed failure evidence for
`rpc-latency.e2e.ts`. All runs used real `browser.keys()` events and the
production backends.

## Document-size stability

With `RPC_LATENCY_BREAK_STABILITY=1`, the harness deliberately omitted its
final reset and added one insert. The corpus remainder plus that insert changed
the document from **83,241** to **83,250** UTF-16 units. The stability assertion
failed with exit status 1:

```text
Expected: 83241
Received: 83250
1 failing (15.2s)
```

The restored certification runs reported `startDocLength=83241`,
`endDocLength=83241`, and `sizeDrift=0` for both 500-sample conditions.

## Synchronous RPC delay

Injecting 40 ms at the shared real-keydown capture point raised RPC p95 from
**35.8 ms** to **76.3 ms**, a measured **+40.5 ms**:

```text
RPC_LATENCY_DELAY_CONTROL {"baseline":35.799999952316284,"delayed":76.29999995231628,"rise":40.5}
```

The injected condition also ended at 83,241 units with zero drift.

## Forced CM6 layout

Forcing synchronous layout after each matching CM6 update and before its rAF
performed **2,412.0 ms** of measured layout work over 60 warmup-plus-measured
samples. Fork p95 rose from **41.0 ms** to **108.7 ms** (**+67.7 ms**):

```text
RPC_LATENCY_LAYOUT_CONTROL {"baseline":41,"forced":108.69999992847443,"rise":67.69999992847443,"work":2411.999999642372}
```

## RPC engagement and fork isolation

With RPC connected, the production delegation state was
`active=true`, `handlerAttached=true`, and `keyInterceptActive=true`. A real
`i` key put Neovim in insert mode while the bundled fork's `insertMode`
remained false. A following real `x` key produced `x## Section 0` in Neovim and
the same text returned through the line-event bridge into CM6:

```text
RPC_LATENCY_ENGAGEMENT {"delegation":{"active":true,"handlerAttached":true,"keyInterceptActive":true},"nvimMode":"i","forkInsertMode":false,"markerReachedNeovimAndCm6":true}
```

This marker was reset before timing.

## Restored sanity-gate result

The final N=500, 75-warmup run still failed the blocking sanity gate: fork p95
was **41.0 ms**, while RPC p95 was **35.8 ms**. Therefore the spec stopped with
exit status 1 and did not calculate or publish certification deltas:

```text
RPC_LATENCY_SANITY {"forkP95":41,"rpcP95":35.799999952316284,"passed":false}
Expected: > 41
Received:   35.799999952316284
```

## Re-certification after the p50 gate inverted

The gate previously required `fork.p50 < rpc.p50`, on the theory that p50
isolates the RPC round-trip cost while the tail is dominated by in-renderer vim
work. That theory stopped holding: the fork runs a full vim implementation in
the renderer over the 2,004-line fixture, which costs more than a pipe
round-trip to a native process. Measured three times on the same machine, once
with unrelated changes stashed and once with the backend disabled in the vault's
persisted settings, to rule out both as causes:

| Run                             | fork p50 | rpc p50 |
| ------------------------------- | -------- | ------- |
| working tree                    | 15.9     | 8.6     |
| changes stashed                 | 15.9     | 9.0     |
| backend disabled in `data.json` | 15.6     | 7.9     |

The spec sets `neovimRpcEnabled`, `neovimBinaryPath` and `neovimConfigPath`
itself, so the persisted settings never reached it; that run is recorded only
because it was offered as an explanation and had to be excluded.

Re-certified figures: fork p50/p95/p99 **16.2 / 43.4 / 54.0 ms**, RPC
**8.2 / 23.5 / 28.9 ms**, deltas **−8.0 / −19.9 / −25.1 ms**. RPC leads in all
four command classes — motions 11.1/7.1, operators 38.8/22.7, insert 16.0/8.0,
undo 25.3/17.1.

The ordering assertion is replaced by a two-directional p50 budget. Removing it
does not weaken the suite: what it guarded against — the RPC condition silently
measuring the fork — is proven by `proveRpcEngagementAndForkIsolation()` and,
independently, by the delay control, which injected 40 ms and measured a 37.2 ms
rise in RPC p95. The forced-layout control rose 68.4 ms against 2,412 ms of
injected layout work.

**Environment caveat.** With `neovimBinaryPath` empty the spec resolves `nvim`
from `PATH`. On a machine where that is a wrapper which prepends a configuration
directory to `runtimepath`/`packpath` — Nix `mnw`/`nvf`, home-manager's
`programs.neovim` — the measured Neovim loads the user's full plugin set. That
is pessimistic for RPC rather than flattering, so it does not explain the lead,
but it does mean these figures are not directly comparable across machines.
