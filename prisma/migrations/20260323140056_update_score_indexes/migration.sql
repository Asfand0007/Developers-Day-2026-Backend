-- DropIndex
DROP INDEX "Score_game_id_score_play_time_idx";

-- CreateIndex
CREATE INDEX "Score_game_id_score_play_time_updated_at_idx" ON "Score"("game_id", "score" DESC, "play_time" ASC, "updated_at" DESC);

-- CreateIndex
CREATE INDEX "Score_game_id_updated_at_idx" ON "Score"("game_id", "updated_at" DESC);
