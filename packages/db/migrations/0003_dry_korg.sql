CREATE TYPE "public"."keeper_run_kind" AS ENUM('protect', 'grow', 'leave', 'check');--> statement-breakpoint
ALTER TABLE "keeper_runs" ALTER COLUMN "kind" SET DATA TYPE "public"."keeper_run_kind" USING "kind"::text::"public"."keeper_run_kind";--> statement-breakpoint
ALTER TABLE "keeper_runs" ADD COLUMN "keeper_address" text;