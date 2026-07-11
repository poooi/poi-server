DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "data_dump_runs"
    GROUP BY "dump_month"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce one canonical data_dump_runs row per dump_month while duplicate months exist';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "data_dump_runs" DROP CONSTRAINT "data_dump_runs_month_version_key";--> statement-breakpoint
ALTER TABLE "data_dump_runs" ADD CONSTRAINT "data_dump_runs_month_key" UNIQUE("dump_month");--> statement-breakpoint
UPDATE "schema_metadata" SET "version" = 3 WHERE "singleton" = true;