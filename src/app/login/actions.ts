"use server";
import { redirect } from "next/navigation";
import { login, logout } from "@/lib/auth";
import type { ActionState } from "@/lib/action";

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get("email") ?? "");
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };
  const r = await login(email, password);
  if (!r.ok) return { error: r.error };
  redirect(r.role === "PARTNER" ? "/portal" : "/dashboard");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}
