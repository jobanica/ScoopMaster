import type { Tx } from "./db";

/** Atomically increments a named counter inside the caller's transaction. */
export async function nextNumber(tx: Tx, key: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"`;
  return Number(rows[0].value);
}

export async function nextCode(tx: Tx, prefix: string, pad = 5, opts: { yearly?: boolean } = {}): Promise<string> {
  const year = new Date().getUTCFullYear();
  const key = opts.yearly ? `${prefix}-${year}` : prefix;
  const n = await nextNumber(tx, key);
  return opts.yearly ? `${prefix}-${year}-${String(n).padStart(pad, "0")}` : `${prefix}-${String(n).padStart(pad, "0")}`;
}
