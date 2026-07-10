# Provider and model status — 2026-07-10

Benchmark evidence and runtime availability are separate. A direct Artificial Analysis (AA) row does not prove that a subscription provider can route the model; a routeable model may also need an explicit proxy until AA publishes a matching row.

| Provider/model | Benchmark evidence | Subscription route status |
|---|---|---|
| OpenAI `gpt-5.6-sol`, `-terra`, `-luna` | No direct row; explicit GPT-5.5 proxy | Routeable through canonical `openai/*` with the Codex runtime when the account catalog exposes the preview. Sol is the fresh starter; Terra/Luna are fallbacks. |
| Z.AI `glm-5.2` | Direct `glm-5-2` row | Routeable as `zai/glm-5.2`; Coding Plan default. |
| Moonshot `kimi-k2.7-code` | Direct `kimi-k2-7-code` row | Routeable and code-focused. `kimi-k2.6` remains the general/default route. |
| MiniMax `MiniMax-M3` | Direct `minimax-m3` row | Routeable as `minimax-portal/MiniMax-M3`; M2.7 remains a fallback. |
| Qwen Cloud `qwen3.7-plus`, `qwen3.7-max` | Direct rows | Reference metadata for the separate `qwen` Cloud/Coding Plan or Standard surfaces. They are not Qwen Portal routes. |
| Qwen Portal `qwen-oauth/qwen3.5-plus` | Explicit Qwen3.6 Plus proxy | Routeable Portal default. Portal's documented static catalog does not include Qwen 3.7. `qwen-portal` and `qwen-cli` remain aliases. |
| xAI `grok-build-0.1` | Direct `grok-build-0-1-06-16` row | Routeable and code-focused. |
| xAI `grok-4.5` | No direct row; conservative Grok 4.3 proxy | Routeable where available. Grok 4.3 remains the regional-safe fallback. |

## Observed or excluded horizon providers

- Anthropic (updated 2026-06-15): Anthropic says Claude Agent SDK, `claude -p`, and third-party app usage still draw from signed-in subscription limits while its separate Agent SDK credit plan is paused. ZeroAPI still does not auto-enable Anthropic. The required canonical `anthropic/*` plus `agentRuntime.id: "claude-cli"` path has not been implemented and tested end to end.
- Google (status checked 2026-07-10): Gemini CLI individual access is being sunset in favor of the Antigravity transition. ZeroAPI has no routeable Google subscription provider. Gemini API keys are usage-billed and remain outside subscription capacity.
- DeepSeek, Mistral, and Cohere (status checked 2026-07-10): API-key/pay-as-you-go reference horizon only; not auto-routed as subscription capacity.

## Public sources

- [OpenAI GPT-5.6 preview](https://openai.com/index/previewing-gpt-5-6-sol/)
- [Anthropic Agent SDK plan notice](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- [OpenClaw OpenAI provider evidence, pinned source](https://github.com/openclaw/openclaw/blob/dff4c634f1a56d974a1e4faaa9520527ab026774/docs/providers/openai.md)
- [OpenClaw Z.AI provider evidence, pinned source](https://github.com/openclaw/openclaw/blob/dff4c634f1a56d974a1e4faaa9520527ab026774/docs/providers/zai.md)
- [OpenClaw Moonshot provider evidence, pinned source](https://github.com/openclaw/openclaw/blob/dff4c634f1a56d974a1e4faaa9520527ab026774/docs/providers/moonshot.md)
- [OpenClaw MiniMax provider evidence, pinned source](https://github.com/openclaw/openclaw/blob/dff4c634f1a56d974a1e4faaa9520527ab026774/docs/providers/minimax.md)
- [OpenClaw Qwen Cloud evidence, pinned source](https://github.com/openclaw/openclaw/blob/dff4c634f1a56d974a1e4faaa9520527ab026774/docs/providers/qwen.md)
- [OpenClaw Qwen Portal evidence, pinned source](https://github.com/openclaw/openclaw/blob/dff4c634f1a56d974a1e4faaa9520527ab026774/docs/providers/qwen-oauth.md)
- [OpenClaw xAI evidence, pinned source](https://github.com/openclaw/openclaw/blob/dff4c634f1a56d974a1e4faaa9520527ab026774/docs/providers/xai.md)
- [Artificial Analysis methodology](https://artificialanalysis.ai/methodology/intelligence-benchmarking)
