-- Extend points audit enum with submission lifecycle actions.
ALTER TYPE "PointsAuditActionType" ADD VALUE IF NOT EXISTS 'ACTIVITY_SUBMISSION_CREATED';
ALTER TYPE "PointsAuditActionType" ADD VALUE IF NOT EXISTS 'ACTIVITY_SUBMISSION_APPROVED';
ALTER TYPE "PointsAuditActionType" ADD VALUE IF NOT EXISTS 'ACTIVITY_SUBMISSION_REJECTED';

-- Create submission status enum.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubmissionStatus') THEN
        CREATE TYPE "SubmissionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
    END IF;
END$$;

-- Rename existing activity catalog table.
ALTER TABLE "ActivityType" RENAME TO "Activity";

-- Rename legacy indexes tied to previous table name.
ALTER INDEX IF EXISTS "ActivityType_pkey" RENAME TO "Activity_pkey";
ALTER INDEX IF EXISTS "ActivityType_code_key" RENAME TO "Activity_code_key";
ALTER INDEX IF EXISTS "ActivityType_isActive_idx" RENAME TO "Activity_isActive_idx";

-- Create new activity type (kind) lookup table.
CREATE TABLE "ActivityType" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ActivityType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ActivityType_code_key" ON "ActivityType"("code");
CREATE INDEX "ActivityType_isActive_idx" ON "ActivityType"("isActive");

-- Add activity kind FK on existing activity rows.
ALTER TABLE "Activity" ADD COLUMN "activityTypeId" TEXT;

INSERT INTO "ActivityType" ("id", "code", "name", "description", "isActive", "updatedAt")
VALUES
    ('11111111-1111-4111-8111-111111111111', 'MANUAL', 'Manual', 'Admin marks completion directly.', true, NOW()),
    ('22222222-2222-4222-8222-222222222222', 'LINK_BASED', 'Link Based', 'Participant submits link, admin reviews before completion.', true, NOW())
ON CONFLICT ("code") DO NOTHING;

UPDATE "Activity"
SET "activityTypeId" = (
    SELECT "id" FROM "ActivityType" WHERE "code" = 'MANUAL' LIMIT 1
)
WHERE "activityTypeId" IS NULL;

ALTER TABLE "Activity" ALTER COLUMN "activityTypeId" SET NOT NULL;
ALTER TABLE "Activity"
    ADD CONSTRAINT "Activity_activityTypeId_fkey"
    FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Activity_activityTypeId_idx" ON "Activity"("activityTypeId");

-- Keep completion table aligned with renamed activity entity.
DROP INDEX IF EXISTS "ParticipantActivityCompletion_participantId_activityTypeId_key";
DROP INDEX IF EXISTS "ParticipantActivityCompletion_activityTypeId_idx";

ALTER TABLE "ParticipantActivityCompletion"
    DROP CONSTRAINT IF EXISTS "ParticipantActivityCompletion_activityTypeId_fkey";

ALTER TABLE "ParticipantActivityCompletion"
    RENAME COLUMN "activityTypeId" TO "activityId";

ALTER TABLE "ParticipantActivityCompletion"
    ADD COLUMN "submissionLink" TEXT;

CREATE INDEX "ParticipantActivityCompletion_activityId_idx" ON "ParticipantActivityCompletion"("activityId");
CREATE UNIQUE INDEX "ParticipantActivityCompletion_participantId_activityId_key"
    ON "ParticipantActivityCompletion"("participantId", "activityId");

ALTER TABLE "ParticipantActivityCompletion"
    ADD CONSTRAINT "ParticipantActivityCompletion_activityId_fkey"
    FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create submission review table for link-based workflow.
CREATE TABLE "ActivitySubmission" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "submissionLink" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByStaffProfileId" TEXT,
    "reviewNote" TEXT,
    CONSTRAINT "ActivitySubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ActivitySubmission_participantId_idx" ON "ActivitySubmission"("participantId");
CREATE INDEX "ActivitySubmission_activityId_idx" ON "ActivitySubmission"("activityId");
CREATE INDEX "ActivitySubmission_status_submittedAt_idx" ON "ActivitySubmission"("status", "submittedAt");

ALTER TABLE "ActivitySubmission"
    ADD CONSTRAINT "ActivitySubmission_participantId_fkey"
    FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActivitySubmission"
    ADD CONSTRAINT "ActivitySubmission_activityId_fkey"
    FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ActivitySubmission"
    ADD CONSTRAINT "ActivitySubmission_reviewedByStaffProfileId_fkey"
    FOREIGN KEY ("reviewedByStaffProfileId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Update activity creator/updater FK names to match renamed table.
ALTER TABLE "Activity"
    DROP CONSTRAINT IF EXISTS "ActivityType_createdByStaffProfileId_fkey";
ALTER TABLE "Activity"
    DROP CONSTRAINT IF EXISTS "ActivityType_updatedByStaffProfileId_fkey";

ALTER TABLE "Activity"
    ADD CONSTRAINT "Activity_createdByStaffProfileId_fkey"
    FOREIGN KEY ("createdByStaffProfileId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Activity"
    ADD CONSTRAINT "Activity_updatedByStaffProfileId_fkey"
    FOREIGN KEY ("updatedByStaffProfileId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
