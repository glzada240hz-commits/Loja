ALTER TABLE "business_days" ADD COLUMN "last_delivery_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_number" integer;--> statement-breakpoint
UPDATE "orders" o SET "delivery_number" = x.n FROM (SELECT "id", row_number() OVER (PARTITION BY "business_day_id" ORDER BY "created_at", "number") AS n FROM "orders" WHERE "type" = 'delivery' AND "status" <> 'pending') x WHERE o."id" = x."id";--> statement-breakpoint
UPDATE "business_days" b SET "last_delivery_number" = COALESCE((SELECT max("delivery_number") FROM "orders" WHERE "business_day_id" = b."id"), 0);
