-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "salesReportId" TEXT;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_salesReportId_fkey" FOREIGN KEY ("salesReportId") REFERENCES "SalesReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
