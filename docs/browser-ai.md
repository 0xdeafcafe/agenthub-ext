# Local PR assistant: implementation checkpoint

Draft, 2026-09-16. Stacked on PR #1. Both real models now generate answers. The production assistant opens and indexes the PR correctly, including when Chromium omits the iframe referrer. The small review comparison exposed answer errors, so this is not a validated model-quality recommendation.

## What is useful

The linked [LangWatch SSO PR](https://github.com/langwatch/langwatch/pull/7633/changes) had 454 files and 84,321 changed lines in the saved snapshot. “Review this PR” is too broad for a 2B model. Better questions identify a behavior and a scope:

- Where is session expiration checked? What happens after IdP revocation?
- What proves an organization owns a domain before granting SSO access?
- Which checks stop SCIM requests from modifying another organization?
- Which tests cover expiry boundaries, domain reproof, and failure paths?

The local retrieval probe found relevant identity-provider, domain-verification, SCIM-route, and test hunks for these questions. On the newer 468-file snapshot, SCIM questions now start with `platform/app/ee/scim/routes.ts`, and domain questions start with `sso-domain-reproof.service.ts`. The previous ranking started with tests. Explicit test questions still prefer tests, with distinct files selected before repeated hunks. That measures retrieval, not answer correctness. Inspect `.output/ai-benchmark/retrieval.json` after running the probe; don't assume every top-ranked excerpt is sufficient evidence.

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

| Model            | Runtime          | Download                     | Judgment                                                                                                     |
| ---------------- | ---------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Qwen3.5 2B q4f16 | WebLLM 0.2.85    | ~1.08 GB including tokenizer | Smaller download. Real inference works; the review probe exposed unsupported claims and logic errors.        |
| Gemma 4 E2B web  | LiteRT-LM 0.17.0 | ~2.04 GB including tokenizer | Real inference works. Better abstention in the missing-evidence probe, but weak regression-test suggestions. |

These sizes come from the pinned artifacts, not peak memory measurements. WebLLM's registry estimates ~2.25 GB VRAM for this Qwen configuration. Actual Arc memory and throughput have not been measured. [WebLLM registry](https://github.com/mlc-ai/web-llm/blob/main/src/config.ts), [Qwen files](https://huggingface.co/mlc-ai/Qwen3.5-2B-q4f16_1-MLC/tree/dd74e9c8a20c4546df85c844103bff87b6dcacad), [Gemma files](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/tree/b3ca0d2f076785a8f4b2219ddbd2bdb99954eae1).

Pins live in `lib/ai/models.ts`. Runtime dependencies and tokenizer package are pinned exactly. The Qwen WASM download has a checked SHA-256. LiteRT's compatible JS/WASM and tokenizer runtime are copied from installed packages into the extension at build time. The browser downloads weights and tokenizer data, never executable runtime code. [Chrome CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy), [LiteRT-LM JS API](https://developers.google.com/edge/litert-lm/js).

## Context without wasting memory

The assistant fetches the current comparison's diff only when opened. The background bridge checks that the request matches the sender's PR or commit range. The full diff is capped at 20 MB and must parse completely. Source and chat stay in memory; weights use separate browser caches.

The index retains up to 2 million characters, 48,000 per file, in 65-line chunks. Long lines are shortened at 800 characters. It preserves old/new line numbers and reports omitted chunks. Generated files are deprioritized during indexing and excluded from retrieval by default. A SHA-256 of the diff invalidates conversation state when refreshed source changes.

Retrieval uses paths, split identifiers, text matches, bounded synonym expansion, and file diversity. Behavior questions give matching implementation a modest score preference; explicit test and documentation questions change that preference. Test-gap prompts pair changed application files with tests sharing their basename. This is lexical retrieval; embeddings and model-driven tool loops are deferred until they demonstrate better retrieval on fixed questions.

The runtime's actual tokenizer fits evidence into a 2,700-token prompt inside a 4,096-token context, reserving room for an answer of up to 700 tokens and model template overhead. Only the prior question is retained for follow-up context. The UI shows every supplied excerpt and labels the file sample. Citations are checked against those source IDs; invented references do not become links. Model output is rendered as text.

PR content is untrusted evidence. The assistant has no code execution, edit, posting, or arbitrary network tools. Prompting alone cannot guarantee correct or injection-proof answers, so this remains a review aid with inspectable evidence.

## Validation and remaining work

`npm run test:assistant` uses an explicitly labelled simulated worker for repeatable UI testing. It covers an empty referrer, two installs, comparison, cancellation, persistence, source links, navigation, and screenshots in both themes and mobile sizing. Simulated installs do not require gigabytes of free storage. `npm run test:extension` also passes with the real packaged iframe, background index, and local search. Normal CI never downloads model weights.

`npm run test:ai:real` is opt-in and uses an isolated persistent Chromium profile. After building, add `-- --extension qwen gemma` to exercise the packaged workers under the extension's unchanged CSP. Add `--offline` after an online run to disable network access and reuse the downloaded models. Preview and extension caches are separate. Each model has its own report under `.output/ai-benchmark/`, including evidence, expected behavior, answers, citations, and timing. `node scripts/ai/retrieval.mjs /path/to/PR.diff` records source selection for the SSO questions above.

The three seeded cases cover an inclusive-to-exclusive expiry boundary, an OR-to-AND tenant guard regression, and a SAML question with only unrelated session code supplied. Reports check runtime completion and citation IDs; they do not grade factual correctness. Inspect the retained answers against each case's expected behavior.

The [retained 2026-09-16 run](ai-benchmark.json) includes the exact prompt, pinned models, source hashes, synthetic evidence, raw answers, and manual assessments. Both packaged workers loaded cached models and completed all three questions with networking disabled in Chromium 151.0.7922.34. Qwen loaded in 3.1 seconds; Gemma loaded in 4.3 seconds, then took another 30.9 seconds to produce its first answer token. Later Gemma questions started streaming in about 0.4 seconds. These are single-machine observations, not performance guarantees.

Neither model passed the review comparison cleanly. Qwen described the expiry change correctly but omitted its citation, repeated the tenant finding until its answer was cut off, and invented replay protection from unrelated code. Gemma suggested a tenant test that passes both versions, and its otherwise appropriate SAML abstention described the deleted expiry expression without distinguishing it from the new one. Valid citation IDs do not establish that a claim follows from the evidence.

The packaged runtimes include the tokenizer UMD-to-ESM wrapper and a LiteRT logger compatibility fix: its classic-script fallback depends on block-function hoisting, which strict module workers do not provide. Both LiteRT variants have a regression check using the installed runtime's logger. Qwen's empty thinking preamble is removed across streamed token boundaries. Source citations with old/new line labels are checked against supplied IDs before linking.

The runtime harness invokes workers directly. It records granted permissions, but does not approve Chromium's native optional-host permission prompt. The real installation prompt still needs a manual Arc/Chrome check.

Still required before calling this ready:

- Check the native model-download permission prompt in Arc/Chrome and complete end-to-end installation through it.
- Expand the small seeded comparison to fixed SSO questions with reviewed expected answers. Neither model earns a “best for review” recommendation from these samples.
- Verify interrupted/partial download removal, storage pressure, GPU loss, and multi-tab GPU contention. Each panel currently owns its own worker.
- Exercise private PRs and live virtualization in Arc. Firefox and Safari inference are unverified.
- Measure retrieval against a labelled set: improved ranking alone does not prove the selected excerpts answer the question.

No review is posted automatically, and nothing in this draft is a release.
