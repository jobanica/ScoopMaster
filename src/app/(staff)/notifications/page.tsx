import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import { ConfirmAction } from "@/components/forms";
import { NotificationList } from "@/components/notification-list";
import { markAllReadAction, runChecksAction } from "@/app/actions/notifications";

export const metadata = { title: "Notifications" };
export default async function NotificationsPage() {
  const user = await requirePage();
  return (
    <div className="max-w-4xl">
      <PageHeader title="Notification center" actions={<>
        {can(user.role, "notifications:manage") && <ConfirmAction action={runChecksAction} label="Run alert checks now" title="Run scheduled checks?" description="Scans for missing sales reports, low/expiring stock, due and overdue payments, maintenance, contract expiry and settlements due. Duplicate alerts are suppressed." variant="secondary" />}
        <ConfirmAction action={markAllReadAction} label="Mark all read" title="Mark all as read?" variant="secondary" />
      </>} />
      <NotificationList userId={user.id} />
    </div>
  );
}
