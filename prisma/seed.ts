import { PrismaClient } from "@prisma/client";
import { seedCore } from "./seed-core";
import { passwordProblem } from "../src/lib/password";

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@scoopmaster.local";
  let adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const isProd = process.env.NODE_ENV === "production" || !!process.env.VERCEL;
  const hasAdmin = (await prisma.user.count({ where: { role: "SUPER_ADMIN" } })) > 0;
  if (!adminPassword) {
    if (isProd && !hasAdmin) {
      console.warn("⚠ No SEED_ADMIN_PASSWORD set — core configuration seeded but no Super Admin created.");
    }
    adminPassword = isProd ? undefined : "ChangeMe12345";
  } else if (passwordProblem(adminPassword)) {
    throw new Error(`SEED_ADMIN_PASSWORD rejected: ${passwordProblem(adminPassword)}`);
  }
  await seedCore(prisma, { adminEmail, adminPassword: adminPassword ?? "" , skipAdmin: !adminPassword });
  console.log(`✔ Core configuration seeded.${adminPassword && !hasAdmin ? ` Super Admin: ${adminEmail}` : ""}`);
  if (!process.env.SEED_ADMIN_PASSWORD && !isProd) console.log("  ⚠ Using the default password — change it immediately after first login.");
}

main().finally(() => prisma.$disconnect());
