# FurryUP Live Assistant Core

A content-free runtime for session-scoped events, explicit suggestion providers, reminder queues, feedback and bounded diagnostics. No training materials, scripts, prompts, operational strategies, real audience records or built-in model service are included.

Initiated and maintained by [FrostyNight (夜霜)](https://github.com/frostynight-furry), this is a general-purpose component originating from [FurryUP Studio](https://frostynight.top/furryup).

- **For streamers using the full product**: [Explore FurryUP Studio](https://frostynight.top/furryup) · [Download installers](https://github.com/frostynight-furry/furryup-studio-releases)
- **For developers using the component**: [Quick start](#quick-start) · [API documentation](docs/API.md) · [中文](README.md)

## Quick start

Requires Node.js 22.12+. No dependency installation, FurryUP account, platform connection or desktop host is needed.

```sh
node examples/replay.cjs
node examples/replay.cjs --realtime
node examples/server.cjs
node scripts/verify.cjs
```

The simulator listens only on loopback and uses synthetic data. Providers explicitly return `observe`, `remember` or `suggest`. Ingesting events does not trigger inference. The runtime never sends chat messages or executes returned commands.

Realtime facts distinguish fresh, stale and unknown observations. Scoped dependency tokens fence obsolete analysis. Explicit rolling budgets provide validated checkpoints; an optional coordinator coalesces requests and never retries automatically. Integrators choose the observation sources, analysis triggers and cost limits.

The public API is documented in [API.md](docs/API.md). [BOUNDARIES.md](docs/BOUNDARIES.md) describes data ownership, bounded storage, failure handling and release checks. [RESEARCH.md](docs/RESEARCH.md) records upstream research and reuse decisions.

In-memory queues and deduplication are bounded and do not promise permanent exactly-once delivery. Providers are trusted application code, not sandboxed plugins. The display lease is a separate primitive with caller-supplied ranking and timing. Model integrations, storage and domain policies belong to the integrating application.

```sh
node scripts/archive.cjs ../assistant-core-0.2.0.tar
```

This audits actual archive bytes using the system `tar` tool. Maintainers must separately audit the archive against private content references; generic scanning alone cannot prove their absence. MIT licensed; the public repository is [frostynight-furry/furryup-live-assistant-core](https://github.com/frostynight-furry/furryup-live-assistant-core). `private: true` prevents accidental npm publication. CI only verifies changes; no automatic publishing is configured.

## About FrostyNight and FurryUP Studio

[FrostyNight (夜霜)](https://github.com/frostynight-furry) initiated and maintains this project. [FurryUP Studio](https://frostynight.top/furryup) is a desktop product for streamers that brings streaming workflows into one interface and provides installation and update flows. Installers and release notes are available in the [download repository](https://github.com/frostynight-furry/furryup-studio-releases).

This repository provides a general-purpose assistant framework for independent integration; it does not include the full FurryUP Studio product. Using the component does not require installing or signing in to the full product. Integrators supply their own content, model services and domain policies.

## Optional acknowledgment

You are welcome to mention the component and its maintainer in your project README, documentation or About page. You can copy either example below:

```markdown
This project uses [FurryUP Live Assistant Core](https://github.com/frostynight-furry/furryup-live-assistant-core), initiated and maintained by [FrostyNight (夜霜)](https://github.com/frostynight-furry). This component originated in [FurryUP Studio](https://frostynight.top/furryup).
```

```markdown
本项目使用 [FurryUP Live Assistant Core](https://github.com/frostynight-furry/furryup-live-assistant-core)。该组件由[夜霜（FrostyNight）](https://github.com/frostynight-furry)发起并维护，源自 [FurryUP Studio](https://frostynight.top/furryup)。
```

These acknowledgments and links are entirely optional and add no conditions to the MIT license. The MIT requirement to retain the copyright notice and permission notice still applies; see [LICENSE](LICENSE). An acknowledgment does not imply official endorsement of a derivative project, product or service by FrostyNight or FurryUP Studio.
