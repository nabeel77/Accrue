use anchor_lang::prelude::*;

use crate::constants::BASIS_POINTS_DENOMINATOR;
use crate::error::AccrueError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProtectAmounts {
    pub repay_usd_scaled: u128,
    pub bounty_usd_scaled: u128,
}

pub fn repay_to_reach_target(
    borrowed_value_scaled: u128,
    deposited_value_scaled: u128,
    target_ltv_bps: u16,
) -> Result<u128> {
    let value_allowed_at_target = deposited_value_scaled
        .checked_mul(u128::from(target_ltv_bps))
        .ok_or(AccrueError::MathOverflow)?
        .checked_div(u128::from(BASIS_POINTS_DENOMINATOR))
        .ok_or(AccrueError::MathOverflow)?;

    Ok(borrowed_value_scaled.saturating_sub(value_allowed_at_target))
}

pub fn borrow_to_reach_target(
    borrowed_value_scaled: u128,
    deposited_value_scaled: u128,
    target_ltv_bps: u16,
) -> Result<u128> {
    let value_allowed_at_target = deposited_value_scaled
        .checked_mul(u128::from(target_ltv_bps))
        .ok_or(AccrueError::MathOverflow)?
        .checked_div(u128::from(BASIS_POINTS_DENOMINATOR))
        .ok_or(AccrueError::MathOverflow)?;

    Ok(value_allowed_at_target.saturating_sub(borrowed_value_scaled))
}

pub fn protect_amounts(
    borrowed_value_scaled: u128,
    deposited_value_scaled: u128,
    target_ltv_bps: u16,
    keeper_bounty_bps: u16,
) -> Result<ProtectAmounts> {
    let repay_usd_scaled = repay_to_reach_target(
        borrowed_value_scaled,
        deposited_value_scaled,
        target_ltv_bps,
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

    fn whole_dollars(amount: u128) -> u128 {
        whole_units_to_scaled_fraction(amount).unwrap()
    }

    #[test]
    fn the_worked_example_from_the_program_document() {
        let borrowed = whole_dollars(400);
        let deposited = whole_dollars(750);
        let target_ltv_bps = 4_000;
        let keeper_bounty_bps = 10;

        let amounts =
            protect_amounts(borrowed, deposited, target_ltv_bps, keeper_bounty_bps).unwrap();

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
        let amounts = protect_amounts(borrowed, deposited, 4_000, 10).unwrap();
        assert_eq!(amounts.repay_usd_scaled, 0);
        assert_eq!(amounts.bounty_usd_scaled, 0);
    }

    #[test]
    fn a_position_below_target_needs_no_repay() {
        let borrowed = whole_dollars(100);
        let deposited = whole_dollars(750);
        assert_eq!(
            repay_to_reach_target(borrowed, deposited, 4_000).unwrap(),
            0,
            "a healthy position is never asked to repay"
        );
    }

    #[test]
    fn grow_borrows_the_room_between_the_debt_and_the_target() {
        let borrowed = whole_dollars(200);
        let deposited = whole_dollars(1_000);
        assert_eq!(
            borrow_to_reach_target(borrowed, deposited, 4_000).unwrap(),
            whole_dollars(200),
            "two hundred owed against a thousand at a forty percent target leaves two hundred to borrow"
        );
    }

    #[test]
    fn grow_borrows_nothing_when_the_position_is_already_past_target() {
        let borrowed = whole_dollars(500);
        let deposited = whole_dollars(1_000);
        assert_eq!(
            borrow_to_reach_target(borrowed, deposited, 4_000).unwrap(),
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

    /// A guarded position never reaches the level the market liquidates at, as long as the price
    /// moves less than the room between the guard and that level inside one protect interval.
    #[test]
    fn a_guarded_position_survives_every_price_path_inside_the_guard_room() {
        const LIQUIDATION_THRESHOLD_BPS: u128 = 6_500;
        const PROTECT_BPS: u128 = 5_000;
        const TARGET_BPS: u128 = 4_000;
        const COLLATERAL_UNITS: u128 = 1_000_000_000;
        const STARTING_PRICE: u128 = 200_000_000;
        const STEPS: usize = 2_000;

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
        let mut debt = COLLATERAL_UNITS * STARTING_PRICE * TARGET_BPS / 10_000 / 1_000_000_000;
        let mut worst_seen_bps = 0u128;

        for _ in 0..STEPS {
            let roll = u128::from(next() % 1_000);
            let biggest_rise_permille = 2_000 - worst_fall_permille;
            let move_permille =
                worst_fall_permille + roll * (biggest_rise_permille - worst_fall_permille) / 999;
            price = (price * move_permille / 1_000).clamp(lowest_price, highest_price);

            let collateral_value = COLLATERAL_UNITS * price / 1_000_000_000;
            let loan_to_value_bps = debt * 10_000 / collateral_value.max(1);
            worst_seen_bps = worst_seen_bps.max(loan_to_value_bps);

            assert!(
                loan_to_value_bps < LIQUIDATION_THRESHOLD_BPS,
                "a guarded position reached {loan_to_value_bps} basis points, at or past the level the market liquidates at"
            );

            if loan_to_value_bps >= PROTECT_BPS {
                let repay =
                    repay_to_reach_target(debt, collateral_value, TARGET_BPS as u16).unwrap();
                debt = debt.saturating_sub(repay);
                let after_bps = debt * 10_000 / collateral_value.max(1);
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
