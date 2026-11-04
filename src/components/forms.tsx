"use client";
import { createContext, useActionState, useContext, useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/action";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const PendingContext = createContext(false);

/**
 * Submits a server action WITHOUT React 19's automatic form reset, so a validation error never wipes what the
 * user typed. The clicked submit button's name/value is included (e.g. intent=submit|draft).
 */
export function useActionSubmit(action: Action) {
  const [state, formAction] = useActionState(action, null);
  const [pending, startTransition] = useTransition();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null);
    startTransition(() => formAction(fd));
  };
  return { state, pending, onSubmit };
}

export function PendingProvider({ pending, children }: { pending: boolean; children: ReactNode }) {
  return <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>;
}

export function SubmitButton({ children, className = "btn-primary", pendingText = "Saving…", name, value }: { children: ReactNode; className?: string; pendingText?: string; name?: string; value?: string }) {
  const { pending: formPending } = useFormStatus();
  const pending = useContext(PendingContext) || formPending;
  return (
    <button type="submit" className={className} disabled={pending} name={name} value={value}>
      {pending ? pendingText : children}
    </button>
  );
}

/** Form bound to a safeAction; shows inline error / success. */
export function ActionForm({ action, children, className = "space-y-4", resetOnSuccess = false, successMessage }: { action: Action; children: ReactNode; className?: string; resetOnSuccess?: boolean; successMessage?: string }) {
  const { state, pending, onSubmit } = useActionSubmit(action);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <PendingProvider pending={pending}>
    <form ref={ref} onSubmit={onSubmit} className={className}>
      {state?.error && <div role="alert" className="rounded-lg bg-berry-50 px-3 py-2 text-sm font-medium text-berry-700">{state.error}</div>}
      {state?.ok && <div role="status" className="rounded-lg bg-mint-50 px-3 py-2 text-sm font-medium text-mint-700">{successMessage ?? state.message}</div>}
      {children}
    </form>
    </PendingProvider>
  );
}

/**
 * A button that opens a confirmation dialog before submitting a server action.
 * Optional reason/notes field (required when `reasonRequired`).
 */
export function ConfirmAction({
  action, label, title, description, hidden = {}, variant = "primary", size, reasonLabel, reasonRequired = false, confirmLabel = "Confirm", children,
}: {
  action: Action; label: ReactNode; title: string; description?: ReactNode; hidden?: Record<string, string>; variant?: "primary" | "secondary" | "danger" | "success";
  size?: "sm"; reasonLabel?: string; reasonRequired?: boolean; confirmLabel?: string; children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit } = useActionSubmit(action);
  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);
  const cls = { primary: "btn-primary", secondary: "btn-secondary", danger: "btn-danger", success: "btn-success" }[variant] + (size === "sm" ? " btn-sm" : "");
  return (
    <>
      <button type="button" className={cls} onClick={() => setOpen(true)}>{label}</button>
      {state?.error && !open && <span className="text-xs font-medium text-berry-700">{state.error}</span>}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-choco-900/40 p-4" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-choco-900">{title}</h3>
            {description && <div className="mt-1 text-sm text-choco-600">{description}</div>}
            <PendingProvider pending={pending}>
            <form onSubmit={onSubmit} className="mt-4 space-y-3">
              {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              {children}
              {reasonLabel && (
                <label className="block">
                  <span className="label">{reasonLabel}{reasonRequired && " *"}</span>
                  <textarea name="reason" className="input" rows={3} required={reasonRequired} />
                </label>
              )}
              {state?.error && <div role="alert" className="rounded-lg bg-berry-50 px-3 py-2 text-sm text-berry-700">{state.error}</div>}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
                <SubmitButton className={variant === "danger" ? "btn-danger" : "btn-primary"} pendingText="Working…">{confirmLabel}</SubmitButton>
              </div>
            </form>
            </PendingProvider>
          </div>
        </div>
      )}
    </>
  );
}

export function Field({ label, name, type = "text", defaultValue, required, placeholder, hint, step, min, max, readOnly }: {
  label: string; name: string; type?: string; defaultValue?: string | number | null; required?: boolean; placeholder?: string; hint?: string; step?: string; min?: string; max?: string; readOnly?: boolean;
}) {
  return (
    <label className="block">
      <span className="label">{label}{required && " *"}</span>
      <input className="input" name={name} type={type} defaultValue={defaultValue ?? undefined} required={required} placeholder={placeholder} step={step} min={min} max={max} readOnly={readOnly} />
      {hint && <span className="mt-1 block text-xs text-choco-500">{hint}</span>}
    </label>
  );
}

export function SelectField({ label, name, options, defaultValue, required, placeholder }: {
  label: string; name: string; options: { value: string; label: string }[]; defaultValue?: string | null; required?: boolean; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}{required && " *"}</span>
      <select className="input" name={name} defaultValue={defaultValue ?? ""} required={required}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function TextArea({ label, name, defaultValue, rows = 3, required, placeholder }: { label: string; name: string; defaultValue?: string | null; rows?: number; required?: boolean; placeholder?: string }) {
  return (
    <label className="block">
      <span className="label">{label}{required && " *"}</span>
      <textarea className="input" name={name} rows={rows} defaultValue={defaultValue ?? undefined} required={required} placeholder={placeholder} />
    </label>
  );
}

export function Checkbox({ label, name, defaultChecked, hint }: { label: string; name: string; defaultChecked?: boolean; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm text-choco-800">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 h-4 w-4 rounded border-choco-300 accent-choco-700" />
      <span>{label}{hint && <span className="block text-xs text-choco-500">{hint}</span>}</span>
    </label>
  );
}

export function PrintButton({ label = "Print" }: { label?: string }) {
  return <button type="button" className="btn-secondary" onClick={() => window.print()}>{label}</button>;
}

/** Dates are entered and shown as DD/MM/YYYY (Asia/Manila business dates). */
export function DateField({ label, name, defaultValue, required, hint }: { label: string; name: string; defaultValue?: string | null; required?: boolean; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}{required && " *"}</span>
      <input className="input" name={name} type="text" inputMode="numeric" placeholder="DD/MM/YYYY" pattern="\d{2}/\d{2}/\d{4}" title="DD/MM/YYYY" defaultValue={defaultValue ?? undefined} required={required} />
      {hint && <span className="mt-1 block text-xs text-choco-500">{hint}</span>}
    </label>
  );
}
