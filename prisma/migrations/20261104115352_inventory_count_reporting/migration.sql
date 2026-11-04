-- CreateEnum
CREATE TYPE "SalesReportingMethod" AS ENUM ('THEORETICAL', 'INVENTORY_COUNT');

-- AlterTable
ALTER TABLE "PartnerContract" ADD COLUMN     "reportingMethod" "SalesReportingMethod" NOT NULL DEFAULT 'THEORETICAL';

-- CreateTable
CREATE TABLE "PartnerCountProduct" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "PartnerCountProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCountProduct_partnerId_itemId_key" ON "PartnerCountProduct"("partnerId", "itemId");

-- AddForeignKey
ALTER TABLE "PartnerCountProduct" ADD CONSTRAINT "PartnerCountProduct_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerCountProduct" ADD CONSTRAINT "PartnerCountProduct_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerCountProduct" ADD CONSTRAINT "PartnerCountProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep the Data API locked down for the new table (see stored_files_and_rls).
ALTER TABLE "PartnerCountProduct" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON "PartnerCountProduct" FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON "PartnerCountProduct" FROM authenticated'; END IF;
END $$;
