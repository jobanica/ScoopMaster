import { redirect } from "next/navigation";
import { IceCreamCone } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { loginAction } from "./actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(user.role === "PARTNER" ? "/portal" : "/dashboard");
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-cream-100 via-cream-50 to-berry-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-choco-700 text-cream-50 shadow-card"><IceCreamCone size={28} /></span>
          <h1 className="mt-3 text-2xl font-extrabold tracking-widest text-choco-800">SCOOP MASTER</h1>
          <p className="text-sm text-choco-500">Soft-Serve Ice Cream Business Management System</p>
        </div>
        <div className="card p-6">
          <ActionForm action={loginAction}>
            <Field label="Email" name="email" type="email" required />
            <Field label="Password" name="password" type="password" required />
            <SubmitButton className="btn-primary w-full" pendingText="Signing in…">Sign in</SubmitButton>
          </ActionForm>
        </div>
        <p className="mt-4 text-center text-xs text-choco-500">Partners: use the account provided by Scoop Master.</p>
      </div>
    </main>
  );
}
