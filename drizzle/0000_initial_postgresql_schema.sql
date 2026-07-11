CREATE SEQUENCE "public"."item_improvement_fact_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "aaci_records" (
	"id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "aaci_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ingested_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"poi_version" text,
	"available" integer[] DEFAULT '{}',
	"triggered" integer,
	"items" integer[] DEFAULT '{}',
	"improvement" integer[] DEFAULT '{}',
	"raw_luck" integer,
	"raw_taiku" integer,
	"lv" integer,
	"hp_percent" double precision,
	"pos" integer,
	"origin" text,
	CONSTRAINT "aaci_records_ingested_at_id_pk" PRIMARY KEY("ingested_at","id")
) PARTITION BY RANGE ("ingested_at");
--> statement-breakpoint
CREATE TABLE "aaci_records_default" PARTITION OF "aaci_records" DEFAULT;
--> statement-breakpoint
CREATE TABLE "battle_apis" (
	"id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "battle_apis_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ingested_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"origin" text,
	"path" text,
	"data" jsonb,
	CONSTRAINT "battle_apis_ingested_at_id_pk" PRIMARY KEY("ingested_at","id")
) PARTITION BY RANGE ("ingested_at");
--> statement-breakpoint
CREATE TABLE "battle_apis_default" PARTITION OF "battle_apis" DEFAULT;
--> statement-breakpoint
CREATE TABLE "create_item_records" (
	"id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "create_item_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ingested_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"items" integer[] DEFAULT '{}',
	"secretary" integer,
	"item_id" integer,
	"teitoku_lv" integer,
	"successful" boolean,
	"origin" text,
	CONSTRAINT "create_item_records_ingested_at_id_pk" PRIMARY KEY("ingested_at","id")
) PARTITION BY RANGE ("ingested_at");
--> statement-breakpoint
CREATE TABLE "create_item_records_default" PARTITION OF "create_item_records" DEFAULT;
--> statement-breakpoint
CREATE TABLE "create_ship_records" (
	"id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "create_ship_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ingested_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"items" integer[] DEFAULT '{}',
	"kdock_id" integer,
	"secretary" integer,
	"ship_id" integer,
	"highspeed" integer,
	"teitoku_lv" integer,
	"large_flag" boolean,
	"origin" text,
	CONSTRAINT "create_ship_records_ingested_at_id_pk" PRIMARY KEY("ingested_at","id")
) PARTITION BY RANGE ("ingested_at");
--> statement-breakpoint
CREATE TABLE "create_ship_records_default" PARTITION OF "create_ship_records" DEFAULT;
--> statement-breakpoint
CREATE TABLE "data_dump_files" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "data_dump_files_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"dump_run_id" bigint NOT NULL,
	"dataset" text NOT NULL,
	"partition_name" text NOT NULL,
	"object_key" text NOT NULL,
	"row_count" bigint NOT NULL,
	"compressed_bytes" bigint NOT NULL,
	"sha256" "bytea" NOT NULL,
	"verified_at" timestamp with time zone,
	CONSTRAINT "data_dump_files_dump_run_dataset_key" UNIQUE("dump_run_id","dataset"),
	CONSTRAINT "data_dump_files_dataset_check" CHECK ("data_dump_files"."dataset" in ('createShipObservations', 'createItemObservations', 'remodelItemObservations', 'dropShipObservations', 'passEventObservations', 'battleApiObservations', 'nightContactObservations', 'aaciObservations', 'nightBattleCiObservations')),
	CONSTRAINT "data_dump_files_row_count_nonnegative" CHECK ("data_dump_files"."row_count" >= 0),
	CONSTRAINT "data_dump_files_compressed_bytes_nonnegative" CHECK ("data_dump_files"."compressed_bytes" >= 0),
	CONSTRAINT "data_dump_files_sha256_length" CHECK (octet_length("data_dump_files"."sha256") = 32)
);
--> statement-breakpoint
CREATE TABLE "data_dump_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "data_dump_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"epoch_id" uuid NOT NULL,
	"dump_month" date NOT NULL,
	"schema_version" integer NOT NULL,
	"status" text NOT NULL,
	"manifest_object_key" text,
	"manifest_bytes" bigint,
	"manifest_sha256" "bytea",
	"published_at" timestamp with time zone,
	"cleanup_eligible_at" timestamp with time zone,
	"cleaned_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "data_dump_runs_epoch_month_version_key" UNIQUE("epoch_id","dump_month","schema_version"),
	CONSTRAINT "data_dump_runs_status_check" CHECK ("data_dump_runs"."status" in ('pending', 'exporting', 'uploaded', 'published', 'cleanup_eligible', 'cleaned', 'failed')),
	CONSTRAINT "data_dump_runs_manifest_bytes_nonnegative" CHECK ("data_dump_runs"."manifest_bytes" is null or "data_dump_runs"."manifest_bytes" >= 0),
	CONSTRAINT "data_dump_runs_manifest_sha256_length" CHECK ("data_dump_runs"."manifest_sha256" is null or octet_length("data_dump_runs"."manifest_sha256") = 32),
	CONSTRAINT "data_dump_runs_cleanup_eligible_at_offset" CHECK ("data_dump_runs"."cleanup_eligible_at" is null or "data_dump_runs"."published_at" is null or "data_dump_runs"."cleanup_eligible_at" = "data_dump_runs"."published_at" + interval '7 days')
);
--> statement-breakpoint
CREATE TABLE "data_epochs" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "data_epochs_id_unique" UNIQUE("id"),
	CONSTRAINT "data_epochs_singleton_true" CHECK ("data_epochs"."singleton" = true)
);
--> statement-breakpoint
CREATE TABLE "drop_ship_records" (
	"id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "drop_ship_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ingested_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"ship_id" integer,
	"item_id" integer,
	"map_id" integer,
	"quest" text,
	"cell_id" integer,
	"enemy" text,
	"rank" text,
	"is_boss" boolean,
	"teitoku_lv" integer,
	"map_lv" integer,
	"enemy_ships1" integer[] DEFAULT '{}',
	"enemy_ships2" integer[] DEFAULT '{}',
	"enemy_formation" integer,
	"base_exp" integer,
	"teitoku_id" text,
	"owned_ship_snapshot" jsonb,
	"origin" text,
	CONSTRAINT "drop_ship_records_ingested_at_id_pk" PRIMARY KEY("ingested_at","id")
) PARTITION BY RANGE ("ingested_at");
--> statement-breakpoint
CREATE TABLE "drop_ship_records_default" PARTITION OF "drop_ship_records" DEFAULT;
--> statement-breakpoint
CREATE TABLE "enemy_infos" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "enemy_infos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"identity_hash" "bytea" NOT NULL,
	"ships1" integer[] NOT NULL,
	"levels1" integer[] NOT NULL,
	"hp1" integer[] NOT NULL,
	"ships2" integer[] NOT NULL,
	"levels2" integer[] NOT NULL,
	"hp2" integer[] NOT NULL,
	"stats1" jsonb NOT NULL,
	"equips1" jsonb NOT NULL,
	"stats2" jsonb NOT NULL,
	"equips2" jsonb NOT NULL,
	"planes" integer NOT NULL,
	"bombers_min" integer,
	"bombers_max" integer,
	"count" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "enemy_infos_identity_hash_unique" UNIQUE("identity_hash"),
	CONSTRAINT "enemy_infos_identity_hash_length" CHECK (octet_length("enemy_infos"."identity_hash") = 32)
);
--> statement-breakpoint
CREATE TABLE "item_improvement_availability_facts" (
	"id" bigint PRIMARY KEY DEFAULT nextval('item_improvement_fact_id_seq') NOT NULL,
	"export_id" text GENERATED ALWAYS AS (lpad(to_hex(id), 24, '0')) STORED NOT NULL,
	"key" text NOT NULL,
	"schema_version" integer NOT NULL,
	"recipe_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"day" integer NOT NULL,
	"first_client_observed_at" bigint NOT NULL,
	"last_client_observed_at" bigint NOT NULL,
	"observed_second_ship_id" integer NOT NULL,
	"observed_flagship_ids" integer[] DEFAULT '{}' NOT NULL,
	"sources" text[] DEFAULT '{}' NOT NULL,
	"origins" text[] DEFAULT '{}' NOT NULL,
	"first_reported" bigint NOT NULL,
	"last_reported" bigint NOT NULL,
	"count" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "item_improvement_availability_facts_export_id_unique" UNIQUE("export_id"),
	CONSTRAINT "item_improvement_availability_facts_key_unique" UNIQUE("key"),
	CONSTRAINT "item_improvement_availability_facts_export_id_format" CHECK ("item_improvement_availability_facts"."export_id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "item_improvement_cost_facts" (
	"id" bigint PRIMARY KEY DEFAULT nextval('item_improvement_fact_id_seq') NOT NULL,
	"export_id" text GENERATED ALWAYS AS (lpad(to_hex(id), 24, '0')) STORED NOT NULL,
	"key" text NOT NULL,
	"schema_version" integer NOT NULL,
	"recipe_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"day" integer NOT NULL,
	"first_client_observed_at" bigint NOT NULL,
	"last_client_observed_at" bigint NOT NULL,
	"observed_second_ship_id" integer NOT NULL,
	"observed_flagship_ids" integer[] DEFAULT '{}' NOT NULL,
	"sources" text[] DEFAULT '{}' NOT NULL,
	"origins" text[] DEFAULT '{}' NOT NULL,
	"first_reported" bigint NOT NULL,
	"last_reported" bigint NOT NULL,
	"count" bigint DEFAULT 1 NOT NULL,
	"item_level" integer NOT NULL,
	"stage" integer NOT NULL,
	"fuel" integer NOT NULL,
	"ammo" integer NOT NULL,
	"steel" integer NOT NULL,
	"bauxite" integer NOT NULL,
	"buildkit" integer NOT NULL,
	"remodelkit" integer NOT NULL,
	"certain_buildkit" integer NOT NULL,
	"certain_remodelkit" integer NOT NULL,
	"req_slot_items" jsonb NOT NULL,
	"req_use_items" jsonb NOT NULL,
	"change_flag" integer NOT NULL,
	CONSTRAINT "item_improvement_cost_facts_export_id_unique" UNIQUE("export_id"),
	CONSTRAINT "item_improvement_cost_facts_key_unique" UNIQUE("key"),
	CONSTRAINT "item_improvement_cost_facts_export_id_format" CHECK ("item_improvement_cost_facts"."export_id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "item_improvement_update_facts" (
	"id" bigint PRIMARY KEY DEFAULT nextval('item_improvement_fact_id_seq') NOT NULL,
	"export_id" text GENERATED ALWAYS AS (lpad(to_hex(id), 24, '0')) STORED NOT NULL,
	"key" text NOT NULL,
	"schema_version" integer NOT NULL,
	"recipe_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"day" integer NOT NULL,
	"first_client_observed_at" bigint NOT NULL,
	"last_client_observed_at" bigint NOT NULL,
	"observed_second_ship_id" integer NOT NULL,
	"observed_flagship_ids" integer[] DEFAULT '{}' NOT NULL,
	"sources" text[] DEFAULT '{}' NOT NULL,
	"origins" text[] DEFAULT '{}' NOT NULL,
	"first_reported" bigint NOT NULL,
	"last_reported" bigint NOT NULL,
	"count" bigint DEFAULT 1 NOT NULL,
	"item_level" integer NOT NULL,
	"upgrade_to_item_id" integer NOT NULL,
	"upgrade_to_item_level" integer NOT NULL,
	"upgrade_observed" boolean DEFAULT true NOT NULL,
	CONSTRAINT "item_improvement_update_facts_export_id_unique" UNIQUE("export_id"),
	CONSTRAINT "item_improvement_update_facts_key_unique" UNIQUE("key"),
	CONSTRAINT "item_improvement_update_facts_export_id_format" CHECK ("item_improvement_update_facts"."export_id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "night_battle_cis" (
	"id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "night_battle_cis_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ingested_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"ship_id" integer,
	"ci" text,
	"type" text,
	"lv" integer,
	"raw_luck" integer,
	"pos" integer,
	"status" text,
	"items" integer[] DEFAULT '{}',
	"improvement" integer[] DEFAULT '{}',
	"search_light" boolean,
	"flare" integer,
	"defense_id" integer,
	"defense_type_id" integer,
	"ci_type" integer,
	"display" integer[] DEFAULT '{}',
	"hit_type" integer[] DEFAULT '{}',
	"damage" double precision[] DEFAULT '{}',
	"damage_total" double precision,
	"time" bigint,
	"origin" text,
	CONSTRAINT "night_battle_cis_ingested_at_id_pk" PRIMARY KEY("ingested_at","id")
) PARTITION BY RANGE ("ingested_at");
--> statement-breakpoint
CREATE TABLE "night_battle_cis_default" PARTITION OF "night_battle_cis" DEFAULT;
--> statement-breakpoint
CREATE TABLE "night_contacts" (
	"id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "night_contacts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ingested_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"fleet_type" integer,
	"ship_id" integer,
	"ship_lv" integer,
	"item_id" integer,
	"item_lv" integer,
	"contact" boolean,
	CONSTRAINT "night_contacts_ingested_at_id_pk" PRIMARY KEY("ingested_at","id")
) PARTITION BY RANGE ("ingested_at");
--> statement-breakpoint
CREATE TABLE "night_contacts_default" PARTITION OF "night_contacts" DEFAULT;
--> statement-breakpoint
CREATE TABLE "pass_event_records" (
	"id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "pass_event_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ingested_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"teitoku_id" text,
	"teitoku_lv" integer,
	"map_id" integer,
	"map_lv" integer,
	"rewards" jsonb DEFAULT '[]'::jsonb,
	"origin" text,
	CONSTRAINT "pass_event_records_ingested_at_id_pk" PRIMARY KEY("ingested_at","id")
) PARTITION BY RANGE ("ingested_at");
--> statement-breakpoint
CREATE TABLE "pass_event_records_default" PARTITION OF "pass_event_records" DEFAULT;
--> statement-breakpoint
CREATE TABLE "quest_rewards" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "quest_rewards_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"key" text NOT NULL,
	"quest_id" integer NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"category" integer,
	"type" integer,
	"origin" text,
	"selections" integer[] NOT NULL,
	"material" integer[] DEFAULT '{}',
	"bonus" jsonb DEFAULT '[]'::jsonb,
	"bonus_count" integer NOT NULL,
	CONSTRAINT "quest_rewards_key_quest_id_selections_bonus_count_key" UNIQUE("key","quest_id","selections","bonus_count"),
	CONSTRAINT "quest_rewards_key_format" CHECK ("quest_rewards"."key" ~ '^[0-9a-f]{32}$')
);
--> statement-breakpoint
CREATE TABLE "quests" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "quests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"key" text NOT NULL,
	"quest_id" integer NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"category" integer NOT NULL,
	"type" integer,
	"origin" text,
	CONSTRAINT "quests_key_quest_id_category_key" UNIQUE("key","quest_id","category"),
	CONSTRAINT "quests_key_format" CHECK ("quests"."key" ~ '^[0-9a-f]{32}$')
);
--> statement-breakpoint
CREATE TABLE "recipe_records" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "recipe_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"recipe_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"stage" integer NOT NULL,
	"day" integer NOT NULL,
	"secretary" integer NOT NULL,
	"fuel" integer,
	"ammo" integer,
	"steel" integer,
	"bauxite" integer,
	"req_item_id" integer,
	"req_item_count" integer,
	"buildkit" integer,
	"remodelkit" integer,
	"certain_buildkit" integer,
	"certain_remodelkit" integer,
	"upgrade_to_item_id" integer,
	"upgrade_to_item_level" integer,
	"key" text,
	"origin" text,
	"last_reported" bigint NOT NULL,
	"count" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "recipe_records_identity_key" UNIQUE("recipe_id","item_id","stage","day","secretary")
);
--> statement-breakpoint
CREATE TABLE "remodel_item_records" (
	"id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "remodel_item_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ingested_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"successful" boolean,
	"item_id" integer,
	"item_level" integer,
	"flagship_id" integer,
	"flagship_level" integer,
	"flagship_cond" integer,
	"consort_id" integer,
	"consort_level" integer,
	"consort_cond" integer,
	"teitoku_lv" integer,
	"certain" boolean,
	CONSTRAINT "remodel_item_records_ingested_at_id_pk" PRIMARY KEY("ingested_at","id")
) PARTITION BY RANGE ("ingested_at");
--> statement-breakpoint
CREATE TABLE "remodel_item_records_default" PARTITION OF "remodel_item_records" DEFAULT;
--> statement-breakpoint
CREATE TABLE "schema_metadata" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "schema_metadata_singleton_true" CHECK ("schema_metadata"."singleton" = true)
);
--> statement-breakpoint
CREATE TABLE "select_rank_records" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "select_rank_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"teitoku_id" text NOT NULL,
	"maparea_id" integer NOT NULL,
	"teitoku_lv" integer,
	"rank" integer,
	"origin" text,
	CONSTRAINT "select_rank_records_teitoku_maparea_key" UNIQUE("teitoku_id","maparea_id")
);
--> statement-breakpoint
CREATE TABLE "ship_stats" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ship_stats_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ship_id" integer NOT NULL,
	"lv" integer NOT NULL,
	"los" integer NOT NULL,
	"los_max" integer NOT NULL,
	"asw" integer NOT NULL,
	"asw_max" integer NOT NULL,
	"evasion" integer NOT NULL,
	"evasion_max" integer NOT NULL,
	"last_timestamp" bigint NOT NULL,
	"count" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "ship_stats_identity_key" UNIQUE("ship_id","lv","los","los_max","asw","asw_max","evasion","evasion_max")
);
--> statement-breakpoint
ALTER TABLE "data_dump_files" ADD CONSTRAINT "data_dump_files_dump_run_id_data_dump_runs_id_fk" FOREIGN KEY ("dump_run_id") REFERENCES "public"."data_dump_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_dump_runs" ADD CONSTRAINT "data_dump_runs_epoch_id_data_epochs_id_fk" FOREIGN KEY ("epoch_id") REFERENCES "public"."data_epochs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_improvement_availability_facts_last_reported_export_id_idx" ON "item_improvement_availability_facts" USING btree ("last_reported","export_id");--> statement-breakpoint
CREATE INDEX "item_improvement_availability_facts_lookup_idx" ON "item_improvement_availability_facts" USING btree ("item_id","observed_second_ship_id","day");--> statement-breakpoint
CREATE INDEX "item_improvement_availability_facts_recipe_id_idx" ON "item_improvement_availability_facts" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "item_improvement_cost_facts_last_reported_export_id_idx" ON "item_improvement_cost_facts" USING btree ("last_reported","export_id");--> statement-breakpoint
CREATE INDEX "item_improvement_cost_facts_lookup_idx" ON "item_improvement_cost_facts" USING btree ("item_id","observed_second_ship_id","day","item_level");--> statement-breakpoint
CREATE INDEX "item_improvement_cost_facts_recipe_id_idx" ON "item_improvement_cost_facts" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "item_improvement_update_facts_last_reported_export_id_idx" ON "item_improvement_update_facts" USING btree ("last_reported","export_id");--> statement-breakpoint
CREATE INDEX "item_improvement_update_facts_lookup_idx" ON "item_improvement_update_facts" USING btree ("item_id","observed_second_ship_id","day","item_level");--> statement-breakpoint
CREATE INDEX "item_improvement_update_facts_recipe_id_idx" ON "item_improvement_update_facts" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "item_improvement_update_facts_upgrade_to_item_id_idx" ON "item_improvement_update_facts" USING btree ("upgrade_to_item_id");
--> statement-breakpoint
INSERT INTO "schema_metadata" ("singleton", "version") VALUES (true, 1);