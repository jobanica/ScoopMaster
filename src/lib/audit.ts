import type { Prisma } from "@prisma/client";
import type { Tx } from "./db";

type AuditInput = {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
};

/** JSON-safe clone: Decimals/Dates become strings. */
function snapshot(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val)));
}

/** Writes an audit log row in the same transaction as the change it describes. */
export async function audit(tx: Tx, input: AuditInput): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary,
      before: snapshot(input.before),
      after: snapshot(input.after),
    },
  });
}
