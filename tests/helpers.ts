import { prisma } from "@/lib/db";
import { seedCore } from "../prisma/seed-core";
import type { Actor } from "@/server/actor";

export async function resetDb() {
  if (!process.env.DATABASE_URL?.includes("_test")) throw new Error("Refusing to reset a non-test database");
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await seedCore(prisma, { adminEmail: "root@test.local", adminPassword: "TestPassword123" });
}

export async function makeStaff(role: Actor["role"], email: string): Promise<Actor> {
  const u = await prisma.user.create({ data: { email, name: email, role, passwordHash: "x" } });
  return { id: u.id, role: u.role, partnerId: null };
}
