# Changelog

## 0.3.0 - 2026-11-08

- Added `core/simultaneous-viewers.cjs` (`createSimultaneousViewers`, `publicSimultaneousViewers`) for four-platform time-weighted complete-coverage simultaneous viewer aggregation, minute-bucket peak/average timeline tracking, and archive-boundary sanitization.
- Added `core/viewer-presence.cjs` (`createViewerPresence`, `DEFAULT_VIEWER_PRESENCE_SETTINGS`) for monotonic-clock online-list viewer dwell verification with wall-clock discontinuity protection and per-platform level thresholds.
- Added TypeScript declarations in `core/index.d.ts` and unit tests in `test/presence-viewers.test.cjs`.

## 0.2.0 — 2026-10-24

- Atomic realtime facts with source timestamps, explicit unknown/stale states and scoped dependency tokens.
- Semantic changes invalidate results; timestamp-only refreshes preserve valid work.
- Explicit rolling cost reservations with validated checkpoints, interval control and no implicit refunds.
- Optional single-flight analysis coordinator reusing the existing provider runner; stale results, repeated keys and automatic retries are suppressed.
- Synthetic regressions for freshness, context invalidation, persisted budgets and request lifecycle.

## 0.1.0 — 2026-10-24

- Independent, content-free runtime with explicit providers and session-scoped context.
- Bounded suggestion queue, pause/resume, feedback, expiry, cancellation and metadata-only diagnostics.
- Injected display policy and literal template renderer shared with the private host through a verified runtime snapshot.
- LiveConnect v1 envelope adapter, synthetic replay and loopback web simulator.
- Node tests, exact source allowlist, source archive byte verification and contributor CI.

Initial standalone open-source release. No hosted service, platform availability, model quality, or npm package publication is implied.
