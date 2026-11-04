import { requirePartner } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ConfirmAction } from "@/components/forms";
import { NotificationList } from "@/components/notification-list";
import { markAllReadAction } from "@/app/actions/notifications";

export const metadata = { title: "Notifications" };
export default async function PortalNotifications() {
  const user = await requirePartner();
  return <div><PageHeader title="Notifications" actions={<ConfirmAction action={markAllReadAction} label="Mark all read" title="Mark all as read?" variant="secondary" />} /><NotificationList userId={user.id} /></div>;
}
