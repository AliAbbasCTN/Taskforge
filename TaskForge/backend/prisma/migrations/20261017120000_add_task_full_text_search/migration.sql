-- Full-text search for tasks (Phase 14).
--
-- WHY a trigger-maintained column rather than a GENERATED column or an
-- expression index: Prisma's schema cannot describe either, so `prisma migrate
-- dev` would see them as drift and try to drop them. A plain nullable tsvector
-- column plus a trigger is invisible to Prisma's diffing (it does not track
-- triggers or functions), so future migrations stay clean.

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN "search_vector" tsvector;

-- Builds the search document: title counts more than description (weights A > B).
-- 'english' applies English stemming and stop-words ("running" matches "run").
CREATE FUNCTION "tasks_search_vector_update"() RETURNS trigger AS $$
BEGIN
  NEW."search_vector" :=
    setweight(to_tsvector('english', coalesce(NEW."title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW."description", '')), 'B');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- Runs on every insert, and on updates that touch title or description (so
-- moving a task between columns does not pay for re-indexing).
CREATE TRIGGER "tasks_search_vector_trigger"
BEFORE INSERT OR UPDATE OF "title", "description" ON "tasks"
FOR EACH ROW EXECUTE FUNCTION "tasks_search_vector_update"();

-- Backfill existing rows. Naming a column in SET fires the trigger even though
-- the value is unchanged.
UPDATE "tasks" SET "title" = "title";

-- CreateIndex
CREATE INDEX "tasks_search_vector_idx" ON "tasks" USING GIN ("search_vector");
