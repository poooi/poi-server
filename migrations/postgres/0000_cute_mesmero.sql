CREATE TABLE "aaci_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"poi_version" text NOT NULL,
	"available" integer[] NOT NULL,
	"triggered" integer NOT NULL,
	"items" integer[] NOT NULL,
	"improvement" integer[] NOT NULL,
	"raw_luck" integer NOT NULL,
	"raw_taiku" integer NOT NULL,
	"lv" integer NOT NULL,
	"hp_percent" integer NOT NULL,
	"pos" integer NOT NULL,
	"origin" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "battle_apis" (
	"id" serial PRIMARY KEY NOT NULL,
	"origin" text NOT NULL,
	"path" text NOT NULL,
	"data" jsonb NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "create_item_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"items" integer[] NOT NULL,
	"secretary" integer NOT NULL,
	"item_id" integer NOT NULL,
	"teitoku_lv" integer NOT NULL,
	"successful" boolean NOT NULL,
	"origin" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "create_ship_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"items" integer[] NOT NULL,
	"kdock_id" integer NOT NULL,
	"secretary" integer NOT NULL,
	"ship_id" integer NOT NULL,
	"highspeed" integer NOT NULL,
	"teitoku_lv" integer NOT NULL,
	"large_flag" boolean NOT NULL,
	"origin" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drop_ship_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"ship_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"map_id" integer NOT NULL,
	"quest" text NOT NULL,
	"cell_id" integer NOT NULL,
	"enemy" text NOT NULL,
	"rank" text NOT NULL,
	"is_boss" boolean NOT NULL,
	"teitoku_lv" integer NOT NULL,
	"map_lv" integer NOT NULL,
	"enemy_ships1" integer[] NOT NULL,
	"enemy_ships2" integer[] NOT NULL,
	"enemy_formation" integer NOT NULL,
	"base_exp" integer NOT NULL,
	"teitoku_id" text NOT NULL,
	"owned_ship_snapshot" jsonb NOT NULL,
	"origin" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "night_battle_cis" (
	"id" serial PRIMARY KEY NOT NULL,
	"ship_id" integer NOT NULL,
	"ci" text NOT NULL,
	"type" text NOT NULL,
	"lv" integer NOT NULL,
	"raw_luck" integer NOT NULL,
	"pos" integer NOT NULL,
	"status" text NOT NULL,
	"items" integer[] NOT NULL,
	"improvement" integer[] NOT NULL,
	"search_light" boolean NOT NULL,
	"flare" integer NOT NULL,
	"defense_id" integer NOT NULL,
	"defense_type_id" integer NOT NULL,
	"ci_type" integer NOT NULL,
	"display" integer[] NOT NULL,
	"hit_type" integer[] NOT NULL,
	"damage" integer[] NOT NULL,
	"damage_total" integer NOT NULL,
	"time" bigint NOT NULL,
	"origin" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "night_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"fleet_type" integer NOT NULL,
	"ship_id" integer NOT NULL,
	"ship_lv" integer NOT NULL,
	"item_id" integer NOT NULL,
	"item_lv" integer NOT NULL,
	"contact" boolean NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pass_event_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"teitoku_id" text NOT NULL,
	"teitoku_lv" integer NOT NULL,
	"map_id" integer NOT NULL,
	"map_lv" integer NOT NULL,
	"rewards" jsonb NOT NULL,
	"origin" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "remodel_item_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"successful" boolean NOT NULL,
	"item_id" integer NOT NULL,
	"item_level" integer NOT NULL,
	"flagship_id" integer NOT NULL,
	"flagship_level" integer NOT NULL,
	"flagship_cond" integer NOT NULL,
	"consort_id" integer NOT NULL,
	"consort_level" integer NOT NULL,
	"consort_cond" integer NOT NULL,
	"teitoku_lv" integer NOT NULL,
	"certain" boolean NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enemy_infos" (
	"id" serial PRIMARY KEY NOT NULL,
	"canonical_hash" text NOT NULL,
	"ships1" jsonb NOT NULL,
	"levels1" jsonb NOT NULL,
	"hp1" jsonb NOT NULL,
	"stats1" jsonb NOT NULL,
	"equips1" jsonb NOT NULL,
	"ships2" jsonb NOT NULL,
	"levels2" jsonb NOT NULL,
	"hp2" jsonb NOT NULL,
	"stats2" jsonb NOT NULL,
	"equips2" jsonb NOT NULL,
	"planes" integer NOT NULL,
	"bombers_min" integer NOT NULL,
	"bombers_max" integer NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"raw_payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quest_rewards" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"quest_id" integer NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"category" integer NOT NULL,
	"type" integer NOT NULL,
	"origin" text,
	"selections" integer[] NOT NULL,
	"material" integer[] NOT NULL,
	"bonus" jsonb NOT NULL,
	"bonus_count" integer NOT NULL,
	"raw_payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quests" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"quest_id" integer NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"category" integer NOT NULL,
	"type" integer NOT NULL,
	"origin" text,
	"raw_payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipe_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"stage" integer NOT NULL,
	"day" integer NOT NULL,
	"secretary" integer NOT NULL,
	"fuel" integer NOT NULL,
	"ammo" integer NOT NULL,
	"steel" integer NOT NULL,
	"bauxite" integer NOT NULL,
	"req_item_id" integer NOT NULL,
	"req_item_count" integer NOT NULL,
	"buildkit" integer NOT NULL,
	"remodelkit" integer NOT NULL,
	"certain_buildkit" integer NOT NULL,
	"certain_remodelkit" integer NOT NULL,
	"upgrade_to_item_id" integer NOT NULL,
	"upgrade_to_item_level" integer NOT NULL,
	"last_reported" bigint NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"key" text,
	"origin" text,
	"raw_payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "select_rank_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"teitoku_id" text NOT NULL,
	"teitoku_lv" integer NOT NULL,
	"maparea_id" integer NOT NULL,
	"rank" integer NOT NULL,
	"origin" text NOT NULL,
	"raw_payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ship_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"ship_id" integer NOT NULL,
	"lv" integer NOT NULL,
	"los" integer NOT NULL,
	"los_max" integer NOT NULL,
	"asw" integer NOT NULL,
	"asw_max" integer NOT NULL,
	"evasion" integer NOT NULL,
	"evasion_max" integer NOT NULL,
	"last_timestamp" bigint NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"raw_payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_improvement_availability_facts" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"schema_version" integer NOT NULL,
	"recipe_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"day" integer NOT NULL,
	"first_client_observed_at" bigint NOT NULL,
	"last_client_observed_at" bigint NOT NULL,
	"observed_second_ship_id" integer NOT NULL,
	"observed_flagship_ids" integer[] NOT NULL,
	"sources" text[] NOT NULL,
	"origins" text[] NOT NULL,
	"first_reported" bigint NOT NULL,
	"last_reported" bigint NOT NULL,
	"count" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_improvement_cost_facts" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"schema_version" integer NOT NULL,
	"recipe_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"day" integer NOT NULL,
	"first_client_observed_at" bigint NOT NULL,
	"last_client_observed_at" bigint NOT NULL,
	"observed_second_ship_id" integer NOT NULL,
	"observed_flagship_ids" integer[] NOT NULL,
	"sources" text[] NOT NULL,
	"origins" text[] NOT NULL,
	"first_reported" bigint NOT NULL,
	"last_reported" bigint NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
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
	"change_flag" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_improvement_update_facts" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"schema_version" integer NOT NULL,
	"recipe_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"day" integer NOT NULL,
	"first_client_observed_at" bigint NOT NULL,
	"last_client_observed_at" bigint NOT NULL,
	"observed_second_ship_id" integer NOT NULL,
	"observed_flagship_ids" integer[] NOT NULL,
	"sources" text[] NOT NULL,
	"origins" text[] NOT NULL,
	"first_reported" bigint NOT NULL,
	"last_reported" bigint NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"item_level" integer NOT NULL,
	"upgrade_to_item_id" integer NOT NULL,
	"upgrade_to_item_level" integer NOT NULL,
	"upgrade_observed" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_dump_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"table_name" text NOT NULL,
	"dump_month" text NOT NULL,
	"row_count" bigint NOT NULL,
	"checksum" text NOT NULL,
	"output_location" text NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"cleaned_up_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "enemy_infos_canonical_hash_unique" ON "enemy_infos" USING btree ("canonical_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "quest_rewards_unique_key" ON "quest_rewards" USING btree ("key","quest_id","selections","bonus_count");--> statement-breakpoint
CREATE UNIQUE INDEX "quests_unique_key" ON "quests" USING btree ("key","quest_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_records_unique_key" ON "recipe_records" USING btree ("recipe_id","item_id","stage","day","secretary");--> statement-breakpoint
CREATE UNIQUE INDEX "select_rank_records_teitoku_maparea_unique" ON "select_rank_records" USING btree ("teitoku_id","maparea_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ship_stats_unique_key" ON "ship_stats" USING btree ("ship_id","lv","los","los_max","asw","asw_max","evasion","evasion_max");--> statement-breakpoint
CREATE UNIQUE INDEX "item_improvement_availability_facts_key_unique" ON "item_improvement_availability_facts" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "item_improvement_cost_facts_key_unique" ON "item_improvement_cost_facts" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "item_improvement_update_facts_key_unique" ON "item_improvement_update_facts" USING btree ("key");