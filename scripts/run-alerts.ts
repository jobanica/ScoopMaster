import { runScheduledChecks } from "../src/server/services/alerts";
import { prisma } from "../src/lib/db";

runScheduledChecks().then((c) => { console.log("Alerts created:", c); }).finally(() => prisma.$disconnect());
