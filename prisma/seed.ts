import { PrismaClient } from "@prisma/client";
import { seedCore } from "./seed-core";

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@scoopmaster.local";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe12345";
  await seedCore(prisma, { adminEmail, adminPassword });
  console.log(`✔ Core configuration seeded. Super Admin: ${adminEmail}`);
  if (!process.env.SEED_ADMIN_PASSWORD) console.log("  ⚠ Using the default password — change it immediately after first login.");
}

main().finally(() => prisma.$disconnect());
