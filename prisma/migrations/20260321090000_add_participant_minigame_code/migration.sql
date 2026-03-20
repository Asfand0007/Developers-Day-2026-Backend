ALTER TABLE "Participant"
ADD COLUMN "minigameCode" VARCHAR(20);

CREATE UNIQUE INDEX "Participant_minigameCode_key"
ON "Participant"("minigameCode");
