import type { Role } from "@prisma/client";
export type Actor = { id: string; role: Role; partnerId: string | null; name?: string };
