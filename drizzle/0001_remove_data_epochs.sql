ALTER TABLE "data_dump_runs" DROP CONSTRAINT "data_dump_runs_epoch_id_data_epochs_id_fk";
--> statement-breakpoint
ALTER TABLE "data_dump_runs" DROP CONSTRAINT "data_dump_runs_epoch_month_version_key";--> statement-breakpoint
ALTER TABLE "data_dump_runs" DROP COLUMN "epoch_id";--> statement-breakpoint
DROP TABLE "data_epochs";--> statement-breakpoint
ALTER TABLE "data_dump_runs" ADD CONSTRAINT "data_dump_runs_month_version_key" UNIQUE("dump_month","schema_version");--> statement-breakpoint
UPDATE "schema_metadata" SET "version" = 2 WHERE "singleton" = true;