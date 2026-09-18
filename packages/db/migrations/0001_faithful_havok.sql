ALTER TYPE "public"."position_status" ADD VALUE 'abandoned';--> statement-breakpoint
CREATE TABLE "transaction_builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"position_id" uuid,
	"kind" text NOT NULL,
	"messages" jsonb NOT NULL,
	"signatures" jsonb,
	"blockhash_expires_at_slot" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "transaction_builds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transaction_builds" ADD CONSTRAINT "transaction_builds_wallet_address_wallets_address_fk" FOREIGN KEY ("wallet_address") REFERENCES "public"."wallets"("address") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_builds" ADD CONSTRAINT "transaction_builds_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transaction_builds_wallet_created_index" ON "transaction_builds" USING btree ("wallet_address","created_at");