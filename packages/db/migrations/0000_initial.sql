CREATE TYPE "public"."audit_action" AS ENUM('sign_in', 'terms_accepted', 'build_refused_terms', 'risk_acknowledged', 'build_refused_acknowledgement', 'build_refused_cap', 'build_refused_liquidity', 'build_refused_strategy', 'ltv_override_accepted', 'position_opened', 'position_closed', 'protect_by_owner', 'kill_switch_hit');--> statement-breakpoint
CREATE TYPE "public"."guard_event_kind" AS ENUM('protect', 'grow', 'leave');--> statement-breakpoint
CREATE TYPE "public"."keeper_outcome" AS ENUM('landed', 'reverted', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."position_health" AS ENUM('healthy', 'caution', 'danger');--> statement-breakpoint
CREATE TYPE "public"."position_status" AS ENUM('building', 'submitted', 'open', 'unwinding', 'closed', 'liquidated', 'left', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."transaction_kind" AS ENUM('open', 'open_without_swap', 'open_swap', 'unwind', 'repay', 'withdraw', 'add_collateral', 'set_strategy', 'protect_by_owner', 'rescue');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('submitted', 'confirmed', 'failed');--> statement-breakpoint
CREATE TABLE "wallets" (
	"address" text PRIMARY KEY NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"terms_version" integer,
	"terms_accepted_at" timestamp with time zone,
	"risk_acknowledgement_version" integer,
	"risk_acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "wallets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "auth_nonces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent_hash" text
);
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"status" "position_status" NOT NULL,
	"position_address" text,
	"market_address" text NOT NULL,
	"obligation_address" text,
	"target_ltv_bps" integer NOT NULL,
	"protect_ltv_bps" integer NOT NULL,
	"grow_below_ltv_bps" integer NOT NULL,
	"grow_enabled" boolean NOT NULL,
	"exit_on_flag_enabled" boolean NOT NULL,
	"fee_bps_at_open" integer NOT NULL,
	"collateral_mint" text NOT NULL,
	"collateral_decimals" integer NOT NULL,
	"collateral_amount_raw" numeric(40, 0) NOT NULL,
	"collateral_multiplier_at_open" numeric(20, 6) NOT NULL,
	"collateral_price_at_open" numeric(20, 6) NOT NULL,
	"borrow_mint" text NOT NULL,
	"borrow_amount_raw" numeric(40, 0) NOT NULL,
	"borrow_apy_at_open" numeric(20, 6) NOT NULL,
	"destination_mint" text NOT NULL,
	"destination_amount_raw" numeric(40, 0),
	"destination_apy_at_open" numeric(20, 6) NOT NULL,
	"ltv_at_open" numeric(20, 6) NOT NULL,
	"max_ltv_at_open" numeric(20, 6) NOT NULL,
	"liquidation_threshold_at_open" numeric(20, 6) NOT NULL,
	"liquidation_price_at_open" numeric(20, 6) NOT NULL,
	"ltv_override_accepted" boolean DEFAULT false NOT NULL,
	"blockhash_expires_at" timestamp with time zone,
	"open_signatures" jsonb,
	"close_signatures" jsonb,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "positions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "position_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" uuid NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"collateral_value_usd" numeric(20, 6) NOT NULL,
	"debt_usd" numeric(20, 6) NOT NULL,
	"ltv" numeric(20, 6) NOT NULL,
	"health" "position_health" NOT NULL,
	"above_protect" boolean NOT NULL,
	"destination_value_usd" numeric(20, 6) NOT NULL,
	"net_earned_usd" numeric(20, 6) NOT NULL,
	"borrow_apy" numeric(20, 6) NOT NULL,
	"destination_apy" numeric(20, 6) NOT NULL,
	"scope_price_age_slots" bigint
);
--> statement-breakpoint
ALTER TABLE "position_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guard_events" (
	"signature" text PRIMARY KEY NOT NULL,
	"position_id" uuid,
	"position_address" text NOT NULL,
	"kind" "guard_event_kind" NOT NULL,
	"caller_address" text NOT NULL,
	"ltv_before_bps" integer,
	"ltv_after_bps" integer,
	"usdc_amount_raw" numeric(40, 0),
	"destination_amount_raw" numeric(40, 0),
	"bounty_raw" numeric(40, 0),
	"slot" bigint NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guard_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "keeper_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"position_address" text NOT NULL,
	"kind" "guard_event_kind" NOT NULL,
	"outcome" "keeper_outcome" NOT NULL,
	"signature" text,
	"reason" text,
	"duration_ms" integer
);
--> statement-breakpoint
ALTER TABLE "keeper_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "transactions" (
	"signature" text PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"position_id" uuid,
	"kind" "transaction_kind" NOT NULL,
	"status" "transaction_status" NOT NULL,
	"version" smallint NOT NULL,
	"size_bytes" integer,
	"unique_address_count" integer,
	"error_message" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"slot" bigint
);
--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "destination_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"destination_mint" text NOT NULL,
	"apy" numeric(20, 6) NOT NULL,
	"apy_30d" numeric(20, 6),
	"tvl_usd" numeric(20, 6),
	"source" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "destination_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "market_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"market_address" text NOT NULL,
	"reserve_address" text NOT NULL,
	"token_mint" text NOT NULL,
	"token_symbol" text NOT NULL,
	"max_ltv" numeric(20, 6) NOT NULL,
	"liquidation_threshold" numeric(20, 6) NOT NULL,
	"borrow_apy" numeric(20, 6) NOT NULL,
	"supply_apy" numeric(20, 6) NOT NULL,
	"total_supply_usd" numeric(20, 6) NOT NULL,
	"total_borrow_usd" numeric(20, 6) NOT NULL,
	"available_liquidity_usd" numeric(20, 6) NOT NULL,
	"oracle_price_usd" numeric(20, 6) NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rate_limit_buckets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" "audit_action" NOT NULL,
	"details" jsonb
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_nonces" ADD CONSTRAINT "auth_nonces_wallet_address_wallets_address_fk" FOREIGN KEY ("wallet_address") REFERENCES "public"."wallets"("address") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_wallet_address_wallets_address_fk" FOREIGN KEY ("wallet_address") REFERENCES "public"."wallets"("address") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_wallet_address_wallets_address_fk" FOREIGN KEY ("wallet_address") REFERENCES "public"."wallets"("address") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_snapshots" ADD CONSTRAINT "position_snapshots_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guard_events" ADD CONSTRAINT "guard_events_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_wallet_address_wallets_address_fk" FOREIGN KEY ("wallet_address") REFERENCES "public"."wallets"("address") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_nonces_expires_at_index" ON "auth_nonces" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_wallet_address_index" ON "sessions" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "positions_wallet_address_status_index" ON "positions" USING btree ("wallet_address","status");--> statement-breakpoint
CREATE INDEX "positions_position_address_index" ON "positions" USING btree ("position_address");--> statement-breakpoint
CREATE INDEX "position_snapshots_position_id_taken_at_index" ON "position_snapshots" USING btree ("position_id","taken_at");--> statement-breakpoint
CREATE INDEX "guard_events_position_id_at_index" ON "guard_events" USING btree ("position_id","at");--> statement-breakpoint
CREATE INDEX "guard_events_caller_address_at_index" ON "guard_events" USING btree ("caller_address","at");--> statement-breakpoint
CREATE INDEX "keeper_runs_at_index" ON "keeper_runs" USING btree ("at");--> statement-breakpoint
CREATE INDEX "transactions_wallet_address_index" ON "transactions" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "transactions_position_id_index" ON "transactions" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "destination_snapshots_mint_taken_at_index" ON "destination_snapshots" USING btree ("destination_mint","taken_at");--> statement-breakpoint
CREATE INDEX "market_snapshots_reserve_taken_at_index" ON "market_snapshots" USING btree ("reserve_address","taken_at");--> statement-breakpoint
CREATE INDEX "audit_log_at_index" ON "audit_log" USING btree ("at");