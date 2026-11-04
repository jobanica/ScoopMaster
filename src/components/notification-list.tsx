import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/dates";
import { openNotification } from "@/app/actions/notifications";
import { Empty, StatusBadge } from "./ui";

export async function NotificationList({ userId }: { userId: string }) {
  const rows = await prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 150 });
  if (!rows.length) return <Empty>No notifications.</Empty>;
  return (
    <ul className="divide-y divide-choco-50 rounded-2xl border border-choco-100 bg-white">
      {rows.map((n) => (
        <li key={n.id} className={n.readAt ? "opacity-70" : "bg-cream-50"}>
          <form action={openNotification}>
            <input type="hidden" name="id" value={n.id} />
            <button className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-cream-100">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-berry-500"}`} />
              <span className="flex-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-choco-900">{n.title} <StatusBadge status={n.severity} /></span>
                {n.body && <span className="block text-sm text-choco-600">{n.body}</span>}
                <span className="block text-xs text-choco-400">{fmtDateTime(n.createdAt)} · {n.type.replace(/_/g, " ").toLowerCase()}</span>
              </span>
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}
