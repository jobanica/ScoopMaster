-- AlterTable
ALTER TABLE "SalesReport" ADD COLUMN     "method" "SalesReportingMethod" NOT NULL DEFAULT 'THEORETICAL',
ADD COLUMN     "powderVariancePct" DECIMAL(7,2);

-- AlterTable
ALTER TABLE "SalesReportStock" ADD COLUMN     "counted" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "unitValue" DECIMAL(14,4) NOT NULL DEFAULT 0,
ADD COLUMN     "used" DECIMAL(14,4) NOT NULL DEFAULT 0,
ADD COLUMN     "wasted" DECIMAL(14,4) NOT NULL DEFAULT 0;
