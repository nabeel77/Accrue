use anchor_lang::prelude::Pubkey;
use solana_address::address;

pub use crate::clusters::{
    JUPITER_V6_PROGRAM_ID, KAMINO_FARMS_PROGRAM_ID, KAMINO_LEND_PROGRAM_ID, SCOPE_PRICE_ACCOUNT,
    SCOPE_PROGRAM_ID,
};

pub const TOKEN_PROGRAM_ID: Pubkey = address!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

pub const TOKEN_2022_PROGRAM_ID: Pubkey = address!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

pub const ASSOCIATED_TOKEN_PROGRAM_ID: Pubkey =
    address!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

pub const INSTRUCTIONS_SYSVAR_ID: Pubkey = address!("Sysvar1nstructions1111111111111111111111111");

pub const RENT_SYSVAR_ID: Pubkey = address!("SysvarRent111111111111111111111111111111111");

pub const SYSTEM_PROGRAM_ID: Pubkey = address!("11111111111111111111111111111111");

pub const CONFIG_SEED: &[u8] = b"config";
pub const POSITION_SEED: &[u8] = b"position";

pub const BASIS_POINTS_DENOMINATOR: u64 = 10_000;

pub const PERCENT_DENOMINATOR: u64 = 100;

pub const PERFORMANCE_FEE_BPS_CEILING: u16 = 2_000;

pub const SLIPPAGE_BPS_CEILING: u16 = 500;

pub const KEEPER_BOUNTY_BPS_CEILING: u16 = 100;

pub const SHARE_OF_AVAILABLE_BPS_CEILING: u16 = 2_000;

pub const MIN_GUARD_ROOM_BPS: u16 = 500;

pub const MAX_ALLOWED_COLLATERAL: usize = 16;

pub const MAX_ALLOWED_DESTINATIONS: usize = 8;

pub const MAX_PRICE_AGE_SLOTS_CEILING: u64 = 1_500;

pub const MIN_PROTECT_INTERVAL_SECONDS_FLOOR: u64 = 60;

pub const MIN_GROW_INTERVAL_SECONDS_FLOOR: u64 = 600;

pub fn is_known_token_program(program_id: &Pubkey) -> bool {
    *program_id == TOKEN_PROGRAM_ID || *program_id == TOKEN_2022_PROGRAM_ID
}
