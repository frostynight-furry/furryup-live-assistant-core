# API v1

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
