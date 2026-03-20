-- CreateEnum
CREATE TYPE "PointsLedgerEntryType" AS ENUM ('MANUAL_ACTIVITY', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PointsAuditActionType" AS ENUM ('ACTIVITY_TYPE_CREATED', 'ACTIVITY_TYPE_UPDATED', 'ACTIVITY_TYPE_TOGGLED', 'ACTIVITY_COMPLETION_MARKED', 'ACTIVITY_COMPLETION_REVOKED', 'POINTS_ADJUSTED');

-- CreateTable
CREATE TABLE "ActivityType" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "points" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByStaffProfileId" TEXT,
    "updatedByStaffProfileId" TEXT,

    CONSTRAINT "ActivityType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParticipantActivityCompletion" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "activityTypeId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "markedByStaffProfileId" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "ParticipantActivityCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointsLedger" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "entryType" "PointsLedgerEntryType" NOT NULL,
    "pointsDelta" INTEGER NOT NULL,
    "sourceCompletionId" TEXT,
    "actorStaffProfileId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointsLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointsSummary" (
    "participantId" TEXT NOT NULL,
    "totalPoints" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PointsSummary_pkey" PRIMARY KEY ("participantId")
);

-- CreateTable
CREATE TABLE "PointsAuditLog" (
    "id" TEXT NOT NULL,
    "actorStaffProfileId" TEXT NOT NULL,
    "actionType" "PointsAuditActionType" NOT NULL,
    "targetType" VARCHAR(50),
    "targetId" TEXT,
    "note" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointsAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActivityType_code_key" ON "ActivityType"("code");

-- CreateIndex
CREATE INDEX "ActivityType_isActive_idx" ON "ActivityType"("isActive");

-- CreateIndex
CREATE INDEX "ParticipantActivityCompletion_participantId_idx" ON "ParticipantActivityCompletion"("participantId");

-- CreateIndex
CREATE INDEX "ParticipantActivityCompletion_activityTypeId_idx" ON "ParticipantActivityCompletion"("activityTypeId");

-- CreateIndex
CREATE INDEX "ParticipantActivityCompletion_markedByStaffProfileId_idx" ON "ParticipantActivityCompletion"("markedByStaffProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "ParticipantActivityCompletion_participantId_activityTypeId_key" ON "ParticipantActivityCompletion"("participantId", "activityTypeId");

-- CreateIndex
CREATE INDEX "PointsLedger_participantId_createdAt_idx" ON "PointsLedger"("participantId", "createdAt");

-- CreateIndex
CREATE INDEX "PointsLedger_entryType_idx" ON "PointsLedger"("entryType");

-- CreateIndex
CREATE INDEX "PointsLedger_actorStaffProfileId_idx" ON "PointsLedger"("actorStaffProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "PointsLedger_sourceCompletionId_key" ON "PointsLedger"("sourceCompletionId");

-- CreateIndex
CREATE INDEX "PointsSummary_totalPoints_idx" ON "PointsSummary"("totalPoints");

-- CreateIndex
CREATE INDEX "PointsAuditLog_actorStaffProfileId_createdAt_idx" ON "PointsAuditLog"("actorStaffProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "PointsAuditLog_actionType_createdAt_idx" ON "PointsAuditLog"("actionType", "createdAt");

-- AddForeignKey
ALTER TABLE "ActivityType" ADD CONSTRAINT "ActivityType_createdByStaffProfileId_fkey" FOREIGN KEY ("createdByStaffProfileId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityType" ADD CONSTRAINT "ActivityType_updatedByStaffProfileId_fkey" FOREIGN KEY ("updatedByStaffProfileId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipantActivityCompletion" ADD CONSTRAINT "ParticipantActivityCompletion_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipantActivityCompletion" ADD CONSTRAINT "ParticipantActivityCompletion_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipantActivityCompletion" ADD CONSTRAINT "ParticipantActivityCompletion_markedByStaffProfileId_fkey" FOREIGN KEY ("markedByStaffProfileId") REFERENCES "StaffProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsLedger" ADD CONSTRAINT "PointsLedger_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsLedger" ADD CONSTRAINT "PointsLedger_sourceCompletionId_fkey" FOREIGN KEY ("sourceCompletionId") REFERENCES "ParticipantActivityCompletion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsLedger" ADD CONSTRAINT "PointsLedger_actorStaffProfileId_fkey" FOREIGN KEY ("actorStaffProfileId") REFERENCES "StaffProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsSummary" ADD CONSTRAINT "PointsSummary_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsAuditLog" ADD CONSTRAINT "PointsAuditLog_actorStaffProfileId_fkey" FOREIGN KEY ("actorStaffProfileId") REFERENCES "StaffProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
