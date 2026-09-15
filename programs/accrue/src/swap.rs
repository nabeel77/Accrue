use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;

use crate::constants::JUPITER_V6_PROGRAM_ID;
use crate::error::AccrueError;
use crate::invariants::{
    assert_swap_route_touches_nothing_it_must_not, token_account_amount, PositionAccounts,
    SwapBounds,
};

pub struct JupiterSwap<'info> {
    pub source: AccountInfo<'info>,
    pub destination: AccountInfo<'info>,
    pub amount_in: u64,
    pub minimum_out: u64,
}

pub fn execute_jupiter_swap<'info>(
    swap: &JupiterSwap<'info>,
    position_accounts: &PositionAccounts<'info>,
    route_accounts: &[AccountInfo<'info>],
    route_data: &[u8],
    position_seeds: &[&[u8]],
) -> Result<SwapBounds> {
    require!(swap.amount_in > 0, AccrueError::NothingToSwap);
    require!(!route_data.is_empty(), AccrueError::NothingToSwap);
    require!(!route_accounts.is_empty(), AccrueError::NothingToSwap);

    assert_swap_route_touches_nothing_it_must_not(
        route_accounts,
        position_accounts,
        &swap.source.key(),
        &swap.destination.key(),
    )?;

    let position_key = position_accounts.position.key();
    let metas = route_accounts
        .iter()
        .map(|account| {
            let signs_through_our_seeds = account.key() == position_key;
            if account.is_writable {
                AccountMeta::new(account.key(), signs_through_our_seeds)
            } else {
                AccountMeta::new_readonly(account.key(), signs_through_our_seeds)
            }
        })
        .collect::<Vec<AccountMeta>>();

    let source_before = token_account_amount(&swap.source)?;
    let destination_before = token_account_amount(&swap.destination)?;

    invoke_signed(
        &Instruction {
            program_id: JUPITER_V6_PROGRAM_ID,
            accounts: metas,
            data: route_data.to_vec(),
        },
        route_accounts,
        &[position_seeds],
    )?;

    let source_after = token_account_amount(&swap.source)?;
    let destination_after = token_account_amount(&swap.destination)?;

    let spent = source_before
        .checked_sub(source_after)
        .ok_or(AccrueError::SwapSpentTooMuch)?;
    require!(spent <= swap.amount_in, AccrueError::SwapSpentTooMuch);

    let received = destination_after
        .checked_sub(destination_before)
        .ok_or(AccrueError::SwapReturnedTooLittle)?;
    require!(
        received >= swap.minimum_out,
        AccrueError::SwapReturnedTooLittle
    );

    Ok(SwapBounds {
        amount_in: swap.amount_in,
        minimum_out: swap.minimum_out,
    })
}
