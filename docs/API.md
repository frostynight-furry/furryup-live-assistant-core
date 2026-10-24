# API

Load `core/index.cjs` with CommonJS or use the default export from ESM. Public types are in `core/index.d.ts`. No configuration file is read implicitly.

## Runtime

`createAssistantRuntime({ provider, now?, timeoutMs?, eventLimit?, queueLimit?, traceLimit?, maxEventAgeMs?, dedupeLimit? })`

The provider is required. Defaults are technical resource budgets: 30s provider timeout, 200 context events, 64 queued/current cards, 1000 trace rows, 5-minute maximum event age, and 4096 dedupe keys. These are not operational recommendations. Pass a monotonic, nondecreasing millisecond clock for deterministic replay; use one compatible time basis for event receipt and expiry.

- `start(scope)` begins a fresh session, clears event/memory/queue state and cancels old inference. Call for every room/session binding change, including a return to a previous room.
- `ingest({id, scope, type, at, data?})` accepts bounded JSON data. IDs are deduplicated in the current scope; foreign, future, stale, malformed or overflowing events are rejected. Source timestamps should not replace trusted local receipt times.
- `evaluate()` explicitly requests the provider. Concurrent calls share one result. No automatic model calls or retries occur during ingestion.
- `present()` moves the highest-priority eligible queued card to displayed state. Equal priorities preserve insertion order. The current card stays stable.
- `pause(true)` holds pending ordinary cards; `pause(false)` resumes them. Explicit urgent cards bypass that pause. Pausing does not cancel current inference or hide the current card.
- `decide(id, 'adopted'|'rejected'|'dismissed')` requires an unexpired displayed card and returns whether the transition happened. It records a decision; no effect or model-provided command is executed.
- `cancel(id)` cancels one pending/displayed card; `cancelRequest()` cancels inference without clearing the queue.
- `snapshot()` returns detached current/pending card data and bounded terminal history. Treat it as private application data if the provider supplies private text.
- `diagnostics()` returns a detached metadata-only trace. `clearDiagnostics()` removes retained rows. `stop()` clears the session; `dispose()` also prevents reuse.

## Providers

`provider({scope, at, events, memory}, {signal})` receives a detached, recursively frozen snapshot. Return one of:

```js
({ mode: 'observe' })
({ mode: 'remember', memory: { fixtureCount: 1 } })
({ mode: 'suggest', suggestions: [{
  id: 'fixture-card', title: 'Fixture', message: 'Synthetic delivery check',
  evidence: 'Synthetic event', priority: 0, urgent: false,
  createdAt: Date.now(), expiresAt: Date.now() + 1000,
  cooldownKey: 'fixture-key', cooldownMs: 0
}] })
```

Reminder content and policies are supplied by the application. A whole malformed batch is rejected before enqueueing. Queue limits or duplicate/cooldown suppression may then reject individual valid cards. Memory is replaced, not merged. Any network provider must honor `signal` when possible. The framework suppresses late results even when it is ignored.

`createProviderRunner({provider, timeoutMs?, now?, onTransition?})` is the lower-level request coordinator. It returns statuses without exposing error text. It does not validate the provider's output contract; the runtime does that. This makes it usable around a host's existing provider while preserving host-owned response validation.

## LiveConnect

`createLiveConnectAdapter({scope, rooms, project?, allowSimulation?})` accepts a snapshotted list of `{platform, roomId}`. Call `adapt(normalizedV1Event)` and pass a non-null result to `runtime.ingest`.

It checks the envelope version, explicit preview flag, room binding and basic projected event fields. This is not a complete replacement for LiveConnect's schema validation or transport provenance checks. The default projection is `{}`; use an explicit projector to include approved fields. It never imports collectors, account settings or the desktop host. Synthetic and preview events require `allowSimulation: true`.

## Display and templates

`createDisplayLease({readingDuration, urgency, maxHoldMs, now?, maxCards?, budgetLimit?})` reuses the desktop reading lifecycle with injected policy. `select(candidates, {scope, present, valid})` reserves a reading lease only for actual presentation. `acknowledge(id)` starts the display budget after renderer paint. `interact({id,reason,active})` supports pointer, focus and manual holds. `lookup`, `replace`, `release` and `clear` manage the current lease.

The application owns candidate eligibility, numeric policy outputs and hard invalidation. An already painted card can survive its source TTL within the reading lease; a hard-invalid card cannot. This primitive is independent of the queue's strict expiry lifecycle and should not be layered blindly over it.

`createTextRenderer(rows)` requires explicit `{id,text}` rows; no content fallback exists. `text(id, values)` substitutes `[[name]]` once using own string/boolean/finite-number properties. It never evaluates expressions or recursively interpolates values. Escaping for HTML or other output sinks remains the caller's responsibility.

## Realtime facts and context tokens (0.2)

`createRealtimeState({now?, limit?})` is a bounded fact store. `start(scope)` creates a new generation even if the scope string is unchanged; `stop()` invalidates all outstanding tokens. `patch(rows)` atomically accepts caller-selected facts:

```js
state.patch([{ key: 'fixture', source: 'synthetic', status: 'known', value: false,
  observedAt: clock(), ttlMs: 1000 }]);
const token = state.capture(['fixture']);
// Before using an asynchronous result or showing it:
if (state.isCurrent(token)) acceptResult();
```

The sample is a lifecycle fixture, not a production freshness policy. `status: 'unknown'` requires an absent/null value and may include a short `reason`. Known zero, false and null remain known values. Missing keys are absent from `snapshot().facts` and must be treated as unknown by the caller. Future observations and older updates for the same key are rejected; a malformed multi-fact patch commits nothing. Source identity, reason, value and effective freshness changes increment versions; refreshing only receipt time does not. An elapsed expiry invalidates an older token even if the same value is subsequently refreshed. Values and complete fact snapshots use the existing JSON size/depth limits; the default 64-fact limit is a technical storage bound.

`snapshot()` returns `{active,scope,generation,revision,at,facts}`; facts are keyed by name and contain `{key,source,status,value,observedAt,expiresAt,revision,reason}`. Snapshot status is `fresh`, `stale` or `unknown`. `capture(keys?)` returns a frozen token. Selected keys isolate critical dependencies from unrelated updates; omitting keys observes all changes, including newly added facts. `subscribe(listener)` returns an unsubscribe function and notifies complete semantic transitions with `{scope,generation,revision}`. There is no background freshness timer: `patch`, `snapshot`, `capture` and `isCurrent` discover expiry. Hosts must poll/check before acting; a subscription alone is not an expiry alarm. Tokens are local consistency checks, not signed authorization credentials.

## Rolling analysis budgets (0.2)

`createAnalysisBudget({capacity,windowMs,minIntervalMs,now?,initialState?,reservationLimit?})` requires explicit positive capacity/window and a nonnegative interval. `tryAcquire(key,cost=1)` immediately reserves units and returns `{allowed,reason,retryAt}`. Reasons are `allowed`, `duplicate`, `interval`, `budget` and `capacity`; blocked requests do not consume new units. Costs and time are safe integers. A reservation is an upper-bound commitment chosen by the caller, not a provider invoice or measured token count. The caller must separately bound input, output, transport retries and provider charges.

`snapshot()` returns `{used,remaining,capacity,reservations,nextAvailableAt,windowMs,minIntervalMs}`. The budget rolls by reservation timestamps, independent of rooms, scenes or pause toggles. Started attempts are not refunded on cancellation, timeout or errors. There is no reset method. `checkpoint()` returns frozen JSON `{schemaVersion:1,reservations:[{key,at,cost}]}`; pass it as `initialState` to restore. Invalid/future/duplicate entries fail closed. Restoring under a smaller capacity preserves already reserved cost. Nondecreasing clocks are required; backward movement fails closed. Keep checkpoints private if keys encode application state. The default reservation count limit is 4096; hitting this storage bound fails closed.

Persist a successful reservation **before** invoking a paid provider; a failed write must prevent the call. Core does not perform storage itself and constructing a new budget without its checkpoint starts a new ledger. Concurrent processes require a shared transactional authority; this in-process object is not a distributed quota service. Reservation deduplication lasts through the larger of the cost window and minimum interval. A host that must never retry the same semantic context should also persist its last-attempt key.

## Optional analysis coordinator (0.2)

`createAnalysisScheduler({state,budget,provider,timeoutMs?,now?,historyLimit?})` composes the existing provider runner. `request({key,context,dependencies?,cost?})` captures the selected state version and reserves cost. Same-key concurrent calls coalesce; other calls while busy return `busy`. There is no internal pending queue, trigger classifier, automatic request timer or retry. Semantic state changes cooperatively cancel active work, and a result with obsolete dependencies returns `stale` even if cancellation was ignored. It does not enqueue or display suggestions itself.

`pause(true)` cancels current work and blocks new requests; `cancel()` releases current work without clearing cost/history. `dispose()` also unsubscribes state observation. The coordinator retains a bounded set of handled keys (default 512), including failed/cancelled attempts; eviction bounds the duplicate guarantee. Keys must identify semantic attempts rather than a mutable payload. A persistent host should use the separate state/budget APIs around its existing provider orchestration, saving reservations first; the convenience coordinator is an in-memory composition. Caller-supplied callbacks remain trusted code.
