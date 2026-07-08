ALTER TABLE "item_improvement_availability_facts" ADD COLUMN "export_sequence" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "item_improvement_availability_facts" ADD COLUMN "export_id" char(24) GENERATED ALWAYS AS (lpad(to_hex("export_sequence"), 24, '0')) STORED;--> statement-breakpoint
ALTER TABLE "item_improvement_availability_facts" ADD COLUMN "raw_payload" jsonb;--> statement-breakpoint
ALTER TABLE "item_improvement_cost_facts" ADD COLUMN "export_sequence" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "item_improvement_cost_facts" ADD COLUMN "export_id" char(24) GENERATED ALWAYS AS (lpad(to_hex("export_sequence"), 24, '0')) STORED;--> statement-breakpoint
ALTER TABLE "item_improvement_cost_facts" ADD COLUMN "raw_payload" jsonb;--> statement-breakpoint
ALTER TABLE "item_improvement_update_facts" ADD COLUMN "export_sequence" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "item_improvement_update_facts" ADD COLUMN "export_id" char(24) GENERATED ALWAYS AS (lpad(to_hex("export_sequence"), 24, '0')) STORED;--> statement-breakpoint
ALTER TABLE "item_improvement_update_facts" ADD COLUMN "raw_payload" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "item_improvement_availability_facts_export_id_unique" ON "item_improvement_availability_facts" USING btree ("export_id");--> statement-breakpoint
CREATE INDEX "item_improvement_availability_facts_export_cursor_idx" ON "item_improvement_availability_facts" USING btree ("last_reported","export_id");--> statement-breakpoint
CREATE INDEX "item_improvement_availability_facts_lookup_idx" ON "item_improvement_availability_facts" USING btree ("item_id","observed_second_ship_id","day");--> statement-breakpoint
CREATE INDEX "item_improvement_availability_facts_recipe_id_idx" ON "item_improvement_availability_facts" USING btree ("recipe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_improvement_cost_facts_export_id_unique" ON "item_improvement_cost_facts" USING btree ("export_id");--> statement-breakpoint
CREATE INDEX "item_improvement_cost_facts_export_cursor_idx" ON "item_improvement_cost_facts" USING btree ("last_reported","export_id");--> statement-breakpoint
CREATE INDEX "item_improvement_cost_facts_lookup_idx" ON "item_improvement_cost_facts" USING btree ("item_id","observed_second_ship_id","day","item_level");--> statement-breakpoint
CREATE INDEX "item_improvement_cost_facts_recipe_id_idx" ON "item_improvement_cost_facts" USING btree ("recipe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_improvement_update_facts_export_id_unique" ON "item_improvement_update_facts" USING btree ("export_id");--> statement-breakpoint
CREATE INDEX "item_improvement_update_facts_export_cursor_idx" ON "item_improvement_update_facts" USING btree ("last_reported","export_id");--> statement-breakpoint
CREATE INDEX "item_improvement_update_facts_lookup_idx" ON "item_improvement_update_facts" USING btree ("item_id","observed_second_ship_id","day","item_level");--> statement-breakpoint
CREATE INDEX "item_improvement_update_facts_recipe_id_idx" ON "item_improvement_update_facts" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "item_improvement_update_facts_upgrade_to_item_id_idx" ON "item_improvement_update_facts" USING btree ("upgrade_to_item_id");