import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ROLE_LABEL, STAFF_ROLES } from "@/lib/rbac";
import { fmtDateTime } from "@/lib/dates";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ActionForm, ConfirmAction, Field, SelectField, SubmitButton } from "@/components/forms";
import { changeRoleAction, createStaffAction, resetPasswordAction, toggleUserAction } from "../actions";

export const metadata = { title: "Users" };
export default async function UsersPage() {
  const me = await requirePage("users:manage");
  const users = await prisma.user.findMany({ include: { partner: true }, orderBy: [{ role: "asc" }, { name: "asc" }] });
  const roleOpts = STAFF_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }));
  return (
    <div>
      <PageHeader title="Users & roles" subtitle="Partner logins are created from each partner's Portal users tab." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" pad={false}>
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last login</th><th></th></tr></thead>
            <tbody>{users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td><td className="text-xs">{u.email}</td>
                <td>{ROLE_LABEL[u.role]}{u.partner && <div className="text-xs"><Link className="link" href={`/partners/${u.partner.id}`}>{u.partner.businessName}</Link></div>}</td>
                <td>{u.isActive ? <Badge tone="mint">active</Badge> : <Badge>disabled</Badge>}{u.lockedUntil && u.lockedUntil > new Date() && <Badge tone="berry">locked</Badge>}</td>
                <td className="text-xs">{fmtDateTime(u.lastLoginAt)}</td>
                <td className="whitespace-nowrap">{u.id !== me.id && <div className="flex flex-wrap gap-1">
                  <ConfirmAction action={toggleUserAction} label={u.isActive ? "Disable" : "Enable"} size="sm" variant="secondary" title={`${u.isActive ? "Disable" : "Enable"} ${u.name}?`} hidden={{ id: u.id, active: u.isActive ? "0" : "1" }} />
                  <ConfirmAction action={resetPasswordAction} label="Reset password" size="sm" variant="secondary" title={`Reset password for ${u.name}`} hidden={{ id: u.id }}><Field label="New password" name="password" required hint="At least 10 characters with letters and numbers" /></ConfirmAction>
                  {u.role !== "PARTNER" && <ConfirmAction action={changeRoleAction} label="Role" size="sm" variant="secondary" title={`Change role for ${u.name}`} hidden={{ id: u.id }}><SelectField label="Role" name="role" defaultValue={u.role} options={roleOpts} /></ConfirmAction>}
                </div>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </Card>
        <Card title="Add staff user">
          <ActionForm action={createStaffAction} resetOnSuccess>
            <Field label="Name" name="name" required />
            <Field label="Email" name="email" type="email" required />
            <SelectField label="Role" name="role" options={roleOpts} defaultValue="OPERATIONS" />
            <Field label="Temporary password" name="password" required />
            <SubmitButton>Create user</SubmitButton>
          </ActionForm>
          <div className="mt-4 space-y-1 text-xs text-choco-600">
            <p><b>Admin</b>: partners, machines, inventory, sales, settlements approval, reports.</p>
            <p><b>Finance</b>: payments, payables, receivables, expenses, settlement preparation.</p>
            <p><b>Warehouse</b>: inventory, stock movements, supply orders.</p>
            <p><b>Operations</b>: partner operations, machines, maintenance.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
