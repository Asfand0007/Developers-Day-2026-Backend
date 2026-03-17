-- AlterEnum
ALTER TYPE "RegistrationStatus" ADD VALUE 'FREE';

-- DropForeignKey
ALTER TABLE "TeamEmailsQueue" DROP CONSTRAINT "TeamEmailsQueue_teamMemberId_fkey";

-- AddForeignKey
ALTER TABLE "TeamEmailsQueue" ADD CONSTRAINT "TeamEmailsQueue_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
