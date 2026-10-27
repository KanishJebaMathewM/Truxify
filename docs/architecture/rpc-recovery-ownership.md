# RPC recovery probe ownership

The production escrow service invokes `RpcProviderManager.executeWithRetry` for its existing callbacks. Automatic circuit feedback now belongs to the provider role and circuit generation captured when each attempt began. A fallback reply cannot close a primary probe or alter primary failure history. A reply from an older primary generation cannot reopen or close a newer circuit. Callback results and errors still reach their original callers.

Each primary state transition advances a generation. HALF_OPEN admits one recovery callback, with an identity token retained until that callback actually resolves, rejects or throws synchronously. Other recovery callers use the existing first fallback provider. A state change alone does not release an outstanding probe. Final cleanup compares token identity before release, and runs before retry backoff.

Healthy CLOSED calls retain concurrent primary access; this is not a global request limiter. The existing public `getProvider`, `recordSuccess` and `recordFailure` APIs keep their manual semantics. External code using those APIs directly is responsible for correlating its own feedback; the ownership guarantee applies to `executeWithRetry`. With only one configured provider, a second caller during an outstanding recovery probe receives a busy error without invoking its callback; the existing retry loop can retry selection after its normal backoff. Outside that recovery case, existing single-provider OPEN behavior is unchanged.

Retry count, exponential delay/jitter and callback semantics are unchanged. This patch does not implement request deadlines: `requestTimeoutMs` remains stored but unused as on current main. A callback which never settles holds its probe indefinitely and other callers use fallback (or receive busy without one). No cancellation, global native-call bound, fallback rotation, transaction idempotency, signing, replay or on-chain receipt policy is added. Tests do not submit transactions or contact RPC providers.

## Verification

With Node.js >=20.19, from the repository root:

```bash
npm ci --prefix tools/rpc-recovery-tests --ignore-scripts
bash tools/rpc-recovery-tests/run.sh
```

The focused harness copies and executes the actual manager. Ethers6.17.0 is locked to the production version; the seven existing tests instantiate providers but make no provider requests. Eighteen new tests use controlled provider constructors, deferred callbacks and a controlled clock to cover fallback feedback during recovery, late primary replies, twenty concurrent callers, stale probe ownership, normal primary concurrency, public health compatibility, synchronous throws, result/error identity, retries and single-provider contention. All25 pass;11 new regressions fail on the original manager.

Set `RPC_MANAGER_SOURCE` to an absolute baseline manager path to repeat that comparison without overwriting the worktree. No deployment or configured-provider changes are needed.
