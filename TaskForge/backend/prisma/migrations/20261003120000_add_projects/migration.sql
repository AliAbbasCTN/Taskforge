-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('LEAD', 'MEMBER');

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(2000),
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_memberships" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "ProjectRole" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "projects_organization_id_status_idx" ON "projects"("organization_id", "status");

-- CreateIndex
CREATE INDEX "project_memberships_project_id_idx" ON "project_memberships"("project_id");

-- CreateIndex
CREATE INDEX "project_memberships_user_id_idx" ON "project_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_memberships_user_id_project_id_key" ON "project_memberships"("user_id", "project_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
