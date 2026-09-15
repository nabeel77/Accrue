import { pgEnum } from 'drizzle-orm/pg-core';

export const positionStatusEnum = pgEnum('position_status', [
  'building',
  'submitted',
  'open',
  'unwinding',
  'closed',
  'liquidated',
  'left',
  'failed',
  'expired',
]);

export const positionHealthEnum = pgEnum('position_health', [
  'healthy',
  'caution',
  'danger',
]);

export const guardEventKindEnum = pgEnum('guard_event_kind', [
  'protect',
  'grow',
  'leave',
]);

export const keeperOutcomeEnum = pgEnum('keeper_outcome', [
  'landed',
  'reverted',
  'skipped',
]);

export const transactionKindEnum = pgEnum('transaction_kind', [
  'open',
  'open_without_swap',
  'open_swap',
  'unwind',
  'repay',
  'withdraw',
  'add_collateral',
  'set_strategy',
  'protect_by_owner',
  'rescue',
]);

export const transactionStatusEnum = pgEnum('transaction_status', [
  'submitted',
  'confirmed',
  'failed',
]);

export const auditActionEnum = pgEnum('audit_action', [
  'sign_in',
  'terms_accepted',
  'build_refused_terms',
  'risk_acknowledged',
  'build_refused_acknowledgement',
  'build_refused_cap',
  'build_refused_liquidity',
  'build_refused_strategy',
  'ltv_override_accepted',
  'position_opened',
  'position_closed',
  'protect_by_owner',
  'kill_switch_hit',
]);
