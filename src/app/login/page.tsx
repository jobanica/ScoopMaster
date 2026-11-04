import { redirect } from "next/navigation";
import Image from "next/image";
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
        <div className="card overflow-hidden">
          <div className="border-b border-choco-50 bg-white px-6 pb-4 pt-6">
            <h1 className="sr-only">Scoop Master — Your Partner in Every Scoop</h1>
            <Image src="/brand/logo.png" alt="Scoop Master — Your Partner in Every Scoop." width={662} height={294} priority className="mx-auto h-auto w-full max-w-[300px]" />
          </div>
          <div className="p-6">
          <ActionForm action={loginAction}>
            <Field label="Email" name="email" type="email" required />
            <Field label="Password" name="password" type="password" required />
            <SubmitButton className="btn-primary w-full" pendingText="Signing in…">Sign in</SubmitButton>
          </ActionForm>
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-choco-500">Soft-Serve Ice Cream Business Management System · Partners: use the account provided by Scoop Master.</p>
      </div>
    </main>
  );
}
