# Content and release boundaries

The package owns contracts and lifecycle mechanisms. Integrators own content, rules, ranking weights, business thresholds, prompts, model credentials and data retention. It contains no implicit content fallback and no built-in strategy download endpoint.

The local desktop product consumes a verified snapshot of this runtime through private adapters. Its timing/urgency policy and template rows stay outside the package. The standalone coordinator can be adopted by other applications without importing that desktop product. This does not replace the product's entire private orchestration layer.

## Data

Events, memory and suggestions remain in memory. Queue snapshots include the provided card content and should be treated as application data. Diagnostic exports contain only fixed state codes, times and hashes of identifiers. Hashes are pseudonymous references, not an anonymity guarantee. No automatic file, network or telemetry export exists.

LiveConnect mapping drops event payload fields by default. A caller-supplied projection explicitly chooses additional data. Bindings are snapshotted on adapter construction; create a new adapter after switching rooms. Synthetic/preview events are rejected unless explicitly enabled.

Providers are trusted callbacks; this library does not sandbox arbitrary JavaScript. The provider signal supports cooperative cancellation, while generation checks prevent late results from being displayed even if a callback ignores it. Network or model calls are the caller's responsibility. Local queue delivery remains usable when a provider fails.

## Limits

JSON values and the complete provider context snapshot are limited to 64 KiB and 12 levels of nesting. An oversized aggregate context returns `invalid` before invoking the provider; configure event count and payload projection accordingly. Provider timeouts must be positive safe integers no greater than 2,147,483,647 milliseconds. The display urgency callback must accept `undefined` when no candidate is available.

Event age, context count, dedupe count and trace count are configurable technical resource limits. Dedupe overflow refuses new events until keys expire or the session changes. Queue capacity refuses new suggestions without replacing the displayed card. Completed-ID history is bounded. Feedback on expired cards fails. Pausing prevents new ordinary cards from displaying; an already displayed card remains until handled or expired. An explicit urgent flag bypasses the pending pause. No business urgency classifier is bundled.

The separate display lease primitive preserves an already displayed card long enough for reading, using caller-supplied timing. The caller must supply current candidates and a hard-validity callback; scope changes and hard invalidation override reading holds. It does not enforce source eligibility itself. Queue expiry and display leases are distinct APIs; integrators must choose which owns visible-card lifetime.

## Verification

Public checks include an exact file allowlist, UTF-8/binary validation, encoded credential checks, portable imports, archive entry checks and SHA-256 comparison of actual archive contents. Tests exercise scope changes, races, ignored cancellation, timeout, invalid output, pause, feedback, expiry and synthetic replay.

Before distribution, maintainers must also compare the actual source archive and staged Git blobs against private content references. That gate must refuse to proceed if references are missing and must not copy references or excerpts into the report. A fresh repository must not inherit private Git history. Public CI does not have access to private references and cannot substitute for this maintainer check.

No scanner can determine every semantic paraphrase or detect all possible obfuscation. Structural isolation, explicit file review and synthetic-only examples are required in addition to byte/text checks. This release makes no claim about real-platform long-running reliability or the quality of any private strategy.

## Realtime and cost boundaries

The realtime store accepts explicit facts; it does not connect to OBS, infer a scene, classify a conversation or supply freshness thresholds. Hosts own source validation and decide which facts invalidate a request. Timestamp-only updates do not create semantic changes, while lost freshness does. Expiry is evaluated on access rather than by background timers.

The cost ledger reserves caller-selected units. Saving checkpoints, enforcing model input/output limits and defining monetary upper bounds belong to the host. Cancelled or failed work can still incur provider cost, so reservations are retained. The ledger does not reset when context or pause state changes. A new object without restored state is a new ledger; multiple processes require external coordination. Synthetic test limits do not recommend a product budget.

The optional coordinator never decides when a livestream deserves analysis. It only accepts explicit requests and refuses duplicates, stale work or budget violations. Trigger logic, useful evidence selection, private prompts and model responses are not added to diagnostic exports or public examples.
