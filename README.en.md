# FurryUP Live Assistant Core

A content-free runtime for session-scoped events, explicit suggestion providers, reminder queues, feedback and bounded diagnostics. No training materials, scripts, prompts, operational strategies, real audience records or built-in model service are included.

Requires Node.js 22.12+. No dependency installation, FurryUP account, platform connection or desktop host is needed.

```sh
node examples/replay.cjs
node examples/server.cjs
node scripts/verify.cjs
```

The simulator listens only on loopback and uses synthetic data. Providers explicitly return `observe`, `remember` or `suggest`. Ingesting events does not trigger inference. The runtime never sends chat messages or executes returned commands.

The public API is documented in [API.md](docs/API.md). [BOUNDARIES.md](docs/BOUNDARIES.md) describes data ownership, bounded storage, failure handling and release checks. [RESEARCH.md](docs/RESEARCH.md) records upstream research and reuse decisions.

In-memory queues and deduplication are bounded and do not promise permanent exactly-once delivery. Providers are trusted application code, not sandboxed plugins. The display lease is a separate primitive with caller-supplied ranking and timing. Model integrations, storage and domain policies belong to the integrating application.

```sh
node scripts/archive.cjs ../assistant-core-0.1.0.tar
```

This audits actual archive bytes using the system `tar` tool. Maintainers must separately audit the archive against private content references; generic scanning alone cannot prove their absence. MIT licensed; the public repository is [frostynight-furry/furryup-live-assistant-core](https://github.com/frostynight-furry/furryup-live-assistant-core). `private: true` prevents accidental npm publication. CI only verifies changes; no automatic publishing is configured.
