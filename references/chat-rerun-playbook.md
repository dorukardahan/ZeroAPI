# Chat Rerun Playbook

This document defines how `/zeroapi` should start a **re-run** inside chat channels.

Goal:

- make the reason for the re-run obvious
- avoid restarting from a blank setup
- ask the smallest useful first question
- keep the flow safe for Slack, Telegram, WhatsApp, Matrix, Discord, and terminal chat

## Drift kinds

ZeroAPI reruns should think in three drift kinds:

1. `provider_only`
2. `account_only`
3. `mixed`

These labels correspond to the advisory file:

- `provider_only` = new supported provider detected
- `account_only` = new same-provider auth profile/account detected
- `mixed` = both happened at once

If no advisory exists but `zeroapi-config.json` exists, treat the run as a normal config refresh.

## First-question policy

The first chat question should adapt to the drift kind.

### 1. provider_only

Use when the runtime gained a new supported provider but no new same-provider account drift exists.

First message shape:

```text
I found a new provider ZeroAPI is not using yet:
- Kimi

Current ZeroAPI policy still uses OpenAI + GLM.
Should I add this provider to the managed routing pool?
1. Add it
2. Keep current pool
3. Review current pool first
```

What this question is trying to learn:

- whether the user wants the new provider included at all
- whether the run is an expansion or only a review

Do not ask about account-pool behavior first in this case.

### 2. account_only

Use when the provider already exists in policy, but ZeroAPI found one or more new auth profiles or accounts for that same provider.

First message shape:

```text
I found a new OpenAI account ZeroAPI is not using yet:
- openai:work

Do you want ZeroAPI to treat OpenAI as an account pool?
1. Yes, add this account
2. No, keep the current account setup
3. Review current OpenAI setup first
```

What this question is trying to learn:

- whether the user wants same-provider pooling at all
- whether the account should be ignored, added, or reviewed

Do not start by asking for provider tiers again if the only drift is account-level.

### 3. mixed

Use when both new providers and new same-provider accounts exist.

First message shape:

```text
I found two kinds of ZeroAPI drift:
- New provider: Kimi
- New account: openai:work

What should I update first?
1. Provider additions
2. Account-pool additions
3. Review everything together
```

What this question is trying to learn:

- whether the user wants expansion by provider first or inventory cleanup first
- whether the run should stay compact or go into a full review

This is the only case where a "what first?" question is preferred over a direct yes/no style question.

### 4. no advisory, existing config

Use when `zeroapi-config.json` exists but no advisory drift is present.

First message shape:

```text
I found an existing ZeroAPI policy:
- Providers: OpenAI, GLM
- Modifier: balanced

What do you want to change?
1. Provider pool
2. Account-pool setup
3. Modifier
4. Just regenerate from current choices
```

This is a maintenance rerun, not a drift rerun.

## Defaults after the first question

After the user answers the first question:

- reuse current providers as the default selection
- reuse current modifier as the default selection
- reuse current inventory accounts as defaults where relevant
- only ask about the changed surface unless the user asks for a full review

Examples:

- provider-only drift accepted -> ask about the new provider's tier, then continue with current modifier as default
- account-only drift accepted -> ask account-pool details for that provider only
- provider-only drift declined -> do not reopen all provider questions unless the user asks

## Anti-patterns

Avoid these on reruns:

- asking the full original onboarding flow again
- dumping the full advisory JSON
- asking about every provider when only one provider drifted
- asking about account pools when drift is provider-only
- asking broad open-ended questions first when a tight choice is available

## Short examples

Good:

```text
I found a new provider ZeroAPI is not using yet:
- Kimi

Should I add it to the managed routing pool?
1. Yes
2. No
3. Review current pool first
```

Bad:

```text
I found some changes. Please describe all subscriptions, providers, and accounts you want ZeroAPI to manage.
```

The bad version throws away context. The good version starts from detected state.
