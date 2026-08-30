-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PATIENT', 'FAMILY', 'NAKES', 'ADMIN');

-- CreateEnum
CREATE TYPE "LivingSituation" AS ENUM ('ALONE', 'WITH_FAMILY', 'FAR_FROM_FAMILY', 'OTHER');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('M', 'F');

-- CreateEnum
CREATE TYPE "EmergencyPreference" AS ENUM ('FAMILY_FIRST', 'NAKES_FIRST');

-- CreateEnum
CREATE TYPE "ComplianceStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CONFIRMED_LATE', 'MISSED', 'TUNDA');

-- CreateEnum
CREATE TYPE "VitalSource" AS ENUM ('GOOGLE_FIT', 'HEALTHKIT', 'MOCK');

-- CreateEnum
CREATE TYPE "EmergencyStatus" AS ENUM ('PENDING_PATIENT_CONFIRM', 'ESCALATING', 'RESOLVED_SAFE', 'HANDLED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "EmergencyTrigger" AS ENUM ('ANOMALY_HR', 'NO_RESPONSE_MED', 'OTHER');

-- CreateEnum
CREATE TYPE "EscalationContext" AS ENUM ('SCHEDULE', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "EscalationRunStatus" AS ENUM ('WAITING_PATIENT', 'FAMILY_TIER_1', 'FAMILY_TIER_2', 'NAKES', 'HANDLED', 'RESOLVED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "EscalationTier" AS ENUM ('TIER_1', 'TIER_2', 'NAKES');

-- CreateEnum
CREATE TYPE "ResolutionType" AS ENUM ('PATIENT_CONFIRMED', 'FAMILY_HANDLED', 'NAKES_HANDLED', 'TIMEOUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Relationship" AS ENUM ('ANAK', 'PASANGAN', 'SAUDARA', 'CUCU', 'TETANGGA', 'KEPONAKAN', 'LAINNYA');

-- CreateEnum
CREATE TYPE "FamilyTier" AS ENUM ('TIER_1', 'TIER_2');

-- CreateEnum
CREATE TYPE "NakesRole" AS ENUM ('DOKTER', 'PERAWAT', 'BIDAN', 'KADER', 'LAINNYA');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('WHATSAPP', 'PUSH', 'WEBSOCKET', 'SMS', 'IN_APP', 'VOICE');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('REMINDER', 'ESCALATION', 'EMERGENCY', 'REFILL', 'EDUCATION', 'SKRINING', 'RISK_UPDATE', 'OTHER');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RETRYING');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "FacilityType" AS ENUM ('PUSKESMAS', 'PUSKESMAS_PEMBANTU', 'RUMAH_SAKIT', 'KLINIK', 'APOTEK');

-- CreateEnum
CREATE TYPE "ScreeningType" AS ENUM ('DIABETES_RISK', 'HYPERTENSION', 'GENERAL');

-- CreateEnum
CREATE TYPE "ScreeningStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "ReminderChannel" AS ENUM ('WHATSAPP', 'PUSH', 'VOICE');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('SENT', 'FAILED', 'RETRYING');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "MedicalForm" AS ENUM ('TABLET', 'KAPSUL', 'SIRUP', 'INJEKSI', 'LAINNYA');

-- CreateEnum
CREATE TYPE "EscalationStepResponse" AS ENUM ('ACK_HANDLE', 'ACK_LOOKING', 'NONE');

-- CreateEnum
CREATE TYPE "NakesScopeType" AS ENUM ('PUSKESMAS', 'DISTRICT', 'ALL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "fullName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'id',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "consentPdpAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "nik" TEXT,
    "dateOfBirth" DATE,
    "gender" "Gender",
    "address" TEXT,
    "districtCode" TEXT,
    "city" TEXT,
    "province" TEXT,
    "livingSituation" "LivingSituation" NOT NULL DEFAULT 'WITH_FAMILY',
    "hasNearbyFamily" BOOLEAN NOT NULL DEFAULT true,
    "emergencyPreference" "EmergencyPreference" NOT NULL DEFAULT 'FAMILY_FIRST',
    "healthConditions" TEXT[],
    "bpjsNumber" TEXT,
    "smartwatchEnabled" BOOLEAN NOT NULL DEFAULT false,
    "voiceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "devicePushToken" TEXT,
    "lastKnownLat" DECIMAL(10,7),
    "lastKnownLng" DECIMAL(10,7),
    "lastLocationAt" TIMESTAMPTZ,
    "riskScore" INTEGER,
    "riskLevel" "RiskLevel",
    "consentShareWithNakes" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Puskesmas" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FacilityType" NOT NULL DEFAULT 'PUSKESMAS',
    "districtCode" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "lat" DECIMAL(10,7),
    "lng" DECIMAL(10,7),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Puskesmas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Facility" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FacilityType" NOT NULL,
    "districtCode" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "lat" DECIMAL(10,7),
    "lng" DECIMAL(10,7),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NakesAssignment" (
    "id" TEXT NOT NULL,
    "nakesUserId" TEXT NOT NULL,
    "puskesmasId" TEXT,
    "districtCode" TEXT,
    "scopeType" "NakesScopeType" NOT NULL DEFAULT 'PUSKESMAS',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NakesAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NakesContact" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "nakesUserId" TEXT,
    "nakesName" TEXT NOT NULL,
    "nakesRole" "NakesRole" NOT NULL DEFAULT 'LAINNYA',
    "phone" TEXT NOT NULL,
    "puskesmasId" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NakesContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyContact" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "relationship" "Relationship" NOT NULL,
    "tier" "FamilyTier" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "isNearby" BOOLEAN NOT NULL DEFAULT false,
    "canViewHealth" BOOLEAN NOT NULL DEFAULT false,
    "canReceiveEmergency" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "FamilyContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Medication" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "genericName" TEXT,
    "dosage" TEXT,
    "form" "MedicalForm" NOT NULL DEFAULT 'TABLET',
    "instructions" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" DATE NOT NULL,
    "endedAt" DATE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Medication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "medicationId" TEXT NOT NULL,
    "timeOfDay" TEXT NOT NULL,
    "daysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "dailyFrequency" INTEGER NOT NULL DEFAULT 1,
    "doseQty" TEXT NOT NULL DEFAULT '1 tablet',
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "timeWindowMinutes" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationStock" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "medicationId" TEXT NOT NULL,
    "quantityRemaining" INTEGER NOT NULL,
    "lastRefillAt" TIMESTAMPTZ NOT NULL,
    "refillReminderSentAt" TIMESTAMPTZ,
    "refillConfirmedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "MedicationStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceLog" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "medicationId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMPTZ NOT NULL,
    "confirmedAt" TIMESTAMPTZ,
    "status" "ComplianceStatus" NOT NULL DEFAULT 'PENDING',
    "channel" "Channel" NOT NULL DEFAULT 'WHATSAPP',
    "sourceMessageId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VitalSign" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "recordedAt" TIMESTAMPTZ NOT NULL,
    "source" "VitalSource" NOT NULL,
    "hrBpm" INTEGER,
    "spo2" INTEGER,
    "systolic" INTEGER,
    "diastolic" INTEGER,
    "isAnomalous" BOOLEAN NOT NULL DEFAULT false,
    "anomalyReason" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VitalSign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyAlert" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "triggeredAt" TIMESTAMPTZ NOT NULL,
    "triggerType" "EmergencyTrigger" NOT NULL,
    "hrBpm" INTEGER,
    "patientConfirmedSafe" BOOLEAN,
    "patientConfirmedAt" TIMESTAMPTZ,
    "locationLat" DECIMAL(10,7),
    "locationLng" DECIMAL(10,7),
    "status" "EmergencyStatus" NOT NULL DEFAULT 'PENDING_PATIENT_CONFIRM',
    "alertSentToFamilyAt" TIMESTAMPTZ,
    "alertSentToNakesAt" TIMESTAMPTZ,
    "resolvedAt" TIMESTAMPTZ,
    "resolvedByUserId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "EmergencyAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationRun" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "context" "EscalationContext" NOT NULL,
    "sourceScheduleId" TEXT,
    "sourceEmergencyId" TEXT,
    "status" "EscalationRunStatus" NOT NULL DEFAULT 'WAITING_PATIENT',
    "currentTier" "EscalationTier",
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ,
    "resolvedByUserId" TEXT,
    "resolutionType" "ResolutionType",
    "configSnapshot" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "EscalationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "tier" "EscalationTier",
    "contactUserId" TEXT,
    "contactPhone" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "messageKey" TEXT NOT NULL,
    "sentAt" TIMESTAMPTZ,
    "deliveredAt" TIMESTAMPTZ,
    "readAt" TIMESTAMPTZ,
    "respondedAt" TIMESTAMPTZ,
    "response" "EscalationStepResponse" NOT NULL DEFAULT 'NONE',
    "providerMessageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EscalationStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "patientId" TEXT,
    "channel" "Channel" NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB,
    "providerMessageId" TEXT,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "sentAt" TIMESTAMPTZ,
    "deliveredAt" TIMESTAMPTZ,
    "readAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderLog" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "scheduledFireAt" TIMESTAMPTZ NOT NULL,
    "actualFireAt" TIMESTAMPTZ NOT NULL,
    "channel" "ReminderChannel" NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'SENT',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "providerMessageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorRole" "UserRole",
    "action" TEXT NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "patientId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'PENDING',
    "fileUrl" TEXT,
    "rowCount" INTEGER,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ,

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Screening" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "userId" TEXT,
    "screeningType" "ScreeningType" NOT NULL,
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ,
    "totalScore" INTEGER,
    "level" "RiskLevel",
    "status" "ScreeningStatus" NOT NULL DEFAULT 'IN_PROGRESS',

    CONSTRAINT "Screening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreeningAnswer" (
    "id" TEXT NOT NULL,
    "screeningId" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "answerValue" TEXT NOT NULL,
    "answeredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreeningAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskPrediction" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "computedOn" DATE NOT NULL,
    "score" INTEGER NOT NULL,
    "level" "RiskLevel" NOT NULL,
    "factors" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskPrediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatbotSession" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ,

    CONSTRAINT "ChatbotSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatbotMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "message" TEXT NOT NULL,
    "intent" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatbotMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_nik_key" ON "Patient"("nik");

-- CreateIndex
CREATE INDEX "Patient_districtCode_idx" ON "Patient"("districtCode");

-- CreateIndex
CREATE INDEX "Patient_riskLevel_updatedAt_idx" ON "Patient"("riskLevel", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Facility_type_idx" ON "Facility"("type");

-- CreateIndex
CREATE UNIQUE INDEX "NakesAssignment_nakesUserId_puskesmasId_districtCode_key" ON "NakesAssignment"("nakesUserId", "puskesmasId", "districtCode");

-- CreateIndex
CREATE INDEX "NakesContact_patientId_isActive_idx" ON "NakesContact"("patientId", "isActive");

-- CreateIndex
CREATE INDEX "FamilyContact_patientId_isActive_tier_priority_idx" ON "FamilyContact"("patientId", "isActive", "tier", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyContact_patientId_phone_key" ON "FamilyContact"("patientId", "phone");

-- CreateIndex
CREATE INDEX "Schedule_isActive_timeOfDay_idx" ON "Schedule"("isActive", "timeOfDay");

-- CreateIndex
CREATE INDEX "Schedule_patientId_idx" ON "Schedule"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicationStock_patientId_medicationId_key" ON "MedicationStock"("patientId", "medicationId");

-- CreateIndex
CREATE INDEX "ComplianceLog_patientId_scheduledAt_idx" ON "ComplianceLog"("patientId", "scheduledAt" DESC);

-- CreateIndex
CREATE INDEX "ComplianceLog_scheduleId_scheduledAt_idx" ON "ComplianceLog"("scheduleId", "scheduledAt");

-- CreateIndex
CREATE INDEX "ComplianceLog_status_scheduledAt_idx" ON "ComplianceLog"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceLog_scheduleId_scheduledAt_key" ON "ComplianceLog"("scheduleId", "scheduledAt");

-- CreateIndex
CREATE INDEX "VitalSign_patientId_recordedAt_idx" ON "VitalSign"("patientId", "recordedAt" DESC);

-- CreateIndex
CREATE INDEX "VitalSign_isAnomalous_recordedAt_idx" ON "VitalSign"("isAnomalous", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VitalSign_patientId_source_recordedAt_key" ON "VitalSign"("patientId", "source", "recordedAt");

-- CreateIndex
CREATE INDEX "EmergencyAlert_status_triggeredAt_idx" ON "EmergencyAlert"("status", "triggeredAt" DESC);

-- CreateIndex
CREATE INDEX "EmergencyAlert_patientId_triggeredAt_idx" ON "EmergencyAlert"("patientId", "triggeredAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "EscalationRun_sourceEmergencyId_key" ON "EscalationRun"("sourceEmergencyId");

-- CreateIndex
CREATE INDEX "EscalationRun_status_idx" ON "EscalationRun"("status");

-- CreateIndex
CREATE INDEX "EscalationRun_patientId_startedAt_idx" ON "EscalationRun"("patientId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "EscalationStep_runId_idx" ON "EscalationStep"("runId");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_patientId_createdAt_idx" ON "Notification"("patientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ReminderLog_scheduleId_scheduledFireAt_idx" ON "ReminderLog"("scheduleId", "scheduledFireAt");

-- CreateIndex
CREATE INDEX "ReminderLog_patientId_scheduledFireAt_idx" ON "ReminderLog"("patientId", "scheduledFireAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_patientId_createdAt_idx" ON "AuditLog"("patientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Screening_patientId_startedAt_idx" ON "Screening"("patientId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "ScreeningAnswer_screeningId_idx" ON "ScreeningAnswer"("screeningId");

-- CreateIndex
CREATE INDEX "RiskPrediction_patientId_computedOn_idx" ON "RiskPrediction"("patientId", "computedOn" DESC);

-- CreateIndex
CREATE INDEX "ChatbotSession_patientId_startedAt_idx" ON "ChatbotSession"("patientId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "ChatbotMessage_sessionId_createdAt_idx" ON "ChatbotMessage"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_id_fkey" FOREIGN KEY ("id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NakesAssignment" ADD CONSTRAINT "NakesAssignment_nakesUserId_fkey" FOREIGN KEY ("nakesUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NakesAssignment" ADD CONSTRAINT "NakesAssignment_puskesmasId_fkey" FOREIGN KEY ("puskesmasId") REFERENCES "Puskesmas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NakesContact" ADD CONSTRAINT "NakesContact_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NakesContact" ADD CONSTRAINT "NakesContact_nakesUserId_fkey" FOREIGN KEY ("nakesUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NakesContact" ADD CONSTRAINT "NakesContact_puskesmasId_fkey" FOREIGN KEY ("puskesmasId") REFERENCES "Puskesmas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyContact" ADD CONSTRAINT "FamilyContact_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyContact" ADD CONSTRAINT "FamilyContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medication" ADD CONSTRAINT "Medication_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "Medication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationStock" ADD CONSTRAINT "MedicationStock_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationStock" ADD CONSTRAINT "MedicationStock_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "Medication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceLog" ADD CONSTRAINT "ComplianceLog_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceLog" ADD CONSTRAINT "ComplianceLog_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceLog" ADD CONSTRAINT "ComplianceLog_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "Medication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VitalSign" ADD CONSTRAINT "VitalSign_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyAlert" ADD CONSTRAINT "EmergencyAlert_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyAlert" ADD CONSTRAINT "EmergencyAlert_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationRun" ADD CONSTRAINT "EscalationRun_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationRun" ADD CONSTRAINT "EscalationRun_sourceScheduleId_fkey" FOREIGN KEY ("sourceScheduleId") REFERENCES "Schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationRun" ADD CONSTRAINT "EscalationRun_sourceEmergencyId_fkey" FOREIGN KEY ("sourceEmergencyId") REFERENCES "EmergencyAlert"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationRun" ADD CONSTRAINT "EscalationRun_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationStep" ADD CONSTRAINT "EscalationStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "EscalationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationStep" ADD CONSTRAINT "EscalationStep_contactUserId_fkey" FOREIGN KEY ("contactUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderLog" ADD CONSTRAINT "ReminderLog_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderLog" ADD CONSTRAINT "ReminderLog_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screening" ADD CONSTRAINT "Screening_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screening" ADD CONSTRAINT "Screening_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningAnswer" ADD CONSTRAINT "ScreeningAnswer_screeningId_fkey" FOREIGN KEY ("screeningId") REFERENCES "Screening"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskPrediction" ADD CONSTRAINT "RiskPrediction_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatbotSession" ADD CONSTRAINT "ChatbotSession_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatbotMessage" ADD CONSTRAINT "ChatbotMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatbotSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------- idempotency guards (CL-002)
-- Ditulis manual: Prisma belum mendukung partial unique index secara deklaratif.
-- Ref: docs/DATABASE.md §4 (Unique & Guard), AGENTS.md §2 (webhook idempoten).

-- Hanya boleh ada SATU escalation run aktif per (patient, context).
CREATE UNIQUE INDEX IF NOT EXISTS "EscalationRun_active_patient_context_key"
  ON "EscalationRun" ("patientId", "context")
  WHERE "status" NOT IN ('HANDLED', 'RESOLVED', 'TIMED_OUT');

-- Dedup pesan masuk WhatsApp: satu source message hanya boleh menghasilkan satu compliance log.
CREATE UNIQUE INDEX IF NOT EXISTS "ComplianceLog_sourceMessageId_key"
  ON "ComplianceLog" ("sourceMessageId")
  WHERE "sourceMessageId" IS NOT NULL;

-- Dedup provider message id pada langkah eskalasi (retry webhook status WhatsApp).
CREATE UNIQUE INDEX IF NOT EXISTS "EscalationStep_providerMessageId_key"
  ON "EscalationStep" ("providerMessageId")
  WHERE "providerMessageId" IS NOT NULL;

-- Dedup provider message id pada notifikasi keluar.
CREATE UNIQUE INDEX IF NOT EXISTS "Notification_providerMessageId_key"
  ON "Notification" ("providerMessageId")
  WHERE "providerMessageId" IS NOT NULL;
