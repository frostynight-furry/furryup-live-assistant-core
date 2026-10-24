# Sources and license boundary

The display lifecycle and literal-template renderer were extracted and generalized from FurryUP's own implementation. Business-specific timing, ranking, text, prompts and domain rules are not part of this package. The other modules compose these mechanisms into a standalone runtime. This package's own code is MIT licensed. This does not license FurryUP Studio, its private extensions, content or trademarks.

No third-party production source is bundled and there are no runtime or development package dependencies. Node.js, Git and the system `tar` command are external tools. The LiveConnect adapter maps the public v1 event envelope without including collectors. A separately installed LiveConnect distribution retains its own MIT license and third-party notices.

Firebot's component and preset concepts and Streamer.bot's queue and execution-history documentation informed the design. No source from either project was copied. Firebot is GPL-3.0; importing its code would require a separate license review. Luna AI was reviewed for provider extensibility, not imported. See [research](docs/RESEARCH.md) for maintenance and reuse decisions.
