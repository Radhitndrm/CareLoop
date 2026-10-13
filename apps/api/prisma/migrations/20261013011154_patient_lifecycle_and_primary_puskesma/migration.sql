-- CreateEnum
CREATE TYPE "PatientStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'INACTIVE', 'BLOCKED');

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "activatedAt" TIMESTAMPTZ,
ADD COLUMN     "activatedById" TEXT,
ADD COLUMN     "deactivatedReason" TEXT,
ADD COLUMN     "primaryPuskesmasId" TEXT,
ADD COLUMN     "status" "PatientStatus" NOT NULL DEFAULT 'ONBOARDING';

-- CreateIndex
CREATE INDEX "Patient_status_idx" ON "Patient"("status");

-- CreateIndex
CREATE INDEX "Patient_primaryPuskesmasId_idx" ON "Patient"("primaryPuskesmasId");

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_primaryPuskesmasId_fkey" FOREIGN KEY ("primaryPuskesmasId") REFERENCES "Puskesmas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill status untuk pasien yang sudah "beroperasi" sebelum status ada.
--
-- Tanpa ini, seluruh pasien lama akan-default ke ONBOARDING dan diam-diam berhenti
-- menerima reminder setelah deploy — patients ini sudah punya resep APPROVED dan
-- jadwal aktif, jadi secara operasional mereka setara ACTIVE. Pasien yang belum
-- memenuhi syarat itu tetap ONBOARDING dan tidak masuk scheduler.
UPDATE "Patient" p
SET "status" = 'ACTIVE',
    "activatedAt" = COALESCE(p."createdAt", NOW())
WHERE p."id" IN (
  SELECT DISTINCT m."patientId"
  FROM "Medication" m
  JOIN "Schedule" s ON s."medicationId" = m."id"
  WHERE m."status" = 'APPROVED' AND s."isActive" = true
)
AND p."status" = 'ONBOARDING';
