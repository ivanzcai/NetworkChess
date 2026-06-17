-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "blackUsername" TEXT,
ADD COLUMN     "chatJson" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "whiteUsername" TEXT;
