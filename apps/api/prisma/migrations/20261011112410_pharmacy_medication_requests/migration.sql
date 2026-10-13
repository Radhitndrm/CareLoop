-- CreateEnum
CREATE TYPE "MedicationRequestSource" AS ENUM ('ROUTINE', 'PATIENT_REQUEST');

-- CreateEnum
CREATE TYPE "MedicationRequestStatus" AS ENUM ('PENDING_DOCTOR', 'QUEUED', 'PREPARING', 'READY', 'DISPENSED', 'REJECTED', 'OUT_OF_STOCK', 'SUBSTITUTED');

-- CreateEnum
CREATE TYPE "MedicationRequestReason" AS ENUM ('EARLY_PICKUP', 'MEDICATION_LOST', 'DAMAGED', 'EXTRA', 'OTHER');

-- CreateEnum
CREATE TYPE "MedicationRequestAction" AS ENUM ('CREATED', 'APPROVED', 'REJECTED', 'START_PREPARING', 'MARK_READY', 'DISPENSED', 'MARK_OUT_OF_STOCK', 'MARK_SUBSTITUTED', 'RETURNED_TO_QUEUE');

-- AlterEnum
ALTER TYPE "NakesRole" ADD VALUE 'FARMASI';

-- AlterTable
ALTER TABLE "Medication" ADD COLUMN     "daysSupply" INTEGER,
ADD COLUMN     "nextPickupAt" DATE;

-- CreateTable
CREATE TABLE "MedicationRequest" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "medicationId" TEXT NOT NULL,
    "requestedQuantity" INTEGER NOT NULL,
    "approvedQuantity" INTEGER,
    "source" "MedicationRequestSource" NOT NULL,
    "status" "MedicationRequestStatus" NOT NULL DEFAULT 'PENDING_DOCTOR',
    "reasonCode" "MedicationRequestReason",
    "reasonNotes" TEXT,
    "doctorId" TEXT,
    "doctorDecisionNote" TEXT,
    "decidedAt" TIMESTAMPTZ,
    "dueAt" DATE NOT NULL,
    "blockedReason" TEXT,
    "substituteName" TEXT,
    "isSubstituteApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "MedicationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispensingRecord" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "pharmacistId" TEXT NOT NULL,
    "quantityDays" INTEGER NOT NULL,
    "dispensedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextPickupDate" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispensingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationRequestEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fromStatus" "MedicationRequestStatus",
    "toStatus" "MedicationRequestStatus" NOT NULL,
    "action" "MedicationRequestAction" NOT NULL,
    "actorUserId" TEXT,
    "actorRole" "UserRole",
    "note" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicationRequestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MedicationRequest_status_dueAt_idx" ON "MedicationRequest"("status", "dueAt");

-- CreateIndex
CREATE INDEX "MedicationRequest_patientId_createdAt_idx" ON "MedicationRequest"("patientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MedicationRequest_medicationId_idx" ON "MedicationRequest"("medicationId");

-- CreateIndex
CREATE UNIQUE INDEX "DispensingRecord_requestId_key" ON "DispensingRecord"("requestId");

-- CreateIndex
CREATE INDEX "MedicationRequestEvent_requestId_createdAt_idx" ON "MedicationRequestEvent"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "Medication_status_nextPickupAt_idx" ON "Medication"("status", "nextPickupAt");

-- AddForeignKey
ALTER TABLE "MedicationRequest" ADD CONSTRAINT "MedicationRequest_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationRequest" ADD CONSTRAINT "MedicationRequest_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "Medication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationRequest" ADD CONSTRAINT "MedicationRequest_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispensingRecord" ADD CONSTRAINT "DispensingRecord_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MedicationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispensingRecord" ADD CONSTRAINT "DispensingRecord_pharmacistId_fkey" FOREIGN KEY ("pharmacistId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationRequestEvent" ADD CONSTRAINT "MedicationRequestEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MedicationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationRequestEvent" ADD CONSTRAINT "MedicationRequestEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial unique index: satu permintaan AKTIF per pasien+obat (CL-002 — Prisma tidak
-- bisa mendeklarasikan partial index, jadi ditulis sebagai SQL mentah seperti index
-- parsial lain di migrasi _init). Ini yang membuat dua submit bersamaan dari pasien
-- yang sama berakhir 409 ALREADY_PROCESSED lewat pemetaan P2002 di lib/errors.ts.
-- Riwayat permintaan yang sudah selesai (DISPENSED/REJECTED/OUT_OF_STOCK/SUBSTITUTED)
-- tetap tersimpan penuh — hanya status aktif yang diblokir duplikat.
CREATE UNIQUE INDEX "MedicationRequest_active_key"
  ON "MedicationRequest"("patientId", "medicationId")
  WHERE "status" IN ('PENDING_DOCTOR', 'QUEUED', 'PREPARING', 'READY');
