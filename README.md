# 🍦 SCOOP MASTER

**Soft-Serve Ice Cream Partnership & Business Management System** — manage soft-serve machine partnerships across
10, 50 or 100+ partner locations in the Philippines: partners and contracts, machines, daily sales, inventory, recipes
and costing, supply orders, receivables/payables, payments, profit-sharing settlements, reports and a partner portal.

* Next.js 15 · React 19 · TypeScript · PostgreSQL 16 · Prisma 6 · Tailwind CSS · decimal.js
* PHP (₱) everywhere · Asia/Manila timezone · DD/MM/YYYY dates
* Architecture, schema, roles, workflows and every financial formula: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**

---

## Quick start (local)

Requirements: Node.js 20+ (22 recommended), PostgreSQL 14+.

```bash
npm install
```

```bash
cp .env.example .env    # then edit DATABASE_URL, SESSION_SECRET, CRON_SECRET
```

```bash
npx prisma migrate deploy
```

```bash
SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='a-strong-password-123' npm run db:seed
```

```bash
npm run dev
```

Open http://localhost:3000 and sign in with the Super Admin you seeded.
(Without the env vars the seed uses `admin@scoopmaster.local` / `ChangeMe12345` — change it immediately.)

### Optional demo data (testing/training only)

```bash
npm run db:demo
```

Creates 3 partners, 4 machines, items, recipes, products, ~5 weeks of sales, weekly supply orders, expenses,
finalized settlements and payments — all through the real services, so it follows the same rules as live data.
Demo logins use password `DemoPass123`: `admin.demo@`, `finance.demo@`, `warehouse.demo@`, `ops.demo@`,
`partner1.demo@` … `partner3.demo@scoopmaster.local`. The script refuses to run if partners already exist.
**Never run it against production.**

---

## First-time setup checklist

1. **Users** (Administration → Users): create Admin / Finance / Warehouse / Operations staff.
2. **Contacts** (Finance → Contacts): suppliers, technicians, delivery providers.
3. **Inventory items** (Inventory → Items): SKU, unit, purchase cost, selling price to partner, minimum levels.
4. **Receive opening stock** (Inventory → Stock operations → Receive) — sets weighted-average cost.
5. **Recipes** (e.g. 1 kg powder + 2.7 L water → 3,700 g, 5 % wastage) and **products** (serving size, components, default price).
6. **Machines** (Machines → Add).
7. **Partners**: create → add contract (share model, %, cash custody, settlement schedule, terms) → set status Active
   → deploy machine → set partner-specific prices (Prices tab) → create the partner's portal login (Portal users tab).
8. **Initial supplies**: Supply Orders → New order for partner → approve → dispatch → confirm receipt (creates the supply invoice).
9. Schedule alerts and backups (below).

## Daily / periodic operations

| When | Who | Where |
|---|---|---|
| Daily | Partners submit sales (portal) · Admin approves clean reports in bulk, reviews discrepancies | Sales Reports |
| As needed | Supply requests → approve → dispatch → partner confirms receipt | Supply Orders |
| As needed | Verify partner payment proofs; record collections and bills | Finance / Collections |
| Per contract schedule | Finance creates & submits settlement → Admin approves | Settlements |
| Monthly | Physical counts at warehouse and partner locations | Inventory → Physical counts |
| Any time | Reports with PDF / Excel / CSV export | Reports |

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Develop / build / run production server |
| `npm test` | Unit + integration tests (needs a database whose name contains `_test`, see below) |
| `npm run typecheck` · `npm run lint` | Static checks |
| `npm run db:migrate` | Create a new migration (development) |
| `npm run db:deploy` | Apply migrations (production) |
| `npm run db:seed` | Core configuration + first Super Admin (idempotent, no business data) |
| `npm run db:demo` | Optional demo data |
| `npm run alerts:run` | Run the scheduled alert checks once |

### Tests

```bash
createdb scoopmaster_test
```

```bash
DATABASE_URL="postgresql://USER:PASS@localhost:5432/scoopmaster_test?schema=public" npx prisma migrate deploy
```

```bash
TEST_DATABASE_URL="postgresql://USER:PASS@localhost:5432/scoopmaster_test?schema=public" npm test
```

The integration suite truncates the test database (it refuses to run against a database without `_test` in its name)
and walks the full workflow: catalog → stock receipt (weighted-average cost, FEFO batches) → partner/contract/machine →
supply order → invoice with markup → sales reports with partner prices and discrepancy alerts → edit request reversal →
settlement (no double counting, period lock, segregation of duties) → partner payment verification, partial payments,
voids → physical count → machine ROI.

---

## Deployment (production)

1. **Database**: managed PostgreSQL (e.g. Supabase, Neon, RDS, DigitalOcean) or self-hosted Postgres 16. Use a
   dedicated user with access only to this database. Enable the provider's automated backups as well.
2. **Environment variables** (see `.env.example`):
   * `DATABASE_URL` — Postgres connection string
   * `SESSION_SECRET` — 64 random hex chars (`openssl rand -hex 32`)
   * `CRON_SECRET` — random string for the alerts endpoint
   * `UPLOAD_DIR` — persistent directory for uploaded files (must survive deploys; back it up)
   * `NODE_ENV=production` (enables secure cookies — serve over HTTPS)
3. **Build & migrate**:
   ```bash
   npm ci && npx prisma migrate deploy && npm run build
   ```
   ```bash
   SEED_ADMIN_EMAIL=owner@yourdomain.ph SEED_ADMIN_PASSWORD='…' npm run db:seed
   ```
4. **Run**: `npm start` behind a reverse proxy (Nginx/Caddy) with HTTPS, or use a process manager (pm2/systemd)
   or a container. A VPS (e.g. 2 vCPU / 2 GB RAM) comfortably serves 100+ partner locations.
   Serverless hosts (Vercel) also work for the app, but uploads then need object storage instead of local disk.
5. **Scheduled alerts** (hourly):
   ```bash
   curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/alerts
   ```
6. **Backups** (daily, keep off-site copies):
   ```bash
   DATABASE_URL=… UPLOAD_DIR=/srv/scoopmaster/uploads BACKUP_DIR=/srv/backups ./scripts/backup.sh
   ```
   Restore with `pg_restore --clean --no-owner -d "$DATABASE_URL" backups/db-….dump`. Test a restore regularly.

### Security notes
* Change the seeded password on first login; give each person their own account (the audit log records who did what).
* Only Super Admin/Admin can approve settlements, and the preparer cannot approve their own settlement.
* Partners only ever see their own records; confidential documents (IDs) are never shown in the portal.
* Keep the server, Node.js and dependencies patched (`npm audit`).

---

## Project structure

```
prisma/            schema.prisma, migrations, seed (core config), demo (optional)
src/lib/           money, dates, units, rbac, auth, audit, storage, form/action helpers
src/lib/calc/      pure financial calculations (sales, recipe, settlement, payments, inventory)
src/server/        domain services (inventory ledger, sales, supply, finance, settlements, machines, alerts…), reports, exports
src/app/(staff)/   staff application
src/app/portal/    partner portal (mobile-first)
src/app/api/       file downloads, PDF documents, report exports, cron
src/components/    UI kit, forms, charts, shared views
tests/             unit + end-to-end workflow tests
docs/              architecture & design
scripts/           backup, alert runner
```
