# Provider and model status - 2026-09-07

Benchmark evidence and runtime availability are separate. A direct Artificial Analysis (AA) row does not prove that a subscription provider can route the model; a routeable model may also need an explicit proxy until AA publishes a matching row.

## Provider policy review dates

Policy review freshness interval: 90 days.

| Provider | Last reviewed | Status |
|---|---|---|
| Anthropic | 2026-06-15 | Excluded pending a tested canonical subscription runtime path |
| Google | 2026-07-10 | Excluded because current access does not provide a routeable subscription provider |

These ISO dates are authoritative for the matching exclusions in the top-level README. Run `node scripts/provider_policy_freshness.mjs` from the repository root to detect missing, malformed, stale, or mismatched claims. The checker is read-only and does not enable or disable providers.

## Current provider and model status

Provider code was checked at OpenClaw `679193c5ffbc02f96a54779da68e480145512cfa` and Hermes `245e48008fa814b3251f50755eb656bd9fb86cb1`. Benchmark evidence is the 2026-09-07 AA API snapshot, 244 rows. The exclusion review dates above are unchanged historical reviews; this model update does not claim a fresh Anthropic/Google policy review.

| Provider/model | Benchmark evidence | Subscription route status |
|---|---|---|
| OpenAI `gpt-6-astra` | Direct `gpt-6-astra-xhigh` row | `openai/gpt-6-astra` only when every selected account's live catalog exposes it. Plus/Pro alone is insufficient. Native 1.05M context; starter retains OpenClaw's 272K active budget. |
| OpenAI GPT-5.6 Sol/Terra/Luna | Direct max-effort rows | Existing starter and fallback pool when Astra account discovery is unavailable. Catalog/native context and active runtime budget are separate. |
| Z.AI `glm-5.3` | Direct max row | Coding Plan text route; 1,048,576 context. |
| Z.AI `glm-5.3-flash` | Direct row, no effort suffix supplied by AA | Coding Plan eligible with image input; 1,048,576 context. Temporary quota promotions are not permanent weights. |
| Moonshot `kimi-k3` | Direct max and separate low reference rows | PAYG API, excluded from Kimi subscription routing. |
| Kimi Coding `kimi/k3-256k` | Explicit K3 max quality reference; endpoint TPS/TTFT unavailable | Moderato+ membership starter, 262,144 context. Membership defaults to high; AA does not supply a matching high membership measurement. |
| Kimi Coding `kimi/k3` | Same explicit K3 quality reference | Full 1M context requires Allegretto+. Not auto-added to a shared starter pool. |
| Kimi Coding `kimi-for-coding`, `kimi-for-coding-highspeed` | K2.7 Code quality reference, not K3 | Separate membership refs; HighSpeed requires Allegretto+. No inferred endpoint speed equivalence. |
| MiniMax `MiniMax-M3` | Direct `minimax-m3` row | Latest verified hosted model; M2.7 remains a text-only fallback. |
| Qwen Cloud `qwen3.8-max` | Direct `qwen3-8-max` row | Reference only. Standard PAYG/separate Token Plan credentials, not the old Coding Plan or Portal pool. |
| Qwen Cloud `qwen3.8-flash`, `qwen3.8-max-0902` | Direct benchmark unavailable | Current model IDs; `qwen3-8-flash-next` is a different model and must not substitute for Flash. |
| Qwen Portal `qwen-oauth` | Historical 3.5 Plus to 3.6 Plus proxy | Removed from current OpenClaw. Fresh starters reject it; compatible existing Hermes/older-runtime identities remain recognizable. |
| xAI `grok-4.6`, `grok-4.5` | Direct high-effort rows | Subscription-backed OAuth only. Grok 4.5 no longer uses the 4.3 proxy. |
| xAI `grok-build-0.1`, `grok-4.3` | Their own direct rows | Compatibility fallbacks where the account exposes them. Moving `auto`/`build-latest` aliases have no fixed benchmark mapping. |

## Exact new benchmark identities

| Policy reference | AA slug | AA model UUID |
|---|---|---|
| Astra xhigh | `gpt-6-astra-xhigh` | `1f541ef3-913f-4eb2-9d07-0e93c7a9a5e3` |
| GLM-5.3 max | `glm-5-3` | `cd684ea4-b475-4269-b001-d469d06d8a7a` |
| GLM-5.3 Flash | `glm-5-3-flash` | `19496b81-9f41-4214-a77a-1df803b3c5ae` |
| Kimi K3 max API reference | `kimi-k3` | `f7d2fc3e-1f7b-405f-818c-07952a4af78f` |
| Qwen3.8 Max | `qwen3-8-max` | `5e5b4ce7-bc54-47b2-b911-21b9cad8394c` |
| Grok 4.6 high | `grok-4-6` | `c8adc5cf-fd5a-407b-af51-dc3bede3e49c` |
| Grok 4.5 high | `grok-4-5` | `794f69b5-cede-482b-b1cc-d769478497cd` |

An effort suffix changes the measured configuration. Astra's bare AA slug denotes max, but Hermes at the checked commit clamps Astra max to xhigh; ZeroAPI therefore maps the xhigh UUID above. Grok 4.6 xhigh is separate from the canonical high reference. An AA non-reasoning Astra row does not make disabled reasoning valid in the native provider.

Kimi Coding is canonical `kimi` in current OpenClaw and `kimi-coding` in Hermes, with a separate China provider in Hermes. `moonshot` is a different endpoint and billing path. Catalog 1.2.0 does not migrate old Moonshot credentials or treat a model family relation as account entitlement.

## Observed or excluded horizon providers

- Anthropic (updated 2026-06-15): Anthropic says Claude Agent SDK, `claude -p`, and third-party app usage still draw from signed-in subscription limits while its separate Agent SDK credit plan is paused. ZeroAPI still does not auto-enable Anthropic. The required canonical `anthropic/*` plus `agentRuntime.id: "claude-cli"` path has not been implemented and tested end to end.
- Google (status checked 2026-07-10): Gemini CLI individual access is being sunset in favor of the Antigravity transition. ZeroAPI has no routeable Google subscription provider. Gemini API keys are usage-billed and remain outside subscription capacity.
- DeepSeek, Mistral, and Cohere (status checked 2026-07-10): API-key/pay-as-you-go reference horizon only; not auto-routed as subscription capacity.

## Public sources

- [OpenAI Astra model](https://developers.openai.com/api/docs/models/gpt-6-astra) and [ChatGPT rollout notice](https://help.openai.com/en/articles/20001354)
- [OpenClaw OpenAI contract](https://github.com/openclaw/openclaw/blob/679193c5ffbc02f96a54779da68e480145512cfa/docs/providers/openai.md)
- [Hermes Codex effort support](https://github.com/NousResearch/hermes-agent/blob/245e48008fa814b3251f50755eb656bd9fb86cb1/agent/reasoning_effort.py)
- [Z.AI GLM-5.3](https://docs.z.ai/guides/llm/glm-5.3) and [GLM-5.3 Flash](https://docs.z.ai/guides/vlm/glm-5.3-flash)
- [OpenClaw Z.AI catalog](https://github.com/openclaw/openclaw/blob/679193c5ffbc02f96a54779da68e480145512cfa/extensions/zai/openclaw.plugin.json)
- [Kimi Coding model and tier contracts](https://www.kimi.com/code/docs/en/kimi-code/models.html) and [Moonshot K3 API](https://platform.kimi.ai/docs/guide/kimi-k3-quickstart)
- [OpenClaw Kimi membership provider](https://github.com/openclaw/openclaw/blob/679193c5ffbc02f96a54779da68e480145512cfa/extensions/kimi-coding/openclaw.plugin.json) and [Moonshot provider](https://github.com/openclaw/openclaw/blob/679193c5ffbc02f96a54779da68e480145512cfa/docs/providers/moonshot.md)
- [MiniMax M3 announcement](https://www.minimax.io/blog/minimax-m3) and [OpenClaw MiniMax provider](https://github.com/openclaw/openclaw/blob/679193c5ffbc02f96a54779da68e480145512cfa/docs/providers/minimax.md)
- [Qwen current models](https://docs.qwencloud.com/developer-guides/getting-started/latest-model), [model changelog](https://docs.qwencloud.com/changelog/models), and [Token Plan restrictions](https://docs.qwencloud.com/token-plan/personal/token-plan-personal-overview)
- [OpenClaw Qwen migration](https://github.com/openclaw/openclaw/blob/679193c5ffbc02f96a54779da68e480145512cfa/docs/providers/qwen.md)
- [xAI Grok 4.6](https://docs.x.ai/developers/grok-4-6) and [OpenClaw xAI catalog](https://github.com/openclaw/openclaw/blob/679193c5ffbc02f96a54779da68e480145512cfa/extensions/xai/openclaw.plugin.json)
- [Artificial Analysis API reference](https://artificialanalysis.ai/api-reference) and [methodology](https://artificialanalysis.ai/methodology/intelligence-benchmarking)
- [Anthropic historical Agent SDK plan notice](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
