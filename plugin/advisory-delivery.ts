import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  advisoryFingerprint,
  listPendingSubscriptionAdvisoryItems,
  readPendingSubscriptionAdvisory,
  type PendingSubscriptionAdvisory,
} from "./subscription-advisory.js";

const DELIVERY_FILE = "zeroapi-advisory-delivery.json";
const DELIVERY_VERSION = "1.0.0";
const MAX_DELIVERY_RECORDS = 200;
const SILENT_REPLY_TOKEN = "NO_REPLY";

type MessageSendingEvent = {
  to: string;
  content: string;
  metadata?: Record<string, unknown>;
};

type MessageSendingContext = {
  channelId: string;
  accountId?: string;
  conversationId?: string;
};

type DeliveryRecord = {
  channelId: string;
  conversationKey: string;
  deliveredAt: string;
  fingerprint: string;
};

type DeliveryState = {
  delivered: Record<string, DeliveryRecord>;
  version: string;
};

function buildConversationKey(event: MessageSendingEvent, ctx: MessageSendingContext): string {
  const metadataConversationId =
    typeof event.metadata?.conversationId === "string" && event.metadata.conversationId.trim()
      ? event.metadata.conversationId.trim()
      : null;
  const metadataThreadId =
    typeof event.metadata?.threadTs === "string" && event.metadata.threadTs.trim()
      ? event.metadata.threadTs.trim()
      : null;
  const conversationId = ctx.conversationId?.trim() || metadataConversationId || metadataThreadId || event.to;
  const accountId = ctx.accountId?.trim() || "default";
  return `${ctx.channelId}::${accountId}::${conversationId}`;
}

function readDeliveryState(openclawDir: string): DeliveryState {
  const deliveryPath = join(openclawDir, DELIVERY_FILE);
  try {
    const parsed = JSON.parse(readFileSync(deliveryPath, "utf-8")) as Partial<DeliveryState>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.version !== "string") {
      return { version: DELIVERY_VERSION, delivered: {} };
    }
    const delivered =
      parsed.delivered && typeof parsed.delivered === "object" ? parsed.delivered : {};
    return {
      version: DELIVERY_VERSION,
      delivered: delivered as Record<string, DeliveryRecord>,
    };
  } catch {
    return { version: DELIVERY_VERSION, delivered: {} };
  }
}

function writeDeliveryState(openclawDir: string, state: DeliveryState): void {
  const deliveryPath = join(openclawDir, DELIVERY_FILE);
  mkdirSync(dirname(deliveryPath), { recursive: true });
  const tmpPath = `${deliveryPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  renameSync(tmpPath, deliveryPath);
}

function pruneDeliveryState(delivered: Record<string, DeliveryRecord>): Record<string, DeliveryRecord> {
  const entries = Object.entries(delivered);
  if (entries.length <= MAX_DELIVERY_RECORDS) {
    return delivered;
  }

  return Object.fromEntries(
    entries
      .sort((a, b) => a[1].deliveredAt.localeCompare(b[1].deliveredAt))
      .slice(-MAX_DELIVERY_RECORDS),
  );
}

function formatChannelAdvisory(advisory: PendingSubscriptionAdvisory): string {
  const lines = ["ZeroAPI found new routing options you have not added yet:"];
  const detailLines = listPendingSubscriptionAdvisoryItems(advisory).map((item) => `- ${item}`);
  const preview = detailLines.slice(0, 4);
  const remaining = detailLines.length - preview.length;

  lines.push(...preview);
  if (remaining > 0) {
    lines.push(`- +${remaining} more pending additions`);
  }
  lines.push("Run /zeroapi to review and update the policy.");
  return lines.join("\n");
}

export function clearDeliveredAdvisories(openclawDir: string): void {
  rmSync(join(openclawDir, DELIVERY_FILE), { force: true });
}

export function maybePrefixChannelAdvisory(
  openclawDir: string,
  event: MessageSendingEvent,
  ctx: MessageSendingContext,
): string | null {
  const content = event.content.trim();
  if (!content || content.toUpperCase() === SILENT_REPLY_TOKEN) {
    return null;
  }

  const advisory = readPendingSubscriptionAdvisory(openclawDir);
  if (!advisory) {
    clearDeliveredAdvisories(openclawDir);
    return null;
  }

  const fingerprint = advisoryFingerprint(advisory);
  const conversationKey = buildConversationKey(event, ctx);
  const state = readDeliveryState(openclawDir);
  const existing = state.delivered[conversationKey];
  if (existing?.fingerprint === fingerprint) {
    return null;
  }

  state.delivered[conversationKey] = {
    fingerprint,
    deliveredAt: new Date().toISOString(),
    channelId: ctx.channelId,
    conversationKey,
  };
  state.delivered = pruneDeliveryState(state.delivered);
  writeDeliveryState(openclawDir, state);

  return `${formatChannelAdvisory(advisory)}\n\n${event.content}`;
}
