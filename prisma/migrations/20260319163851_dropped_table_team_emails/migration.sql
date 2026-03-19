/*
  Warnings:

  - You are about to drop the `TeamEmails` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "TeamEmails" DROP CONSTRAINT "TeamEmails_teamId_fkey";

-- DropTable
DROP TABLE "TeamEmails";
