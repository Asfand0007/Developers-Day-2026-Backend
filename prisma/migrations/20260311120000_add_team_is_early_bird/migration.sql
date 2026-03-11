-- Add isEarlyBird flag on Team registrations

ALTER TABLE "Team" ADD COLUMN     "isEarlyBird" BOOLEAN NOT NULL DEFAULT false;
