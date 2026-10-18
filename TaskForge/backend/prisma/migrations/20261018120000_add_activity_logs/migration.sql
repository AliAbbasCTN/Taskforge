-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID,
    "task_id" UUID,
    "actor_id" UUID,
    "actor_name" VARCHAR(150),
    "action" VARCHAR(50) NOT NULL,
    "target_type" VARCHAR(30) NOT NULL,
    "target_id" UUID,
    "target_name" VARCHAR(255),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_logs_organization_id_created_at_idx" ON "activity_logs"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "activity_logs_project_id_created_at_idx" ON "activity_logs"("project_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "activity_logs_task_id_created_at_idx" ON "activity_logs"("task_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "activity_logs_actor_id_idx" ON "activity_logs"("actor_id");

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Append-only enforcement.
--
-- An audit trail is only trustworthy if entries cannot be edited. The
-- application has no code path that updates them, but a bug or a person with
-- database access could; this trigger makes the DATABASE refuse.
--
-- The single permitted change is the one PostgreSQL itself performs when a user
-- account is deleted (the `ON DELETE SET NULL` foreign key above clears
-- actor_id): actor_id may go from a value to NULL while every other column stays
-- identical. (`actor_name` keeps the entry attributable.) Row deletes are not
-- blocked, because deleting an organization legitimately cascades to its
-- history. Triggers and functions are invisible to Prisma's schema diffing.
CREATE FUNCTION "activity_logs_block_update"() RETURNS trigger AS $$
BEGIN
  IF OLD."actor_id" IS NOT NULL
     AND NEW."actor_id" IS NULL
     AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'activity_logs rows are append-only and cannot be modified';
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "activity_logs_no_update"
BEFORE UPDATE ON "activity_logs"
FOR EACH ROW EXECUTE FUNCTION "activity_logs_block_update"();
