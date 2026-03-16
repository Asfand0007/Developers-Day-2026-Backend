-- DropForeignKey
ALTER TABLE "CompetitionAttendance" DROP CONSTRAINT "CompetitionAttendance_teamId_fkey";

-- DropForeignKey
ALTER TABLE "TeamEmails" DROP CONSTRAINT "TeamEmails_teamId_fkey";

-- AddForeignKey
ALTER TABLE "CompetitionAttendance" ADD CONSTRAINT "CompetitionAttendance_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamEmails" ADD CONSTRAINT "TeamEmails_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
