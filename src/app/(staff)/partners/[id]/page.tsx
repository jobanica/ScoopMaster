import Link from "next/link";
import { notFound } from "next/navigation";
import type { PartnerStatus } from "@prisma/client";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { D, formatPHP, formatQty, Decimal } from "@/lib/money";
import { fmtDate, fmtDateTime, todayDate } from "@/lib/dates";
import { UOM_LABEL } from "@/lib/units";
import { one, type SP } from "@/lib/params";
import { balanceOf, effectiveStatus } from "@/lib/calc/payments";
import { countDrivers, partnerPricing } from "@/server/services/sales";
import { Alert, Badge, Card, DL, Empty, LinkButton, PageHeader, Peso, StatusBadge, Stat, Tabs, humanize } from "@/components/ui";
import { ActionForm, Checkbox, ConfirmAction, DateField, Field, SelectField, SubmitButton, TextArea } from "@/components/forms";
import { Attachments } from "@/components/attachments";
import { applySuggestedCountProductsAction, changeStatusAction, createContractAction, createPartnerUserAction, setCountProductAction, setPriceAction } from "../actions";

const NEXT_STATUS: Record<PartnerStatus, PartnerStatus[]> = {
  PROSPECT: ["PENDING_APPROVAL", "TERMINATED"],
  PENDING_APPROVAL: ["ACTIVE", "PROSPECT", "TERMINATED"],
  ACTIVE: ["ON_HOLD", "TERMINATED"],
  ON_HOLD: ["ACTIVE", "TERMINATED"],
  TERMINATED: [],
};

const MODEL_LABEL = { PROFIT_SHARE: "Profit share (%)", FIXED_FEE: "Fixed fee to owner", FEE_PLUS_SHARE: "Fixed fee + profit share", REVENUE_SHARE: "Revenue share (%)" };

export default async function PartnerDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const user = await requirePage("partners:read");
  const { id } = await params;
  const tab = one((await searchParams).tab) ?? "overview";
  const p = await prisma.partner.findUnique({
    where: { id },
    include: { machines: true, contracts: { orderBy: { version: "desc" } }, location: true, users: { orderBy: { createdAt: "asc" } } },
  });
  if (!p) notFound();
  const active = p.contracts.find((c) => c.isActive);
  const today = todayDate();
  const [salesAgg, invoices, bills] = await Promise.all([
    prisma.salesReport.aggregate({ where: { partnerId: id, status: { in: ["SUBMITTED", "APPROVED"] } }, _sum: { netSales: true }, _count: true }),
    prisma.invoice.findMany({ where: { partnerId: id }, orderBy: { issueDate: "desc" } }),
    prisma.bill.findMany({ where: { partnerId: id }, orderBy: { billDate: "desc" } }),
  ]);
  const arOpen = invoices.filter((i) => ["UNPAID", "PARTIALLY_PAID"].includes(i.status));
  const arTotal = arOpen.reduce((a, i) => a.plus(balanceOf(i)), new Decimal(0));
  const apTotal = bills.filter((b) => ["UNPAID", "PARTIALLY_PAID"].includes(b.status)).reduce((a, b) => a.plus(balanceOf(b)), new Decimal(0));
  const base = `/partners/${id}`;
  const tabs = [
    { key: "overview", label: "Overview" }, { key: "contract", label: "Contract" }, { key: "prices", label: "Prices" }, { key: "sales", label: "Sales" },
    { key: "inventory", label: "Inventory" }, { key: "expenses", label: "Expenses" }, { key: "settlements", label: "Profit sharing" },
    { key: "balances", label: "Balances" }, { key: "documents", label: "Documents" }, { key: "users", label: "Portal users" },
  ].map((t) => ({ ...t, href: `${base}?tab=${t.key}` }));

  return (
    <div>
      <PageHeader
        title={p.businessName}
        back={{ href: "/partners", label: "Partners" }}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{p.code}</span><StatusBadge status={p.status} />{p.area && <span>· {p.area}</span>}</span>}
        actions={<>
          {can(user.role, "partners:write") && <LinkButton href={`${base}/edit`} variant="secondary">Edit</LinkButton>}
          {can(user.role, "partners:status") && NEXT_STATUS[p.status].map((s) => (
            <ConfirmAction key={s} action={changeStatusAction} label={`Set ${humanize(s)}`} title={`Change status to ${humanize(s)}?`} hidden={{ id: p.id, status: s }} reasonLabel="Reason" reasonRequired variant={s === "TERMINATED" ? "danger" : "secondary"}
              description={s === "TERMINATED" ? "Terminating disables the partner's portal accounts. Machines must be returned first." : undefined} />
          ))}
        </>}
      />
      <Tabs tabs={tabs} active={tab} />

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Profile" className="lg:col-span-2">
            <DL items={[
              ["Owner", p.ownerName], ["Contact number", p.contactNumber], ["Email", p.email], ["Address", p.address], ["Area", p.area],
              ["Partnership start", fmtDate(p.startDate)], ["Assigned machine(s)", p.machines.length ? p.machines.map((m) => <Link key={m.id} className="link mr-2" href={`/machines/${m.id}`}>{m.code}</Link>) : "None"],
              ["Partnership terms", active ? `${MODEL_LABEL[active.shareModel]} · owner ${active.ownerSharePct.toString()}% / partner ${active.partnerSharePct.toString()}%` : <span className="text-berry-700">No active contract</span>],
              ["Payment terms", active ? `Settlement net ${active.paymentTermsDays} days · supplies net ${active.supplyPaymentTermsDays} days` : "—"],
              ["Notes", p.notes],
            ]} />
          </Card>
          <div className="grid gap-3">
            <Stat label="Total reported sales" value={formatPHP(salesAgg._sum.netSales)} hint={`${salesAgg._count} reports`} tone="berry" />
            <Stat label="Owed to me (receivable)" value={formatPHP(arTotal)} tone={arTotal.gt(0) ? "vanilla" : "mint"} />
            <Stat label="I owe partner (payable)" value={formatPHP(apTotal)} tone="sky" />
          </div>
        </div>
      )}

      {tab === "contract" && (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-3">
            {!active && <Alert>This partner has no active contract. Profit sharing and activation require one.</Alert>}
            {p.contracts.map((c) => (
              <Card key={c.id} title={<span>Contract v{c.version} {c.isActive ? <Badge tone="mint">active</Badge> : <Badge>superseded</Badge>}</span>}>
                <DL cols={3} items={[
                  ["Effective", `${fmtDate(c.effectiveFrom)} – ${c.effectiveTo ? fmtDate(c.effectiveTo) : "open"}`],
                  ["Share model", MODEL_LABEL[c.shareModel]],
                  ["Owner / partner", `${c.ownerSharePct.toString()}% / ${c.partnerSharePct.toString()}%`],
                  ["Fixed fee", formatPHP(c.fixedFee)],
                  ["Supplies valued at", c.cogsBasis === "TRANSFER_PRICE" ? "Price charged to partner" : "Owner's cost"],
                  ["Operating expenses", c.deductOperatingExpenses ? "Deducted before split" : "Not deducted"],
                  ["Losses", c.shareLosses ? "Shared" : "Borne by partner"],
                  ["Sales cash held by", c.cashCustody === "PARTNER" ? "Partner (remits owner share)" : "Owner (pays partner share)"],
                  ["Sales reporting", c.reportingMethod === "INVENTORY_COUNT" ? "Closing inventory count" : "Units sold (theoretical usage)"],
                  ["Settlement", humanize(c.settlementFrequency)],
                  ["Settlement terms", `Net ${c.paymentTermsDays} days`],
                  ["Supply invoice terms", `Net ${c.supplyPaymentTermsDays} days`],
                  ["Created", fmtDateTime(c.createdAt)],
                ]} />
                {c.terms && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-cream-100 p-3 text-sm">{c.terms}</p>}
              </Card>
            ))}
          </div>
          {can(user.role, "contracts:write") && (
            <Card title={active ? "New contract version" : "Create contract"} className="lg:col-span-2">
              <ActionForm action={createContractAction}>
                <input type="hidden" name="partnerId" value={p.id} />
                <div className="grid grid-cols-2 gap-3">
                  <DateField label="Effective from" name="effectiveFrom" required defaultValue={fmtDate(today)} />
                  <DateField label="Effective to" name="effectiveTo" hint="Optional end date" />
                </div>
                <SelectField label="Share model" name="shareModel" defaultValue={active?.shareModel ?? "PROFIT_SHARE"} options={Object.entries(MODEL_LABEL).map(([value, label]) => ({ value, label }))} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Owner share %" name="ownerSharePct" defaultValue={active?.ownerSharePct.toString() ?? "50"} required hint="Partner gets the rest" />
                  <Field label="Fixed fee (₱)" name="fixedFee" defaultValue={active?.fixedFee.toString() ?? "0"} hint="Per settlement period" />
                </div>
                <SelectField label="Supplies consumed valued at" name="cogsBasis" defaultValue={active?.cogsBasis ?? "TRANSFER_PRICE"} options={[{ value: "TRANSFER_PRICE", label: "Price charged to partner (default)" }, { value: "OWNER_COST", label: "Owner's cost" }]} />
                <SelectField label="Who holds the sales cash?" name="cashCustody" defaultValue={active?.cashCustody ?? "PARTNER"} options={[{ value: "PARTNER", label: "Partner – remits owner share" }, { value: "OWNER", label: "Owner – pays partner share" }]} />
                <SelectField label="How daily sales are reported" name="reportingMethod" defaultValue={active?.reportingMethod ?? "INVENTORY_COUNT"} options={[{ value: "INVENTORY_COUNT", label: "Closing count of cups, cones & powder (sales derived)" }, { value: "THEORETICAL", label: "Partner reports units sold" }]} />
                <SelectField label="Settlement schedule" name="settlementFrequency" defaultValue={active?.settlementFrequency ?? "DAILY"} options={[{ value: "DAILY", label: "Daily" }, { value: "WEEKLY", label: "Weekly" }, { value: "SEMI_MONTHLY", label: "Every 15 days" }, { value: "MONTHLY", label: "Monthly" }]} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Settlement terms (days)" name="paymentTermsDays" type="number" min="0" defaultValue={active?.paymentTermsDays ?? 7} />
                  <Field label="Supply terms (days)" name="supplyPaymentTermsDays" type="number" min="0" defaultValue={active?.supplyPaymentTermsDays ?? 15} />
                </div>
                <Checkbox label="Deduct approved operating expenses before sharing" name="deductOperatingExpenses" defaultChecked={active?.deductOperatingExpenses ?? false} hint="Leave unticked to share gross profit (sales − cups, cones, powder)" />
                <Checkbox label="Share losses by the same percentage" name="shareLosses" defaultChecked={active?.shareLosses ?? true} />
                <TextArea label="Contract terms / notes" name="terms" defaultValue={active?.terms} />
                <SubmitButton>Save contract</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
      )}

      {tab === "prices" && <PricesTab partnerId={p.id} canEdit={can(user.role, "contracts:write")} />}
      {tab === "sales" && <SalesTab partnerId={p.id} />}
      {tab === "inventory" && <InventoryTab locationId={p.location?.id} />}
      {tab === "expenses" && <ExpensesTab partnerId={p.id} />}
      {tab === "settlements" && <SettlementsTab partnerId={p.id} canCreate={can(user.role, "settlements:prepare")} />}

      {tab === "balances" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={`Receivables · ${formatPHP(arTotal)} outstanding`} pad={false}>
            {invoices.length === 0 ? <div className="p-5"><Empty /></div> : (
              <div className="table-wrap"><table className="tbl"><thead><tr><th>Invoice</th><th>Type</th><th>Due</th><th>Status</th><th className="num">Balance</th></tr></thead>
                <tbody>{invoices.map((i) => (
                  <tr key={i.id}><td><Link className="link" href={`/finance/invoices/${i.id}`}>{i.number}</Link></td><td className="text-xs">{humanize(i.type)}</td><td>{fmtDate(i.dueDate)}</td><td><StatusBadge status={effectiveStatus(i, today)} /></td><td className="num"><Peso v={balanceOf(i)} /></td></tr>
                ))}</tbody></table></div>
            )}
          </Card>
          <Card title={`Payables to partner · ${formatPHP(apTotal)} outstanding`} pad={false}>
            {bills.length === 0 ? <div className="p-5"><Empty /></div> : (
              <div className="table-wrap"><table className="tbl"><thead><tr><th>Bill</th><th>Due</th><th>Status</th><th className="num">Balance</th></tr></thead>
                <tbody>{bills.map((b) => (
                  <tr key={b.id}><td><Link className="link" href={`/finance/bills/${b.id}`}>{b.number}</Link></td><td>{fmtDate(b.dueDate)}</td><td><StatusBadge status={effectiveStatus(b, today)} /></td><td className="num"><Peso v={balanceOf(b)} /></td></tr>
                ))}</tbody></table></div>
            )}
          </Card>
        </div>
      )}

      {tab === "documents" && (
        <div className="max-w-3xl">
          <Attachments entityType="Partner" entityId={p.id} back={base} categories={["CONTRACT", "ID_DOCUMENT", "PERMIT", "PHOTO", "GENERAL"]} title="Contracts, IDs and business records" />
          <p className="mt-2 text-xs text-choco-500">Confidential files (e.g. government IDs) are visible only to Super Admin/Admin and are never shown in the partner portal.</p>
        </div>
      )}

      {tab === "users" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Portal accounts" pad={false}>
            {p.users.length === 0 ? <div className="p-5"><Empty>No portal login yet.</Empty></div> : (
              <table className="tbl"><thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Last login</th></tr></thead>
                <tbody>{p.users.map((u) => <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{u.isActive ? <Badge tone="mint">active</Badge> : <Badge>disabled</Badge>}</td><td className="text-xs">{fmtDateTime(u.lastLoginAt)}</td></tr>)}</tbody></table>
            )}
          </Card>
          {can(user.role, "partners:write") && p.status !== "TERMINATED" && (
            <Card title="Create partner login">
              <ActionForm action={createPartnerUserAction} resetOnSuccess>
                <input type="hidden" name="partnerId" value={p.id} />
                <Field label="Name" name="name" defaultValue={p.ownerName} required />
                <Field label="Email" name="email" type="email" defaultValue={p.email} required />
                <Field label="Temporary password" name="password" type="text" required hint="At least 10 characters with letters and numbers." />
                <SubmitButton>Create login</SubmitButton>
              </ActionForm>
              <p className="mt-3 text-xs text-choco-500">Partners only ever see their own sales, inventory, invoices and statements.</p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

async function PricesTab({ partnerId, canEdit }: { partnerId: string; canEdit: boolean }) {
  const [pricing, drivers] = await Promise.all([partnerPricing(prisma, partnerId), countDrivers(prisma, partnerId)]);
  if (!pricing.length) return <Empty>No active products. <Link className="link" href="/recipes/products">Create products</Link> first.</Empty>;
  return (
    <div className="space-y-4">
    <Card title="Closing-count pricing (each cone / cup used counts as one sale of…)" pad={false}
      actions={canEdit && drivers.some((d) => !d.product && d.suggestion) && (
        <ActionForm action={applySuggestedCountProductsAction} className="inline">
          <input type="hidden" name="partnerId" value={partnerId} />
          <SubmitButton className="btn-primary btn-sm">Use suggested matches</SubmitButton>
        </ActionForm>
      )}>
      {drivers.some((d) => !d.product && d.inUse) && <p className="mx-5 mt-4 rounded-lg bg-berry-50 px-3 py-2 text-sm text-berry-700">The partner cannot submit closing counts until every cone and cup they hold is matched to a product below.</p>}
      <table className="tbl tbl-stack"><thead><tr><th>Container</th><th>Sold as product</th><th className="num">Price</th>{canEdit && <th>Change</th>}</tr></thead>
        <tbody>{drivers.map((d) => (
          <tr key={d.item.id}>
            <td className="stack-title">{d.item.name}{d.inUse && <span className="ml-1 text-xs text-choco-500">(in stock)</span>}</td>
            <td data-label="Sold as">{d.product ? <>{d.product.name} {!d.configured && <Badge tone="sky">auto</Badge>}</> : d.candidates.length ? <><Badge tone="berry">not set</Badge>{d.suggestion && <span className="ml-1 text-xs text-choco-500">suggested: {d.suggestion.name}</span>}</> : <span className="text-xs text-choco-500">no cone/cup product yet — create one under Recipes &amp; Products</span>}</td>
            <td data-label="Price" className="num">{d.product ? <Peso v={pricing.find((p) => p.product.id === d.product!.id)?.price ?? d.product.defaultPrice} /> : "—"}</td>
            {canEdit && <td data-label="">{d.candidates.length > 0 && (
              <ActionForm action={setCountProductAction} className="flex items-center gap-2">
                <input type="hidden" name="partnerId" value={partnerId} /><input type="hidden" name="itemId" value={d.item.id} />
                <select className="input w-56" name="productId" defaultValue={d.configured ? d.product?.id : d.suggestion?.id ?? ""}><option value="">{d.candidates.length === 1 && !d.configured ? "Automatic" : "Choose…"}</option>{d.candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                <SubmitButton className="btn-secondary btn-sm">Save</SubmitButton>
              </ActionForm>
            )}</td>}
          </tr>
        ))}</tbody></table>
      <p className="px-5 py-3 text-xs text-choco-500">Used for partners on closing-count reporting: every cone or cup used (minus wasted) is one sale of the chosen product at this partner&apos;s price.</p>
    </Card>
    <Card title="Selling prices for this partner" pad={false}>
      <div className="table-wrap"><table className="tbl">
        <thead><tr><th>Product</th><th className="num">Default price</th><th className="num">Partner price</th><th className="num">Theoretical cost</th><th className="num">Margin</th>{canEdit && <th>Set partner price</th>}</tr></thead>
        <tbody>{pricing.map((r) => (
          <tr key={r.product.id}>
            <td>{r.product.name} <span className="text-xs text-choco-500">{r.product.code}</span></td>
            <td className="num"><Peso v={r.product.defaultPrice} /></td>
            <td className="num font-semibold"><Peso v={r.price} /> {r.hasOverride && <Badge tone="vanilla">custom</Badge>}</td>
            <td className="num"><Peso v={r.unitCost} /></td>
            <td className="num"><Peso v={r.price.minus(r.unitCost)} /></td>
            {canEdit && <td>
              <ActionForm action={setPriceAction} className="flex items-center gap-2">
                <input type="hidden" name="partnerId" value={partnerId} /><input type="hidden" name="productId" value={r.product.id} />
                <input className="input w-28" name="price" defaultValue={r.hasOverride ? r.price.toString() : ""} placeholder="default" />
                <SubmitButton className="btn-secondary btn-sm">Save</SubmitButton>
              </ActionForm>
            </td>}
          </tr>
        ))}</tbody>
      </table></div>
      <p className="px-5 py-3 text-xs text-choco-500">Leave blank and save to revert to the default price. Theoretical cost uses supply prices charged to the partner.</p>
    </Card>
    </div>
  );
}

async function SalesTab({ partnerId }: { partnerId: string }) {
  const reports = await prisma.salesReport.findMany({ where: { partnerId }, orderBy: { reportDate: "desc" }, take: 60, include: { machine: { select: { code: true } } } });
  return (
    <Card title="Sales history (latest 60)" pad={false} actions={<Link className="link text-xs" href={`/sales?partnerId=${partnerId}`}>All reports</Link>}>
      {reports.length === 0 ? <div className="p-5"><Empty /></div> : (
        <div className="table-wrap"><table className="tbl"><thead><tr><th>Date</th><th>Report</th><th>Machine</th><th>Status</th><th className="num">Units</th><th className="num">Net sales</th><th className="num">Cash variance</th></tr></thead>
          <tbody>{reports.map((r) => (
            <tr key={r.id}><td>{fmtDate(r.reportDate)}</td><td><Link className="link" href={`/sales/${r.id}`}>{r.number}</Link></td><td>{r.machine?.code ?? "—"}</td><td><StatusBadge status={r.status} /> {r.hasDiscrepancy && <Badge tone="berry">discrepancy</Badge>}</td><td className="num">{r.totalUnits}</td><td className="num"><Peso v={r.netSales} /></td><td className="num"><Peso v={r.cashVariance} /></td></tr>
          ))}</tbody></table></div>
      )}
    </Card>
  );
}

async function InventoryTab({ locationId }: { locationId?: string }) {
  if (!locationId) return <Empty>No inventory location.</Empty>;
  const levels = await prisma.stockLevel.findMany({ where: { locationId }, include: { item: true }, orderBy: { item: { name: "asc" } } });
  return (
    <Card title="Stock at partner location (ledger)" pad={false} actions={<Link className="link text-xs" href={`/inventory/movements?locationId=${locationId}`}>Movement history</Link>}>
      {levels.length === 0 ? <div className="p-5"><Empty>No stock yet. Supplies arrive through supply orders.</Empty></div> : (
        <table className="tbl"><thead><tr><th>Item</th><th className="num">On hand</th><th className="num">Value (partner price)</th><th></th></tr></thead>
          <tbody>{levels.map((l) => (
            <tr key={l.id}><td>{l.item.name}</td><td className="num">{formatQty(l.quantity, 3)} {UOM_LABEL[l.item.uom]}</td><td className="num"><Peso v={D(l.quantity).times(D(l.item.partnerPrice))} /></td>
              <td>{D(l.quantity).lte(D(l.item.partnerMinStock)) && D(l.item.partnerMinStock).gt(0) && <Badge tone="berry">low</Badge>}{D(l.quantity).isNegative() && <Badge tone="berry">count needed</Badge>}</td></tr>
          ))}</tbody></table>
      )}
    </Card>
  );
}

async function ExpensesTab({ partnerId }: { partnerId: string }) {
  const rows = await prisma.partnerExpense.findMany({ where: { partnerId }, orderBy: { expenseDate: "desc" }, take: 100 });
  return (
    <Card title="Operating expenses at this location" pad={false} actions={<Link className="link text-xs" href="/finance/partner-expenses">Review queue</Link>}>
      {rows.length === 0 ? <div className="p-5"><Empty /></div> : (
        <table className="tbl"><thead><tr><th>Date</th><th>No.</th><th>Category</th><th>Description</th><th>Paid by</th><th>Status</th><th className="num">Amount</th></tr></thead>
          <tbody>{rows.map((e) => (
            <tr key={e.id}><td>{fmtDate(e.expenseDate)}</td><td className="text-xs">{e.number}</td><td>{e.category}</td><td>{e.description}</td><td>{humanize(e.paidBy)}</td><td><StatusBadge status={e.status} /> {e.settlementId && <Badge tone="sky">settled</Badge>}</td><td className="num"><Peso v={e.amount} /></td></tr>
          ))}</tbody></table>
      )}
    </Card>
  );
}

async function SettlementsTab({ partnerId, canCreate }: { partnerId: string; canCreate: boolean }) {
  const rows = await prisma.settlement.findMany({ where: { partnerId }, orderBy: { periodStart: "desc" } });
  return (
    <Card title="Profit-sharing history" pad={false} actions={canCreate && <Link className="btn-primary btn-sm" href={`/settlements/new?partnerId=${partnerId}`}>New settlement</Link>}>
      {rows.length === 0 ? <div className="p-5"><Empty /></div> : (
        <div className="table-wrap"><table className="tbl"><thead><tr><th>Settlement</th><th>Period</th><th>Status</th><th className="num">Net sales</th><th className="num">Distributable</th><th className="num">Owner</th><th className="num">Partner</th></tr></thead>
          <tbody>{rows.map((s) => (
            <tr key={s.id}><td><Link className="link" href={`/settlements/${s.id}`}>{s.number}</Link></td><td>{fmtDate(s.periodStart)} – {fmtDate(s.periodEnd)}</td><td><StatusBadge status={s.status} /></td><td className="num"><Peso v={s.netSales} /></td><td className="num"><Peso v={s.distributableProfit} /></td><td className="num"><Peso v={s.ownerShare} /></td><td className="num"><Peso v={s.partnerShare} /></td></tr>
          ))}</tbody></table></div>
      )}
    </Card>
  );
}
