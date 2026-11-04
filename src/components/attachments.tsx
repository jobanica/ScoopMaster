import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { fmtDateTime } from "@/lib/dates";
import { canViewAttachment, ATTACHABLE } from "@/server/attachments";
import { uploadAttachment } from "@/app/actions/attachments";
import { ActionForm, SubmitButton } from "./forms";
import { Card, Badge } from "./ui";

export async function Attachments({ entityType, entityId, back, categories = ["GENERAL"], title = "Attachments" }: { entityType: string; entityId: string; back: string; categories?: string[]; title?: string }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const rows = (await prisma.attachment.findMany({ where: { entityType, entityId }, orderBy: { createdAt: "desc" } })).filter((a) => canViewAttachment(user, a));
  const rule = ATTACHABLE[entityType];
  const canUpload = user.role === "PARTNER" ? rule?.partnerCan : rule && can(user.role, rule.staffPerm);
  return (
    <Card title={title}>
      {rows.length === 0 ? <p className="text-sm text-choco-500">No files attached.</p> : (
        <ul className="divide-y divide-choco-50">
          {rows.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <a className="link truncate" href={`/api/files/${a.id}`} target="_blank" rel="noreferrer">{a.fileName}</a>
              <span className="flex shrink-0 items-center gap-2 text-xs text-choco-500">
                <Badge tone="choco">{a.category.replace(/_/g, " ").toLowerCase()}</Badge>
                {a.confidential && <Badge tone="berry">confidential</Badge>}
                {fmtDateTime(a.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <ActionForm action={uploadAttachment} resetOnSuccess className="mt-4 space-y-2 border-t border-choco-50 pt-4">
          <input type="hidden" name="entityType" value={entityType} />
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="back" value={back} />
          <div className="flex flex-wrap items-center gap-2">
            <input type="file" name="file" accept="application/pdf,image/png,image/jpeg,image/webp" required className="text-sm" />
            {categories.length > 1 ? (
              <select name="category" className="input w-auto">{categories.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ").toLowerCase()}</option>)}</select>
            ) : <input type="hidden" name="category" value={categories[0]} />}
            {user.role !== "PARTNER" && can(user.role, "partners:confidential") && entityType === "Partner" && (
              <label className="flex items-center gap-1 text-xs text-choco-600"><input type="checkbox" name="confidential" /> Confidential (ID documents)</label>
            )}
            <SubmitButton className="btn-secondary btn-sm" pendingText="Uploading…">Upload</SubmitButton>
          </div>
          <p className="text-xs text-choco-500">PDF, PNG, JPEG or WEBP · max 10 MB</p>
        </ActionForm>
      )}
    </Card>
  );
}
