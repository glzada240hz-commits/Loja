DROP INDEX "orders_day_number";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "green_sauce" boolean;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_day_delivery_number" ON "orders" USING btree ("business_day_id","delivery_number");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_day_number" ON "orders" USING btree ("business_day_id","number") WHERE type <> 'delivery';