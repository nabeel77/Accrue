use anchor_lang::prelude::*;

use crate::constants::{BASIS_POINTS_DENOMINATOR, PERCENT_DENOMINATOR};
use crate::error::AccrueError;
use crate::scope::divide_rounding_up;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProtectAmounts {
    pub repay_usd_scaled: u128,
    pub bounty_usd_scaled: u128,
}

fn value_allowed_at_target(deposited_value_scaled: u128, target_ltv_bps: u16) -> Result<u128> {
    deposited_value_scaled
        .checked_mul(u128::from(target_ltv_bps))
        .ok_or(AccrueError::MathOverflow)?
        .checked_div(u128::from(BASIS_POINTS_DENOMINATOR))
        .ok_or_else(|| AccrueError::MathOverflow.into())
}

fn weighted_value_as_real_value(
    weighted_value_scaled: u128,
    borrow_factor_pct: u64,
    round_up: bool,
) -> Result<u128> {
    let numerator = weighted_value_scaled
        .checked_mul(u128::from(PERCENT_DENOMINATOR))
        .ok_or(AccrueError::MathOverflow)?;
    let denominator = u128::from(borrow_factor_pct);
    require!(denominator > 0, AccrueError::ReserveHasNoBorrowFactor);

    if round_up {
        divide_rounding_up(numerator, denominator)
    } else {
        numerator
            .checked_div(denominator)
            .ok_or_else(|| AccrueError::MathOverflow.into())
    }
}

pub fn repay_to_reach_target(
    adjusted_debt_value_scaled: u128,
    deposited_value_scaled: u128,
    target_ltv_bps: u16,
    borrow_factor_pct: u64,
) -> Result<u128> {
    let gap = adjusted_debt_value_scaled.saturating_sub(value_allowed_at_target(
        deposited_value_scaled,
        target_ltv_bps,
    )?);
    weighted_value_as_real_value(gap, borrow_factor_pct, true)
}

pub fn borrow_to_reach_target(
    adjusted_debt_value_scaled: u128,
    deposited_value_scaled: u128,
    target_ltv_bps: u16,
    borrow_factor_pct: u64,
) -> Result<u128> {
    let room = value_allowed_at_target(deposited_value_scaled, target_ltv_bps)?
        .saturating_sub(adjusted_debt_value_scaled);
    weighted_value_as_real_value(room, borrow_factor_pct, false)
}

pub fn protect_amounts(
    adjusted_debt_value_scaled: u128,
    deposited_value_scaled: u128,
    target_ltv_bps: u16,
    keeper_bounty_bps: u16,
    borrow_factor_pct: u64,
) -> Result<ProtectAmounts> {
    let repay_usd_scaled = repay_to_reach_target(
        adjusted_debt_value_scaled,
        deposited_value_scaled,
        target_ltv_bps,
        borrow_factor_pct,
    )?;

    let bounty_usd_scaled = repay_usd_scaled
        .checked_mul(u128::from(keeper_bounty_bps))
        .ok_or(AccrueError::MathOverflow)?
        .checked_div(u128::from(BASIS_POINTS_DENOMINATOR))
        .ok_or(AccrueError::MathOverflow)?;

    Ok(ProtectAmounts {
        repay_usd_scaled,
        bounty_usd_scaled,
    })
}

pub fn performance_fee_on_realised_profit(
    usdc_from_sales_total: u64,
    usdc_repaid_total: u64,
    fee_bps_at_open: u16,
) -> Result<u64> {
    let profit = usdc_from_sales_total.saturating_sub(usdc_repaid_total);
    let fee = u128::from(profit)
        .checked_mul(u128::from(fee_bps_at_open))
        .ok_or(AccrueError::MathOverflow)?
        .checked_div(u128::from(BASIS_POINTS_DENOMINATOR))
        .ok_or(AccrueError::MathOverflow)?;
    u64::try_from(fee).map_err(|_| AccrueError::MathOverflow.into())
}

pub fn require_the_interval_has_elapsed(
    last_at: i64,
    now: i64,
    interval_seconds: u64,
) -> Result<()> {
    if last_at == 0 {
        return Ok(());
    }
    let interval = i64::try_from(interval_seconds).map_err(|_| AccrueError::MathOverflow)?;
    let next_allowed = last_at
        .checked_add(interval)
        .ok_or(AccrueError::MathOverflow)?;
    require!(now >= next_allowed, AccrueError::IntervalHasNotElapsed);
    Ok(())
}

pub fn require_borrow_within_available_share(
    borrow_amount: u64,
    available_amount: u64,
    max_share_bps: u16,
) -> Result<()> {
    let ceiling = u128::from(available_amount)
        .checked_mul(u128::from(max_share_bps))
        .ok_or(AccrueError::MathOverflow)?
        .checked_div(u128::from(BASIS_POINTS_DENOMINATOR))
        .ok_or(AccrueError::MathOverflow)?;
    require!(
        u128::from(borrow_amount) <= ceiling,
        AccrueError::BorrowTooLargeAShareOfLiquidity
    );
    Ok(())
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::integer_division,
    clippy::arithmetic_side_effects,
    clippy::indexing_slicing
)]
mod tests {
    use super::*;
    use crate::kamino::{whole_units_to_scaled_fraction, SCALED_FRACTION_ONE};

    const NO_BORROW_WEIGHTING: u64 = 100;

    fn whole_dollars(amount: u128) -> u128 {
        whole_units_to_scaled_fraction(amount).unwrap()
    }

    #[test]
    fn the_worked_example_from_the_program_document() {
        let borrowed = whole_dollars(400);
        let deposited = whole_dollars(750);
        let target_ltv_bps = 4_000;
        let keeper_bounty_bps = 10;

        let amounts = protect_amounts(
            borrowed,
            deposited,
            target_ltv_bps,
            keeper_bounty_bps,
            NO_BORROW_WEIGHTING,
        )
        .unwrap();

        assert_eq!(
            amounts.repay_usd_scaled,
            whole_dollars(100),
            "four hundred borrowed against seven hundred and fifty at a forty percent target repays one hundred"
        );
        assert_eq!(
            amounts.bounty_usd_scaled,
            SCALED_FRACTION_ONE / 10,
            "ten basis points of a hundred dollars is ten cents"
        );
    }

    #[test]
    fn a_position_already_at_target_needs_no_repay() {
        let borrowed = whole_dollars(300);
        let deposited = whole_dollars(750);
        let amounts = protect_amounts(borrowed, deposited, 4_000, 10, NO_BORROW_WEIGHTING).unwrap();
        assert_eq!(amounts.repay_usd_scaled, 0);
        assert_eq!(amounts.bounty_usd_scaled, 0);
    }

    #[test]
    fn a_position_below_target_needs_no_repay() {
        let borrowed = whole_dollars(100);
        let deposited = whole_dollars(750);
        assert_eq!(
            repay_to_reach_target(borrowed, deposited, 4_000, NO_BORROW_WEIGHTING).unwrap(),
            0,
            "a healthy position is never asked to repay"
        );
    }

    #[test]
    fn grow_borrows_the_room_between_the_debt_and_the_target() {
        let borrowed = whole_dollars(200);
        let deposited = whole_dollars(1_000);
        assert_eq!(
            borrow_to_reach_target(borrowed, deposited, 4_000, NO_BORROW_WEIGHTING).unwrap(),
            whole_dollars(200),
            "two hundred owed against a thousand at a forty percent target leaves two hundred to borrow"
        );
    }

    #[test]
    fn grow_borrows_nothing_when_the_position_is_already_past_target() {
        let borrowed = whole_dollars(500);
        let deposited = whole_dollars(1_000);
        assert_eq!(
            borrow_to_reach_target(borrowed, deposited, 4_000, NO_BORROW_WEIGHTING).unwrap(),
            0
        );
    }

    #[test]
    fn a_borrow_factor_above_one_turns_weighted_value_back_into_real_usdc() {
        let deposited = whole_dollars(750);
        let target_ltv_bps = 4_000;
        let borrow_factor_pct = 120;

        let adjusted_debt = whole_dollars(400);
        let amounts = protect_amounts(
            adjusted_debt,
            deposited,
            target_ltv_bps,
            10,
            borrow_factor_pct,
        )
        .unwrap();

        assert_eq!(
            amounts.repay_usd_scaled,
            (whole_dollars(100) * 100).div_ceil(120),
            "a hundred dollars of weighted gap is eighty three and a third of real USDC at a factor of one and a fifth"
        );

        let repaid_weighted = amounts.repay_usd_scaled * 120 / 100;
        let left = adjusted_debt - repaid_weighted;
        assert!(
            left <= deposited * u128::from(target_ltv_bps) / 10_000,
            "repaying that much real USDC must bring the weighted debt to target"
        );
    }

    #[test]
    fn a_borrow_factor_above_one_lets_grow_borrow_less_than_the_room_it_sees() {
        let deposited = whole_dollars(1_000);
        let adjusted_debt = whole_dollars(200);

        assert_eq!(
            borrow_to_reach_target(adjusted_debt, deposited, 4_000, 120).unwrap(),
            whole_dollars(200) * 100 / 120,
            "two hundred of weighted room only buys a hundred and sixty six of real borrowing"
        );
        assert!(
            borrow_to_reach_target(adjusted_debt, deposited, 4_000, 120).unwrap()
                < borrow_to_reach_target(adjusted_debt, deposited, 4_000, NO_BORROW_WEIGHTING)
                    .unwrap()
        );
    }

    #[test]
    fn a_borrow_factor_of_zero_is_refused_rather_than_divided_by() {
        assert!(repay_to_reach_target(whole_dollars(400), whole_dollars(750), 4_000, 0).is_err());
        assert!(
            borrow_to_reach_target(whole_dollars(200), whole_dollars(1_000), 4_000, 0).is_err()
        );
    }

    const USDC: u64 = 1_000_000;
    const TEN_PERCENT_BPS: u16 = 1_000;

    #[test]
    fn the_fee_is_charged_on_what_the_sales_raised_above_everything_repaid() {
        let sales = 104 * USDC;
        let repaid = 50 * USDC + 51 * USDC;

        assert_eq!(
            performance_fee_on_realised_profit(sales, repaid, TEN_PERCENT_BPS).unwrap(),
            300_000,
            "a hundred and four raised against a hundred and one repaid is three dollars of profit"
        );
    }

    #[test]
    fn the_fee_ignores_principal_the_owner_repaid_from_their_own_wallet() {
        let sales = 104 * USDC;
        let repaid_inside_unwind = 51 * USDC;
        let repaid_everywhere = 50 * USDC + repaid_inside_unwind;

        let charged_on_the_whole_sale =
            performance_fee_on_realised_profit(sales, repaid_inside_unwind, TEN_PERCENT_BPS)
                .unwrap();
        let charged_on_the_profit =
            performance_fee_on_realised_profit(sales, repaid_everywhere, TEN_PERCENT_BPS).unwrap();

        assert_eq!(
            charged_on_the_whole_sale, 5_300_000,
            "counting only the repayment inside unwind would call fifty three dollars profit"
        );
        assert_eq!(charged_on_the_profit, 300_000);
        assert!(charged_on_the_profit < charged_on_the_whole_sale);
    }

    #[test]
    fn a_position_that_sold_for_less_than_it_repaid_is_charged_nothing() {
        assert_eq!(
            performance_fee_on_realised_profit(90 * USDC, 101 * USDC, TEN_PERCENT_BPS).unwrap(),
            0
        );
        assert_eq!(
            performance_fee_on_realised_profit(101 * USDC, 101 * USDC, TEN_PERCENT_BPS).unwrap(),
            0
        );
    }

    #[test]
    fn an_interval_that_has_not_elapsed_is_refused() {
        assert!(require_the_interval_has_elapsed(1_000, 1_500, 600).is_err());
        assert!(require_the_interval_has_elapsed(1_000, 1_600, 600).is_ok());
        assert!(
            require_the_interval_has_elapsed(0, 1, 600).is_ok(),
            "a position that has never been guarded may be guarded now"
        );
    }

    #[test]
    fn a_guarded_position_survives_every_price_path_inside_the_guard_room() {
        const LIQUIDATION_THRESHOLD_BPS: u128 = 6_500;
        const PROTECT_BPS: u128 = 5_000;
        const TARGET_BPS: u128 = 4_000;
        const COLLATERAL_UNITS: u128 = 1_000_000_000;
        const STARTING_PRICE: u128 = 200_000_000;
        const STEPS: usize = 2_000;
        const BORROW_FACTOR_PCT: u64 = 120;

        // The fall that would carry a position from the guard level to liquidation in one step.
        let worst_fall_permille = PROTECT_BPS * 1_000 / LIQUIDATION_THRESHOLD_BPS;

        let mut random = 0x2545_F491_4F6C_DD1Du64;
        let mut next = move || {
            random ^= random << 13;
            random ^= random >> 7;
            random ^= random << 17;
            random
        };

        let lowest_price = STARTING_PRICE / 50;
        let highest_price = STARTING_PRICE * 50;
        let mut price = STARTING_PRICE;
        let mut adjusted_debt =
            COLLATERAL_UNITS * STARTING_PRICE * TARGET_BPS / 10_000 / 1_000_000_000;
        let mut worst_seen_bps = 0u128;

        for _ in 0..STEPS {
            let roll = u128::from(next() % 1_000);
            let biggest_rise_permille = 2_000 - worst_fall_permille;
            let move_permille =
                worst_fall_permille + roll * (biggest_rise_permille - worst_fall_permille) / 999;
            price = (price * move_permille / 1_000).clamp(lowest_price, highest_price);

            let collateral_value = COLLATERAL_UNITS * price / 1_000_000_000;
            let loan_to_value_bps = adjusted_debt * 10_000 / collateral_value.max(1);
            worst_seen_bps = worst_seen_bps.max(loan_to_value_bps);

            assert!(
                loan_to_value_bps < LIQUIDATION_THRESHOLD_BPS,
                "a guarded position reached {loan_to_value_bps} basis points, at or past the level the market liquidates at"
            );

            if loan_to_value_bps >= PROTECT_BPS {
                let repaid_in_usdc = repay_to_reach_target(
                    adjusted_debt,
                    collateral_value,
                    TARGET_BPS as u16,
                    BORROW_FACTOR_PCT,
                )
                .unwrap();
                let repaid_weighted = repaid_in_usdc * u128::from(BORROW_FACTOR_PCT) / 100;
                adjusted_debt = adjusted_debt.saturating_sub(repaid_weighted);
                let after_bps = adjusted_debt * 10_000 / collateral_value.max(1);
                assert!(
                    after_bps <= TARGET_BPS,
                    "the guard left the position at {after_bps} basis points, above its target"
                );
            }
        }

        assert!(
            worst_seen_bps >= PROTECT_BPS,
            "the path never crossed the guard level, so the test proved nothing"
        );
    }

    #[test]
    fn a_borrow_above_the_share_of_available_liquidity_is_refused() {
        assert!(require_borrow_within_available_share(1_000, 10_000, 1_000).is_ok());
        assert!(require_borrow_within_available_share(1_001, 10_000, 1_000).is_err());
    }
}
