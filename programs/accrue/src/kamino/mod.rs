pub mod fraction;
#[allow(clippy::expect_used, clippy::unwrap_used)]
pub mod generated;
pub mod obligation;
pub mod reserve;

use anchor_lang::prelude::Pubkey;

pub use fraction::{
    scaled_fraction_to_whole_units, whole_units_to_scaled_fraction, SCALED_FRACTION_ONE,
};
pub use obligation::{
    decode_obligation, read_obligation_account, ObligationBorrow, ObligationDeposit,
    ObligationSnapshot, OBLIGATION_ACCOUNT_LEN,
};
pub use reserve::{
    decode_reserve, read_reserve_account, ReserveSnapshot, WithdrawalCap, RESERVE_ACCOUNT_LEN,
};

pub const KAMINO_LEND_PROGRAM_ID: Pubkey = generated::KAMINO_LENDING_ID;
