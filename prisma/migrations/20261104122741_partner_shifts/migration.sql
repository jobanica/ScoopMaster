-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SHIFT_VARIANCE';

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedById" TEXT,
    "autoOpened" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
    "reportId" TEXT,
    "hasDiscrepancy" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftLine" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lastClosing" DECIMAL(14,4),
    "receivedSince" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "carriedOver" DECIMAL(14,4) NOT NULL,
    "counted" DECIMAL(14,4),
    "variance" DECIMAL(14,4) NOT NULL DEFAULT 0,

    CONSTRAINT "ShiftLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shift_number_key" ON "Shift"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_reportId_key" ON "Shift"("reportId");

-- CreateIndex
CREATE INDEX "Shift_businessDate_status_idx" ON "Shift"("businessDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_partnerId_businessDate_key" ON "Shift"("partnerId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftLine_shiftId_itemId_key" ON "ShiftLine"("shiftId", "itemId");

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "SalesReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftLine" ADD CONSTRAINT "ShiftLine_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftLine" ADD CONSTRAINT "ShiftLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep the Data API locked down for the new tables.
ALTER TABLE "Shift" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShiftLine" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON "Shift", "ShiftLine" FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON "Shift", "ShiftLine" FROM authenticated'; END IF;
END $$;
