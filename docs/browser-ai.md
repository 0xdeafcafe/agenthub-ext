# Local PR assistant: implementation checkpoint

Draft, 2026-09-16. Stacked on PR #1. The UI, bounded diff index, local retrieval, two-model install flow, and worker integrations are implemented. This is not yet a validated model-quality recommendation.

## What is useful

The linked [LangWatch SSO PR](https://github.com/langwatch/langwatch/pull/7633/changes) had 454 files and 84,321 changed lines in the saved snapshot. “Review this PR” is too broad for a 2B model. Better questions identify a behavior and a scope:

- Where is session expiration checked? What happens after IdP revocation?
- What proves an organization owns a domain before granting SSO access?
- Which checks stop SCIM requests from modifying another organization?
- Which tests cover expiry boundaries, domain reproof, and failure paths?

The local retrieval probe found relevant identity-provider, domain-verification, SCIM-route, and test hunks for these questions. That measures retrieval, not answer correctness. Inspect `.output/ai-benchmark/retrieval.json` after running the probe; don't assume every top-ranked excerpt is sufficient evidence.

Useful UI additions in this draft:

- Search before downloading anything, with file/line jumps and raw excerpts.
- Suggested folder scopes, skipping a common wrapper directory.
- Explain changes, find edge cases, and check test gaps shortcuts.
- Both models installed side by side; one worker active per panel.
- Compare the same question and source set with the other model.
- Visible input tokens, first-token time, elapsed time, inspected files, and omissions.
- Stop, clear, refresh source context, unload memory, and remove downloads.
- Resizable extension iframe outside GitHub's virtualized layout.

## Models and current judgment

| Model            | Runtime          | Download                     | Judgment                                                                         |
| ---------------- | ---------------- | ---------------------------- | -------------------------------------------------------------------------------- |
| Qwen3.5 2B q4f16 | WebLLM 0.2.85    | ~1.08 GB including tokenizer | First model to try because it is smaller. Quality advantage unproven.            |
| Gemma 4 E2B web  | LiteRT-LM 0.17.0 | ~2.04 GB including tokenizer | Optional comparison. Browser API is early preview; validation remains necessary. |

These sizes come from the pinned artifacts, not peak memory measurements. WebLLM's registry estimates ~2.25 GB VRAM for this Qwen configuration. Actual Arc memory and throughput have not been measured. [WebLLM registry](https://github.com/mlc-ai/web-llm/blob/main/src/config.ts), [Qwen files](https://huggingface.co/mlc-ai/Qwen3.5-2B-q4f16_1-MLC/tree/dd74e9c8a20c4546df85c844103bff87b6dcacad), [Gemma files](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/tree/b3ca0d2f076785a8f4b2219ddbd2bdb99954eae1).

Pins live in `lib/ai/models.ts`. Runtime dependencies and tokenizer package are pinned exactly. The Qwen WASM download has a checked SHA-256. LiteRT's compatible JS/WASM and tokenizer runtime are copied from installed packages into the extension at build time. The browser downloads weights and tokenizer data, never executable runtime code. [Chrome CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy), [LiteRT-LM JS API](https://developers.google.com/edge/litert-lm/js).

## Context without wasting memory

The assistant fetches the current comparison's diff only when opened. The background bridge checks that the request matches the sender's PR or commit range. The full diff is capped at 20 MB and must parse completely. Source and chat stay in memory; weights use separate browser caches.

The index retains up to 2 million characters, 48,000 per file, in 65-line chunks. Long lines are shortened at 800 characters. It preserves old/new line numbers and reports omitted chunks. Generated files are deprioritized during indexing and excluded from retrieval by default. A SHA-256 of the diff invalidates conversation state when refreshed source changes.

Retrieval uses paths, split identifiers, text matches, bounded synonym expansion, and file diversity. Test-gap prompts pair changed application files with tests sharing their basename. This is lexical retrieval; embeddings and model-driven tool loops are deferred until they demonstrate better retrieval on fixed questions.

The runtime's actual tokenizer fits evidence into a 2,700-token prompt inside a 4,096-token context, reserving room for an answer of up to 700 tokens and model template overhead. Only the prior question is retained for follow-up context. The UI shows every supplied excerpt and labels the file sample. Citations are checked against those source IDs; invented references do not become links. Model output is rendered as text.

PR content is untrusted evidence. The assistant has no code execution, edit, posting, or arbitrary network tools. Prompting alone cannot guarantee correct or injection-proof answers, so this remains a review aid with inspectable evidence.

## Validation and remaining work

`npm run test:assistant` uses an explicitly labelled simulated worker for repeatable UI testing. It covers two installs, comparison, cancellation, persistence, source links, navigation, and screenshots in both themes and mobile sizing. Normal CI never downloads model weights.

`npm run test:ai:real` is opt-in and uses an isolated persistent Chromium profile. It loads both actual models and asks about a seeded session-expiry boundary change, retaining JSON events and output in `.output/ai-benchmark/`. `node scripts/ai/retrieval.mjs /path/to/PR.diff` records source selection for the SSO questions above.

Qwen subsequently loaded successfully in Chromium (21.8 seconds with cached weights), but generation exposed a ready-event timing race. The race is fixed in this checkpoint; successful generation has not yet been verified. Gemma downloads were stopped at the requested break.

The first real run downloaded Qwen's weights and exposed a tokenizer package interoperability issue; the package ships UMD while declaring ESM. The draft now packages an explicit ESM wrapper. Initial integration also exposed WXT's worker URL transform and LiteRT's use of `importScripts`, which module workers reject. The draft uses an explicit worker entrypoint and packaged LiteRT module loader. These are reasons to keep the PR a draft until the repeat run and production-extension inference pass.

Still required before calling this ready:

- Finish real inference with both models in the production extension under its actual CSP and optional host permissions.
- Compare answers against the fixed SSO questions and seeded bugs; record unsupported claims, misses, and citation quality before picking a “best” model.
- Verify offline warm load, interrupted/partial download removal, storage pressure, GPU loss, and multi-tab GPU contention. Each panel currently owns its own worker.
- Exercise private PRs and live virtualization in Arc. Firefox and Safari inference are unverified.
- Improve broad-query ranking: the SSO probe sometimes puts tests/docs ahead of the runtime checks needed to answer a question.

The natural next checkpoint is reliable production inference plus a small evidence-based model comparison. No review is posted automatically, and nothing in this draft is a release.
