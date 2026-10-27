ALTER TYPE "public"."role" ADD VALUE 'waiter';--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ADD COLUMN "served_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ADD COLUMN "served_by" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tab_kind" text DEFAULT 'table' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "bill_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "bill_requested_by" uuid;--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_served_by_users_id_fk" FOREIGN KEY ("served_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_bill_requested_by_users_id_fk" FOREIGN KEY ("bill_requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_open_place" ON "orders" USING btree ("business_day_id","tab_kind","table_label") WHERE table_label is not null and status in ('open', 'pending');