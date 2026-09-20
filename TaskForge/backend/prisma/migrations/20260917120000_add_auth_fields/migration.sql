-- AlterTable
-- password_hash is added as NOT NULL. Since this table may already contain
-- rows from local development/testing (created before authentication
-- existed), applying this migration against a non-empty "users" table will
-- fail unless those rows are removed first. In development, run
-- `prisma migrate reset` to apply all migrations against a clean database.
ALTER TABLE "users" ADD COLUMN "password_hash" VARCHAR(255) NOT NULL,
ADD COLUMN "hashed_refresh_token" VARCHAR(255);
