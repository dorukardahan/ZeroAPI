import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { maybePrefixChannelAdvisory } from "../advisory-delivery.js";
import { writePendingSubscriptionAdvisory } from "../subscription-advisory.js";

function advisory(providerId: string, label: string) {
  return {
    version: "1.0.0",
    updatedAt: "2026-04-19T12:00:00.000Z",
    summary: [`New supported providers detected outside current ZeroAPI policy: ${label}`],
    recommendedAction: "Re-run /zeroapi to review and accept these additions.",
    pendingProviders: [{ providerId, label }],
    pendingAuthProfiles: [],
  };
}

describe("channel advisory delivery", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prefixes a pending advisory once per conversation", () => {
    const openclawDir = mkdtempSync(join(tmpdir(), "zeroapi-delivery-"));
    tempDirs.push(openclawDir);
    writePendingSubscriptionAdvisory(openclawDir, advisory("moonshot", "Kimi"));

    const first = maybePrefixChannelAdvisory(
      openclawDir,
      { to: "C123", content: "hello", metadata: { threadTs: "1111.2222" } },
      { channelId: "slack", accountId: "default" },
    );
    expect(first).toContain("ZeroAPI found new routing options you have not added yet:");
    expect(first).toContain("Provider: Kimi");
    expect(first).toContain("Run /zeroapi to review and update the policy.");
    expect(first).toContain("\n\nhello");

    const second = maybePrefixChannelAdvisory(
      openclawDir,
      { to: "C123", content: "hello", metadata: { threadTs: "1111.2222" } },
      { channelId: "slack", accountId: "default" },
    );
    expect(second).toBeNull();
  });

  it("keeps conversations independent and re-shows on advisory changes", () => {
    const openclawDir = mkdtempSync(join(tmpdir(), "zeroapi-delivery-"));
    tempDirs.push(openclawDir);
    writePendingSubscriptionAdvisory(openclawDir, advisory("moonshot", "Kimi"));

    const firstConversation = maybePrefixChannelAdvisory(
      openclawDir,
      { to: "dm-user", content: "reply one" },
      { channelId: "terminal", conversationId: "conv-a" },
    );
    expect(firstConversation).toContain("Provider: Kimi");

    const secondConversation = maybePrefixChannelAdvisory(
      openclawDir,
      { to: "dm-user", content: "reply two" },
      { channelId: "terminal", conversationId: "conv-b" },
    );
    expect(secondConversation).toContain("Provider: Kimi");

    writePendingSubscriptionAdvisory(openclawDir, advisory("openai-codex", "OpenAI"));
    const refreshed = maybePrefixChannelAdvisory(
      openclawDir,
      { to: "dm-user", content: "reply three" },
      { channelId: "terminal", conversationId: "conv-a" },
    );
    expect(refreshed).toContain("Provider: OpenAI");
  });

  it("skips empty and silent replies", () => {
    const openclawDir = mkdtempSync(join(tmpdir(), "zeroapi-delivery-"));
    tempDirs.push(openclawDir);
    writePendingSubscriptionAdvisory(openclawDir, advisory("moonshot", "Kimi"));

    expect(
      maybePrefixChannelAdvisory(
        openclawDir,
        { to: "C123", content: "   " },
        { channelId: "slack" },
      ),
    ).toBeNull();

    expect(
      maybePrefixChannelAdvisory(
        openclawDir,
        { to: "C123", content: "NO_REPLY" },
        { channelId: "slack" },
      ),
    ).toBeNull();
  });
});
