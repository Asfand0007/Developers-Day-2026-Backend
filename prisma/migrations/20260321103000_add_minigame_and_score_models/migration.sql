CREATE TABLE "Minigame" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "api_key_hash" TEXT,
    "api_key_prefix" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Minigame_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Score" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_code" VARCHAR(20) NOT NULL,
    "game_id" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "play_time" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Score_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Minigame_name_key" ON "Minigame"("name");
CREATE UNIQUE INDEX "Minigame_api_key_hash_key" ON "Minigame"("api_key_hash");
CREATE UNIQUE INDEX "Score_user_code_game_id_key" ON "Score"("user_code", "game_id");
CREATE INDEX "Score_game_id_score_play_time_idx" ON "Score"("game_id", "score" DESC, "play_time" ASC);

ALTER TABLE "Score"
ADD CONSTRAINT "Score_user_code_fkey"
FOREIGN KEY ("user_code") REFERENCES "Participant"("minigameCode")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Score"
ADD CONSTRAINT "Score_game_id_fkey"
FOREIGN KEY ("game_id") REFERENCES "Minigame"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
