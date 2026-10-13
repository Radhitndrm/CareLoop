-- CreateEnum
CREATE TYPE "MedicationStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Medication" ADD COLUMN     "approvedAt" TIMESTAMPTZ,
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "status" "MedicationStatus" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "hrMaxBpm" INTEGER,
ADD COLUMN     "hrMinBpm" INTEGER;

-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN     "approvedAt" TIMESTAMPTZ,
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "status" "MedicationStatus" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "nakesRole" "NakesRole" DEFAULT 'PERAWAT';

-- CreateIndex
CREATE INDEX "Medication_patientId_status_idx" ON "Medication"("patientId", "status");

-- CreateIndex
CREATE INDEX "Schedule_status_idx" ON "Schedule"("status");

-- AddForeignKey
ALTER TABLE "Medication" ADD CONSTRAINT "Medication_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: resep & jadwal yang sudah ada sebelum kolom status diperkenalkan dianggap
-- sudah disahkan dokter, supaya eskalasi/reminder pasien lama tidak ikut berhenti.
UPDATE "Medication" SET "status" = 'APPROVED' WHERE "approvedAt" IS NULL;
UPDATE "Schedule"   SET "status" = 'APPROVED' WHERE "approvedAt" IS NULL;
