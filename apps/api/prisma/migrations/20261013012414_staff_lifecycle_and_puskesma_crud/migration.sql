-- CreateEnum
CREATE TYPE "StaffStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- AlterTable
ALTER TABLE "NakesAssignment" ADD COLUMN     "assignedById" TEXT,
ADD COLUMN     "endedAt" TIMESTAMPTZ,
ADD COLUMN     "note" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "activatedAt" TIMESTAMPTZ,
ADD COLUMN     "activationCodeExpiresAt" TIMESTAMPTZ,
ADD COLUMN     "activationCodeHash" TEXT,
ADD COLUMN     "staffStatus" "StaffStatus";

-- CreateIndex
CREATE INDEX "NakesAssignment_nakesUserId_isActive_idx" ON "NakesAssignment"("nakesUserId", "isActive");

-- CreateIndex
CREATE INDEX "User_role_staffStatus_idx" ON "User"("role", "staffStatus");

-- Backfill staff_status untuk akun NAKES yang sudah ada.
--
-- Kolom sengaja nullable: hanya relevan untuk role NAKES, dan akun patient/family
-- tidak punya konsep "status staf". Akun NAKES lama sudah aktif sebelum enum ini ada,
-- jadi harus ditandai ACTIVE agar tidak ikut terkunci saat login mulai memeriksanya.
UPDATE "User" SET "staffStatus" = 'ACTIVE' WHERE "role" = 'NAKES';
