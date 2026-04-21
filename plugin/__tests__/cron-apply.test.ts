import { describe, expect, it } from "vitest";
import { applyCronAuditPatches } from "../cron-apply.js";
import type { CronAuditJob, CronAuditReport } from "../cron-audit.js";

const jobs: CronAuditJob[] = [
  {
    id: "safe-change",
    name: "Safe change",
    payload: {
      kind: "agentTurn",
      message: "fix tests",
      model: "zai/glm-5.1",
      fallbacks: ["zai/glm-5"],
    },
  },
  {
    id: "low-confidence",
    name: "Low confidence",
    payload: {
      kind: "agentTurn",
      message: "handle weekly thing",
      model: "zai/glm-5.1",
    },
  },
];

const report: CronAuditReport = {
  totalJobs: 2,
  counts: { skip: 0, keep: 0, change: 2, review: 0 },
  items: [
    {
      id: "safe-change",
      name: "Safe change",
      action: "change",
      reason: "change:keyword:fix",
      confidence: "high",
      matchedSignals: ["keyword:fix"],
      agentId: null,
      sessionTarget: null,
      category: "code",
      risk: "medium",
      currentModel: "zai/glm-5.1",
      currentFallbacks: ["zai/glm-5"],
      suggestedModel: "openai-codex/gpt-5.4",
      suggestedFallbacks: ["zai/glm-5.1"],
      weightedCandidates: ["openai-codex/gpt-5.4", "zai/glm-5.1"],
      patch: {
        payload: {
          kind: "agentTurn",
          model: "openai-codex/gpt-5.4",
          fallbacks: ["zai/glm-5.1"],
        },
      },
    },
    {
      id: "low-confidence",
      name: "Low confidence",
      action: "change",
      reason: "change:no_match",
      confidence: "low",
      matchedSignals: ["no_match"],
      agentId: null,
      sessionTarget: null,
      category: "default",
      risk: "low",
      currentModel: "zai/glm-5.1",
      currentFallbacks: [],
      suggestedModel: "openai-codex/gpt-5.4",
      suggestedFallbacks: ["zai/glm-5.1"],
      weightedCandidates: ["openai-codex/gpt-5.4", "zai/glm-5.1"],
      patch: {
        payload: {
          kind: "agentTurn",
          model: "openai-codex/gpt-5.4",
          fallbacks: ["zai/glm-5.1"],
        },
      },
    },
  ],
};

describe("applyCronAuditPatches", () => {
  it("applies high-confidence changes and skips low-confidence changes by default", () => {
    const result = applyCronAuditPatches(jobs, report);

    expect(result.applied.map((item) => item.id)).toEqual(["safe-change"]);
    expect(result.skipped).toContainEqual(
      expect.objectContaining({ id: "low-confidence", reason: "skip:low_confidence" }),
    );
    expect(result.jobs[0].payload).toMatchObject({
      kind: "agentTurn",
      model: "openai-codex/gpt-5.4",
      fallbacks: ["zai/glm-5.1"],
    });
    expect(result.jobs[1].payload).toMatchObject({ model: "zai/glm-5.1" });
  });

  it("can apply low-confidence changes when explicitly allowed", () => {
    const result = applyCronAuditPatches(jobs, report, { includeLowConfidence: true });

    expect(result.applied.map((item) => item.id)).toEqual(["safe-change", "low-confidence"]);
  });

  it("can apply a selected job subset", () => {
    const result = applyCronAuditPatches(jobs, report, { jobIds: ["low-confidence"], includeLowConfidence: true });

    expect(result.applied.map((item) => item.id)).toEqual(["low-confidence"]);
    expect(result.skipped).toContainEqual(expect.objectContaining({ id: "safe-change", reason: "skip:not_selected" }));
  });
});
