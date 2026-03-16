-- AlterEnum
ALTER TYPE "RegistrationStatus" ADD VALUE 'ONHOLD';

-- DropForeignKey
ALTER TABLE "TeamEmails" DROP CONSTRAINT "TeamEmails_teamId_fkey";

-- CreateTable
CREATE TABLE "TeamEmailsQueue" (
    "id" TEXT NOT NULL,
    "teamMemberId" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "failedReason" TEXT,
    "sendWelcome" BOOLEAN NOT NULL DEFAULT true,
    "sendRejection" BOOLEAN NOT NULL DEFAULT false,
    "sendAccept" BOOLEAN NOT NULL DEFAULT false,
    "sendOnHold" BOOLEAN NOT NULL DEFAULT false,
    "noteOnHold" TEXT,
    "noteRejection" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamEmailsQueue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamEmailsQueue_teamMemberId_key" ON "TeamEmailsQueue"("teamMemberId");

-- AddForeignKey
ALTER TABLE "TeamEmails" ADD CONSTRAINT "TeamEmails_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamEmailsQueue" ADD CONSTRAINT "TeamEmailsQueue_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
