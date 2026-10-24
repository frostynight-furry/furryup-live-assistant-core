# Research and reuse decisions — 2026-10-24

The review used official documentation and repository metadata. It did not measure competitor usability or product effectiveness through installation tests.

| Candidate | Verified scope / maintenance / license | Decision and remaining gap |
| --- | --- | --- |
| [FurryUP LiveConnect](https://github.com/frostynight-furry/furryup-live-connect) | Public v1 event contract and synthetic replay; own code MIT, third-party notices apply | Reuse the envelope through an adapter. Keep collectors separately installed. It does not supply assistant session or provider semantics. |
| [Firebot](https://github.com/crowbartools/Firebot) / [effects](https://docs.firebot.app/v5/core/effects) | Twitch automation, parameterized effect lists; not archived, latest repository push 2026-10-08, latest default-branch commit 2026-08-24; GPL-3.0 | Reference component contracts; do not import its source into this MIT extraction. Twitch effects are not the same as reminder/feedback lifecycle. |
| [Streamer.bot actions](https://docs.streamer.bot/guide/core/actions) | Action queues, pause and execution history; current official documentation | Reference queue/trace UX. Documentation is not a license to redistribute product source. Its action execution model needs adaptation for expiring human-facing suggestions. |
| [Luna AI](https://github.com/Ikaros-521/AI-Vtuber) | Multiple local/cloud models and platforms; not archived, latest repository push 2026-10-22, latest default-branch commit 2025-07-29; GPL-3.0 label plus separate commercial statement | Reference provider extensibility only; no code imported. No model client or operational prompt is bundled. |
| [MagicalDanmaku](https://github.com/iwxyi/MagicalDanmaku) | Archived; maintainer announcement says development, maintenance and distribution stopped in December 2025 | Historical comparison only; not a new dependency. |
| [Live Assistant paper](https://arxiv.org/abs/2609.27303) | Under-review research on observing, recording and selective intervention | Reference the explicit decision states. No trained policy, dataset, weights or research-result claims are adopted. |

The existing FurryUP display lifecycle and literal renderer were reused after removing domain mappings. Node standard libraries cover the remaining bounded, in-process primitives without adding a general workflow engine. A general effects engine would increase packaging and license work while leaving session fencing, content separation and human feedback semantics unresolved.

These choices apply to the small initial runtime. A future provider, storage driver or collector requires its own compatibility and license review before inclusion.
