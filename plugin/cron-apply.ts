import type { CronAuditJob, CronAuditReport } from "./cron-audit.js";

type UnknownRecord = Record<string, unknown>;

export type CronApplyOptions = {
  includeLowConfidence?: boolean;
  jobIds?: string[];
};

export type CronApplyDecision = {
  id: string;
  name: string;
  action: "apply" | "skip";
  reason: string;
  confidence: string;
  model: string | null;
  fallbacks: string[];
};

export type CronApplyResult = {
  jobs: CronAuditJob[];
  applied: CronApplyDecision[];
  skipped: CronApplyDecision[];
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeJobIds(jobIds: string[] | undefined): Set<string> | null {
  if (!jobIds?.length) return null;
  return new Set(jobIds.map((id) => id.trim()).filter(Boolean));
}

export function applyCronAuditPatches(
  jobs: CronAuditJob[],
  report: CronAuditReport,
  options: CronApplyOptions = {},
): CronApplyResult {
  const allowedJobIds = normalizeJobIds(options.jobIds);
  const applied: CronApplyDecision[] = [];
  const skipped: CronApplyDecision[] = [];

  const nextJobs = jobs.map((job, index) => {
    const item = report.items[index];
    if (!item) return job;

    const decisionBase = {
      id: item.id,
      name: item.name,
      confidence: item.confidence,
      model: item.patch?.payload.model ?? null,
      fallbacks: item.patch?.payload.fallbacks ?? [],
    };

    if (allowedJobIds && !allowedJobIds.has(item.id)) {
      skipped.push({ ...decisionBase, action: "skip", reason: "skip:not_selected" });
      return job;
    }

    if (item.action !== "change" || !item.patch) {
      skipped.push({ ...decisionBase, action: "skip", reason: `skip:${item.action}` });
      return job;
    }

    if (item.confidence === "low" && !options.includeLowConfidence) {
      skipped.push({ ...decisionBase, action: "skip", reason: "skip:low_confidence" });
      return job;
    }

    const payload = isRecord(job.payload) ? job.payload : {};
    const nextPayload: UnknownRecord = {
      ...payload,
      kind: "agentTurn",
      model: item.patch.payload.model,
    };
    if (item.patch.payload.fallbacks?.length) {
      nextPayload.fallbacks = item.patch.payload.fallbacks;
    } else {
      delete nextPayload.fallbacks;
    }

    applied.push({ ...decisionBase, action: "apply", reason: item.reason });
    return {
      ...job,
      payload: nextPayload,
    };
  });

  return { jobs: nextJobs, applied, skipped };
}
