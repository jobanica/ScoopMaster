import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { AppError } from "./errors";

export type ActionState = { ok?: boolean; error?: string; message?: string; at?: number } | null;
type Result = void | string | { redirect?: string; message?: string; revalidate?: string[] };

/**
 * Wraps a server action for useActionState: maps known errors to messages,
 * never leaks internals, and performs redirects outside the try/catch.
 */
export function safeAction(fn: (fd: FormData) => Promise<Result>) {
  return async (_prev: ActionState, fd: FormData): Promise<ActionState> => {
    let to: string | undefined;
    let message = "Saved.";
    try {
      const r = await fn(fd);
      if (typeof r === "string") to = r;
      else if (r) {
        to = r.redirect;
        if (r.message) message = r.message;
        r.revalidate?.forEach((p) => revalidatePath(p));
      }
    } catch (e) {
      return { error: errorMessage(e), at: Date.now() };
    }
    if (to) redirect(to);
    return { ok: true, message, at: Date.now() };
  };
}

export function errorMessage(e: unknown): string {
  if (e instanceof AppError) return e.message;
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") return "A record with the same unique value already exists.";
    if (e.code === "P2025") return "The record was not found or was changed by someone else.";
    if (e.code === "P2034") return "Another user changed this data at the same time. Please try again.";
  }
  if (e instanceof Error && /Invalid (amount|date)|required|must be/i.test(e.message)) return e.message;
  console.error(e);
  return "Something went wrong. Please try again or contact your administrator.";
}
