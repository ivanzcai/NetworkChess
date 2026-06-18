-- ============================================================================
-- Bootstrap migration: email + OAuth + magic-link authentication
--
-- This is a destructive-by-design migration that DROPs and re-CREATEs the
-- four pre-existing tables (`User`, `Token`, `Game`, `MatchHistory`) that
-- were created by two since-deleted migrations
--   - `20260611083520_init`
--   - `20260617082049_add_chat_and_usernames`
-- Those migrations were applied to the prod Cloud SQL instance on
-- earlier deploys, so the old schema is already there. It used a
-- username-and-password identity model (`User.username` was the FK
-- identity referenced by `Token`, `Game`, and `MatchHistory`); THIS
-- migration moves to an email + OAuth + magic-link model where those
-- four tables FK back to `User.id` instead of `User.username` and adds
-- `OAuthAccount` / `MagicCode` as new sign-in methods.
--
-- Surgically patching the old tables (renaming columns, swapping FK
-- targets, backfilling `User.email` for existing rows) would require a
-- row-by-row data pipeline. For this service the prior rows were
-- `Guest_…` test accounts and any users created under the previous
-- schema, which can re-sign-up under the new flow. If your prod has
-- rows you MUST keep, take a Cloud SQL export FIRST and write a
-- side-by-side data migration before merging this.
--
-- Each DROP uses CASCADE so dependent foreign-key constraints drop with
-- the table; we then recreate them via plain `ALTER TABLE ... ADD
-- CONSTRAINT` (no DO-$$ try/catch wrappers needed -- the FKs don't
-- exist after the CASCADE).
-- ============================================================================

-- Drop pre-existing tables (dependents first; User last). CASCADE removes
-- dependent FK constraints automatically.
DROP TABLE IF EXISTS "MatchHistory" CASCADE;
DROP TABLE IF EXISTS "Token"      CASCADE;
DROP TABLE IF EXISTS "Game"       CASCADE;
DROP TABLE IF EXISTS "User"       CASCADE;

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "isGuest" BOOLEAN NOT NULL DEFAULT false,
    "elo" INTEGER NOT NULL DEFAULT 1200,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthAccount" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MagicCode" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MagicCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Token" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "stateJson" TEXT NOT NULL,
    "statusJson" TEXT NOT NULL,
    "positionHistory" TEXT NOT NULL,
    "gameType" TEXT NOT NULL,
    "playerColor" TEXT NOT NULL,
    "aiColor" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "playerCount" INTEGER NOT NULL DEFAULT 1,
    "chatJson" TEXT NOT NULL DEFAULT '[]',
    "whiteUsername" TEXT,
    "blackUsername" TEXT,
    "whiteUserId" TEXT,
    "blackUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "opponent" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "OAuthAccount_userId_idx" ON "OAuthAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAccount_provider_subjectId_key" ON "OAuthAccount"("provider", "subjectId");

-- CreateIndex
CREATE INDEX "MagicCode_email_idx" ON "MagicCode"("email");

-- CreateIndex
CREATE INDEX "MagicCode_expiresAt_idx" ON "MagicCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Token_token_key" ON "Token"("token");

-- CreateIndex
CREATE INDEX "Token_userId_idx" ON "Token"("userId");

-- CreateIndex
CREATE INDEX "Game_whiteUserId_idx" ON "Game"("whiteUserId");

-- CreateIndex
CREATE INDEX "Game_blackUserId_idx" ON "Game"("blackUserId");

-- CreateIndex
CREATE INDEX "MatchHistory_userId_idx" ON "MatchHistory"("userId");

-- AddForeignKey
ALTER TABLE "OAuthAccount" ADD CONSTRAINT "OAuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_whiteUserId_fkey" FOREIGN KEY ("whiteUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_blackUserId_fkey" FOREIGN KEY ("blackUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchHistory" ADD CONSTRAINT "MatchHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
