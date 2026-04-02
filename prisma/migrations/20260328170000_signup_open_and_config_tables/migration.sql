-- Make participant CNIC optional so brand new signup can create profile before CNIC is collected.
ALTER TABLE "Participant"
ALTER COLUMN "cnic" DROP NOT NULL;

-- Persist full name captured at signup request for participant creation at verify step.
ALTER TABLE "SignupOtpLink"
ADD COLUMN "fullName" VARCHAR(100);

-- Global key-value configuration storage.
CREATE TABLE "MasterConfig" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "valueText" VARCHAR(255),
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MasterConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MasterConfig_key_key" ON "MasterConfig"("key");

-- Competition-scoped key-value configuration overrides.
CREATE TABLE "CompetitionConfig" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "valueText" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompetitionConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompetitionConfig_competitionId_key_key" ON "CompetitionConfig"("competitionId", "key");
CREATE INDEX "CompetitionConfig_key_idx" ON "CompetitionConfig"("key");

ALTER TABLE "CompetitionConfig"
ADD CONSTRAINT "CompetitionConfig_competitionId_fkey"
FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
