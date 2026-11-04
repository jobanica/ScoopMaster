# SCOOP MASTER — Architecture & Design

Soft-Serve Ice Cream Partnership & Business Management System for a machine-placement business in the Philippines.
Currency: PHP (₱). Timezone: Asia/Manila. Date format: DD/MM/YYYY.

---

## 1. System architecture

```
 Browser (staff desktop / partner mobile)
        │  HTTPS, httpOnly session cookie
        ▼
 Next.js 15 (App Router, React 19, TypeScript)
   ├─ middleware.ts            cheap cookie gate → /login
   ├─ app/(staff)/*            staff UI (server components)
   ├─ app/portal/*             partner portal (server components, mobile-first)
   ├─ */actions.ts             server actions = the only write API from the UI
   ├─ app/api/*                files, PDF documents, report exports, cron
   │
   ├─ src/lib/                 framework-agnostic core
   │    money.ts  dates.ts  units.ts  rbac.ts  auth.ts  audit.ts  sequence.ts
   │    calc/*                 PURE financial calculations (unit tested)
   └─ src/server/services/*    domain services: every write is a DB transaction + audit log
        │
        ▼
 PostgreSQL 16  (Prisma ORM, migrations in prisma/migrations)
 Local disk storage for uploads (outside /public, served through an authorised route)
```

**Layering rule:** pages and server actions never write to the database directly. They parse and validate input
(`lib/form.ts`), check permissions (`requireUser(permission)`), then call a service. Services own business rules,
run inside a serializable transaction (`withTx`) with automatic retry on serialization conflicts, and write an
`AuditLog` row in the same transaction. Pure calculation modules (`lib/calc`) hold every formula so they can be tested
without a database.

### Why this stack

| Choice | Reason |
|---|---|
| **Next.js + TypeScript** | One codebase for staff UI, partner portal, API routes and server-side rendering. Server components keep data access on the server (no data APIs exposed to the browser). |
| **PostgreSQL** | Real `NUMERIC` decimals, serializable transactions, row locks — required for money and stock. |
| **Prisma** | Typed queries and versioned migrations. Raw SQL is used only for atomic counters and stock upserts. |
| **decimal.js** | All money/quantity arithmetic. JavaScript floats are never used for amounts. |
| **Tailwind CSS** | Consistent design system (cream / chocolate / pastel palette) with little CSS to maintain. |
| **Own session auth (bcrypt + DB sessions)** | Simple, auditable, no third-party dependency: random 256-bit tokens, only SHA-256 hashes stored, httpOnly/SameSite cookies, lockout after 5 failed logins. |
| **Recharts, ExcelJS, jsPDF** | Charts, Excel export, PDF documents — all generated server-side except charts. |

---

## 2. Database schema — entities & relationships

Full definition: [`prisma/schema.prisma`](../prisma/schema.prisma). Money = `Decimal(14,2)`, quantities and unit costs =
`Decimal(14,4)`, business dates = `@db.Date`.

```
User ─┬─ Session                         Partner ─┬─ PartnerContract (versioned terms) ─── Settlement
      ├─ AuditLog                                 ├─ Location (1:1, partner stock)
      └─ Notification                             ├─ Machine (current) / MachineAssignment (history)
                                                  ├─ PartnerProductPrice (per-product selling price)
Location ─┬─ StockLevel (item × location)         ├─ SalesReport ─┬─ SalesReportLine (product, qty, price snapshot)
          ├─ StockBatch (batch/expiry)            │               ├─ SalesReportStock (opening/closing counts)
          ├─ StockMovement (immutable ledger)     │               └─ SalesEditRequest
          └─ StockCount ─ StockCountLine          ├─ SupplyOrder ─ SupplyOrderLine ─→ Invoice (SUPPLY)
                                                  ├─ PartnerExpense (operating expenses at the location)
InventoryItem ─ RecipeIngredient ─ Recipe         ├─ Invoice (AR) ─ InvoiceLine
InventoryItem ─ ProductComponent ─ Product ─ Recipe├─ Bill (AP)
                                                  ├─ Payment ─ PaymentAllocation ─→ Invoice | Bill
Machine ─ MaintenanceRecord ─→ Bill (repair cost) └─ MaintenanceRecord
Contact (supplier, customer, technician, employee, installment buyer…) ─ Invoice | Bill | Payment
Counter (gap-free numbering)   Attachment (polymorphic files)   NotificationRule
```

Key design decisions:

* **Locations, not "warehouse vs partner" tables.** Every place that holds stock is a `Location`
  (`WAREHOUSE`, `PARTNER`, `IN_TRANSIT`). Multiple warehouses/branches are just more rows.
* **Stock is a ledger.** `StockLevel` is only ever changed by `postMovement()`, which writes an immutable
  `StockMovement` (signed quantity, cost and price snapshots, balance after, source document). Corrections are
  `REVERSAL` / `ADJUSTMENT` / `COUNT_VARIANCE` movements — never edits or deletes.
* **Contracts are versioned.** A new version closes the previous one; settlements reference the exact version used.
* **OVERDUE is derived**, never stored, so it can't go stale: `due date < today AND balance > 0`.
* **Unique human IDs** via an atomic `Counter` table: `PTR-0001`, `MCH-0001`, `SR-0000001`, `INV-2026-00001`,
  `BILL-…`, `RCPT-…`, `PAY-…`, `STL-2026-0001`, `SO-…`, `MV-…`, `CNT-…`, `MNT-…`, `PEX-…`.

---

## 3. Roles & permissions

Defined in [`src/lib/rbac.ts`](../src/lib/rbac.ts); enforced on every page (`requirePage`), server action and API
route (`requireUser`). The sidebar only shows what a role can open.

| Capability | Super Admin | Admin | Finance | Warehouse | Operations | Partner |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Dashboard (operational) | ✔ | ✔ | ✔ | ✔ | ✔ | own |
| Financial figures on dashboard | ✔ | ✔ | ✔ | | | |
| Partners: view / edit / status / contracts | ✔ | ✔ | view | view | view | own agreement |
| Confidential documents (IDs) | ✔ | ✔ | | | | |
| Machines & maintenance | ✔ | ✔ | view | | ✔ | own machine, report problem |
| Sales: view / manual entry / approve | ✔ | ✔ | view | | view | submit own |
| Inventory & stock movements | ✔ | ✔ | view | ✔ | view | own stock (view) |
| Recipes & products | ✔ | ✔ | view | view | view | |
| Supply orders: review / fulfil | ✔ | ✔ | view | ✔ | view | request & confirm own |
| Invoices, bills, expenses, payments | ✔ | ✔ | ✔ | | | own invoices, submit proof |
| Settlements: prepare | ✔ | ✔ | ✔ | | | |
| Settlements: **approve / finalize** | ✔ | ✔ | | | | view own statements |
| Reports (operational / financial) | ✔ | ✔ | ✔ / ✔ | ✔ / | ✔ / | |
| Alert rules, audit log | ✔ | ✔ | | | | |
| User management | ✔ | | | | | |

Partner isolation: portal pages and actions take the partner ID **only from the session**, every query filters by it,
and records belonging to another partner return 404. Segregation of duties: whoever prepared a settlement cannot approve
it (except Super Admin).

---

## 4. Business workflows

**Partner onboarding** — Prospect → Pending Approval → (contract required) → Active → On Hold ↔ Active → Terminated
(machines must be returned first; portal logins are disabled). A partner location is created automatically.

**Machine lifecycle** — Available → Deploy (assignment record) → Transfer (closes old assignment, opens new) →
Return (condition recorded) / Under Maintenance / Reserved / Sold. Maintenance records can create an AP bill for repair cost.

**Daily sales** — Partner (or staff) submits units per product; prices are the partner's configured prices, looked up
server-side. The server computes gross/net sales, expected cash, cash shortage/overage, declared-vs-computed variance and
payment-breakdown mismatch; any difference beyond the tolerance flags a discrepancy and alerts staff. Submitted reports
are locked; corrections need an approved edit request (which reverses ledger postings and reopens the report).
**Approval** posts theoretical ingredient consumption and reported wastage to the partner location's ledger.

**Daily sales by closing inventory count** (contract option `INVENTORY_COUNT`, default for new contracts) — for owners who
cannot watch sales. At closing the partner counts cups, cones and powder left (other items optional). The system knows
what should be on hand from the ledger (last count + deliveries), so: used = expected − counted; units sold = cones/cups
used − broken/spilled; sales = units × the partner's price for the product mapped to each container (Partner → Prices);
cost = cups, cones and powder used (uncounted items estimated from units sold); gross profit = sales − cost, split per
contract (e.g. 50/50). Actual usage is posted to the ledger at submission. A **powder check** compares powder used with
what the counted sales need and flags anything more than 15 % over (possible unreported sales). Counts must be submitted
in date order, and an earlier count can only be reopened after later ones. Daily settlements are created in bulk
("Create all due settlements") and approved in bulk ("Finalize pending").

**Partner shifts** — Each business day the partner taps **Open shift**: the portal shows yesterday's closing count, deliveries
received since, and what they should have now (carried over). One tap confirms; if something differs (e.g. cones missing
overnight), the partner enters the actual amount — the difference is posted as an audited `COUNT_VARIANCE` and staff are
alerted (`SHIFT_VARIANCE`). **Missing cones and cups are counted as sold**: they are not written off, so that
evening's closing count derives them as sales at the partner's price (the report notes "N missing at opening — counted
as sold"). Other differences (e.g. powder) are posted as a count variance. Deliveries confirmed during the shift are added automatically. Submitting the closing count
closes the shift (a shift is recorded automatically if the partner forgot to open one); reopening the count reopens the
shift. A shift left open blocks the next day until its closing count is submitted. Staff see every partner's shift
status on **Sales → Partner shifts**.

**Daily pay-in** (daily closing-count partners) — approving a day's count settles that day automatically (system-prepared,
finalized by the approver), creating the owner-share invoice. The partner then sees **Pay ₱X** = owner share + supplies
used that day, pays by GCash/cash/bank with proof, and Finance verifies. On verification the payment is applied to the
day's owner-share invoice first, then to the partner's supply invoices oldest first (re-split against current
balances); anything beyond open invoices stays as unapplied credit. Staff can also press **Settle this day now** on an
approved report.

**Supply orders** — Request → Approve (quantities adjustable, prices snapshotted) / Reject → Preparing → Dispatch
(warehouse → In Transit; warehouse stock decreases) → Receipt confirmation by partner or staff (In Transit → partner
location; shortfalls written off as DAMAGED) → **SUPPLY invoice** generated for received quantities with cost
snapshot (markup) and due date from the contract's supply terms.

**Physical counts** — Snapshot → enter counts → post: variances become `COUNT_VARIANCE` movements against the live balance.

**Payments** — Staff record payments (partial allowed; allocations across invoices/bills; unapplied credit can be
applied later). Partners submit proof of payment → `PENDING_VERIFICATION` → finance verifies (balances change only
then) or rejects. Voiding reverses allocations; nothing is deleted.

**Settlements** — Draft (computed from approved data) → Submit (recalculated; blocked while sales/expenses in the
period are unreviewed; **period becomes locked**) → Approve/Finalize by an authorised approver (creates a receivable
or payable) → Void (only if no payments applied; unlocks the period).

**Alerts** — Event-driven (supply request, payment submitted, discrepancy, machine problem, sales drop, settlement ready,
edit request) plus a scheduled scan (`/api/cron/alerts`, or "Run alert checks now") for missing reports, low/expiring
stock, due/overdue payments, maintenance due, contract expiry and settlements due. Notifications are de-duplicated.

---

## 5. Financial calculations

All formulas live in `src/lib/calc/*` and are covered by unit tests (`tests/calc.test.ts`) and end-to-end tests
(`tests/workflow.test.ts`). Rounding: half-up to centavos; when splitting, the owner share is rounded and the partner
share is the exact remainder, so no centavo is lost.

### Sales report
```
gross sales      = Σ qty × partner price (per product)
net sales        = gross − discounts − refunds
expected cash    = net sales − GCash − other payments
cash variance    = actual cash submitted − expected cash        (+ overage / − shortage)
sales variance   = declared total − net sales
est. ingredient cost = Σ (qty + wastage) × theoretical unit cost
```

### Recipe & product costing
```
batch cost          = Σ ingredient qty (converted to the item's unit) × weighted-average cost
cost per gram       = batch cost ÷ expected yield (e.g. 1 kg powder + 2.7 L water ≈ 3,700 g)
effective cost/gram = cost per gram ÷ (1 − wastage %)
product unit cost   = serving grams × effective cost/gram + Σ components (cone, cup, spoon, topping)
theoretical servings = ⌊yield ÷ serving⌋     expected servings = ⌊yield × (1 − wastage) ÷ serving⌋
```
Theoretical consumption posted per unit sold uses the exact serving (no wastage factor); actual wastage and count
variances are tracked separately, giving a theoretical-vs-actual yield efficiency per recipe.

### Closing-count reporting
```
expected on hand = ledger balance at closing (previous count + deliveries since)
used             = expected − counted            (counted > expected is rejected)
units sold       = cones/cups used − wasted       (whole pieces)
sales            = Σ units sold × partner price of the mapped product
cost of goods    = Σ used × unit value (contract basis) — uncounted items estimated from units sold
gross profit     = sales − discounts − refunds − cost of goods      → split per contract
powder check     = (powder used − powder needed for units sold) ÷ needed  > 15 %  → discrepancy
```
The daily settlement uses the same ledger usage, so the settlement's supplies consumed always equals the cost on that
day's count (verified by `tests/count-workflow.test.ts`).

### Partnership profit sharing (per contract)
```
net sales            = Σ approved sales reports in the period
supplies consumed    = Σ ledger usage at the partner location in the period
                       (CONSUMPTION, WASTAGE, DAMAGED, EXPIRED, COUNT_VARIANCE, ADJUSTMENT, ISSUE, REVERSAL)
                       valued at the contract basis: price charged to partner (default) or owner cost
operating expenses   = Σ approved partner expenses in the period (if the contract deducts them)
distributable profit = net sales − supplies consumed − operating expenses

PROFIT_SHARE    owner = distributable × owner %
FIXED_FEE       owner = fixed fee
FEE_PLUS_SHARE  owner = fee + (distributable − fee) × owner %
REVENUE_SHARE   owner = net sales × owner %
partner share   = distributable − owner share        (losses shared or borne by partner per contract)

cash custody PARTNER: partner remits  owner share + expenses the owner paid    → Receivable (PARTNERSHIP_SHARE)
cash custody OWNER:   owner pays      partner share + expenses the partner paid → Payable  (PARTNER_PAYOUT)
```
Example (from the brief, verified by test): ₱30,000 sales − ₱8,000 supplies − ₱2,000 expenses = ₱20,000 →
50/50 = ₱10,000 / ₱10,000.

### How double counting is prevented
1. **Supply markup is earned once, on the supply invoice** (invoice amount − cost snapshot). It is shown on settlements
   for information only and is never added to the split.
2. **Supplies consumed ≠ supply invoices.** The settlement deducts what was *used* (from the ledger). Unpaid supply
   invoices are a separate receivable, shown on the statement but **not deducted again**.
3. **Each sales report and expense belongs to at most one settlement** (`settlementId`), periods may not overlap, and
   once a settlement is pending/finalized the period is locked for sales, expenses, counts and stock movements.
4. **Owner P&L:** revenue = supply invoices + owner share of finalized settlements + machine sales/rentals/other.
   Partner sales are *not* owner revenue. `PARTNERSHIP_SHARE` invoices are collection documents and are excluded
   from revenue. Every owner expense is recorded exactly once as a Bill (paid immediately or later); partner-location
   expenses are partnership costs (`PartnerExpense`), not owner bills. Machine purchases and partner payouts are not
   operating expenses.
5. **Traceability:** each finalized settlement stores a calculation snapshot listing every sales report, expense and
   ledger item it used, the contract terms and the calculation steps.

---

## 6. Security & reliability

* bcrypt (cost 12) passwords, ≥10 chars with letters and digits; lockout 15 min after 5 failures; sessions expire
  after 12 h; password resets and deactivation revoke sessions.
* RBAC on every page/action/route; partner data isolation; confidential attachments.
* Uploads: type verified by magic bytes (PDF/PNG/JPEG/WEBP), 10 MB limit, random names, stored outside `/public`,
  served only after an access check, SHA-256 recorded.
* Input validation on every action; friendly error messages without leaking internals.
* Serializable transactions + retries for financial and stock writes; row locks on invoices/bills during allocation;
  atomic stock upserts; negative stock refused except theoretical usage at partner locations (flagged "count needed").
* Audit log for all changes, logins, exports and alert scans. Records are cancelled/voided/reversed — never deleted.
* Security headers (X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy); `poweredByHeader` off.
* Backups: `scripts/backup.sh` (pg_dump + uploads, rotation).

---

## 7. Implementation roadmap & status

| Phase | Scope | Status |
|---|---|---|
| 1 | Architecture, schema, auth, roles, dashboard | ✅ Done |
| 2 | Partner & machine management (contracts, prices, transfers, maintenance, ROI) | ✅ Done |
| 3 | Sales monitoring (daily reports, discrepancies, approvals, edit requests) | ✅ Done |
| 4 | Inventory ledger, counts, batches/expiry, recipes & costing, supply orders | ✅ Done |
| 5 | AR/AP, expenses, payments & allocations, partner proof of payment, collections | ✅ Done |
| 6 | Profit sharing & settlements (approval, period locks, statements) | ✅ Done |
| 7 | 19 reports with PDF/Excel/CSV, notifications & rules, partner portal | ✅ Done |
| 8 | Tests (38 unit + integration), security hardening, docs, backups | ✅ Done — see README for deployment |

### Ready for the future features
* **Machine rentals / installment sales** — `InvoiceType.MACHINE_RENTAL` / `INSTALLMENT` and `Contact.INSTALLMENT_BUYER`
  exist; a schedule table can generate invoices.
* **POS / QR reporting** — `SalesReport.source` and `saveSalesReport()` are input-agnostic; a POS webhook calls the same service.
* **Barcode scanning** — items have unique SKUs; scanners can feed the existing movement forms.
* **SMS / GCash** — notifications are central (`notify()`); add a delivery channel. Payments carry method + reference for gateway reconciliation.
* **Multiple warehouses / branches / franchises** — locations are generic; add a branch dimension to users and filters.
* **Forecasting & benchmarking** — daily, per-partner, per-product data is already structured for it.

### Known limitations (honest list)
* Weighted-average cost is tracked per item (single cost pool across warehouses).
* Supply invoices cannot be cancelled once goods are delivered; credit notes for returns are not yet implemented (the stock return itself is supported).
* Owner-paid partner expenses are recorded for reimbursement but don't create a payment record automatically.
* File storage is local disk; switch to object storage (S3-compatible) for multi-server deployments.
