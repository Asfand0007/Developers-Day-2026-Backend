-- Align points activity schema with current backend expectations.
ALTER TABLE "Activity"
    ADD COLUMN IF NOT EXISTS "correctAnswerCanonical" VARCHAR(300);

ALTER TABLE "ActivitySubmission"
    ADD COLUMN IF NOT EXISTS "submissionText" VARCHAR(300);

ALTER TABLE "ActivitySubmission"
    ALTER COLUMN "submissionLink" DROP NOT NULL;

-- Add OTP-link table used by participant signup flow.
CREATE TABLE IF NOT EXISTS "SignupOtpLink" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "requestedIp" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SignupOtpLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SignupOtpLink_tokenHash_key" ON "SignupOtpLink"("tokenHash");
CREATE INDEX IF NOT EXISTS "SignupOtpLink_email_createdAt_idx" ON "SignupOtpLink"("email", "createdAt");
CREATE INDEX IF NOT EXISTS "SignupOtpLink_expiresAt_idx" ON "SignupOtpLink"("expiresAt");

-- Seed new first-class activity types.
INSERT INTO "ActivityType" ("id", "code", "name", "description", "isActive", "updatedAt")
VALUES
    ('33333333-3333-4333-8333-333333333333', 'CORRECT_ANSWER', 'Correct Answer', 'Participant submits a text answer. Correct answers are auto-approved using canonical normalization.', true, NOW()),
    ('44444444-4444-4444-8444-444444444444', 'MANUAL_TEXT_SUBMISSION', 'Manual Text Submission', 'Participant submits text and admin reviews before approval.', true, NOW())
ON CONFLICT ("code")
DO UPDATE SET
    "name" = EXCLUDED."name",
    "description" = EXCLUDED."description",
    "isActive" = EXCLUDED."isActive",
    "updatedAt" = NOW();
