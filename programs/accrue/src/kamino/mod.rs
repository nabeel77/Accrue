pub mod cpi;
pub mod fraction;
#[allow(clippy::expect_used, clippy::unwrap_used)]
pub mod generated;
pub mod obligation;
pub mod reserve;

use anchor_lang::prelude::Pubkey;

pub use fraction::{
    scaled_fraction_to_whole_units, scaled_fraction_to_whole_units_rounding_up,
    whole_units_to_scaled_fraction, SCALED_FRACTION_BITS, SCALED_FRACTION_ONE,
};
pub use obligation::{
    decode_obligation, obligation_was_closed_by_the_market, read_obligation_account,
    read_obligation_adjusted_debt_value_scaled, read_obligation_borrowed_amount_scaled,
    read_obligation_borrowed_value_scaled, read_obligation_deposited_amount,
    read_obligation_deposited_value_scaled, read_obligation_has_debt,
    read_obligation_loan_to_value_bps, read_obligation_reserves_in_order, ObligationBorrow,
    ObligationDeposit, ObligationSnapshot, OBLIGATION_ACCOUNT_LEN,
};
pub use reserve::{
    decode_reserve, read_reserve_account, ReserveSnapshot, WithdrawalCap, RESERVE_ACCOUNT_LEN,
};

pub const KAMINO_LEND_PROGRAM_ID: Pubkey = generated::KAMINO_LENDING_ID;
