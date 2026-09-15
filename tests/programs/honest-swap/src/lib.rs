//! Test only. Stands in for the swap router at its own address and fills at the price the test
//! asks for, so the guard and owner instructions can be exercised without a live route.

use anchor_lang::solana_program::account_info::{next_account_info, AccountInfo};
use anchor_lang::solana_program::entrypoint;
use anchor_lang::solana_program::entrypoint::ProgramResult;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_lang::solana_program::program_error::ProgramError;
use anchor_lang::solana_program::pubkey::Pubkey;

pub const SWAP_AUTHORITY_SEED: &[u8] = b"swap";

entrypoint!(fill_the_route);

/// Accounts, in order: the caller that authorises the input, the input account, the output
/// account, the vault that takes the input, the vault that pays the output, the vault authority,
/// the input mint, the output mint, the input token program, the output token program.
/// Data: eight bytes of input amount then eight bytes of output amount.
pub fn fill_the_route(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let (amount_in, amount_out) = read_amounts(instruction_data)?;

    let account_iterator = &mut accounts.iter();
    let payer = next_account_info(account_iterator)?;
    let source = next_account_info(account_iterator)?;
    let destination = next_account_info(account_iterator)?;
    let vault_taking_the_input = next_account_info(account_iterator)?;
    let vault_paying_the_output = next_account_info(account_iterator)?;
    let vault_authority = next_account_info(account_iterator)?;
    let source_mint = next_account_info(account_iterator)?;
    let destination_mint = next_account_info(account_iterator)?;
    let source_token_program = next_account_info(account_iterator)?;
    let destination_token_program = next_account_info(account_iterator)?;

    let (_, authority_bump) = Pubkey::find_program_address(&[SWAP_AUTHORITY_SEED], program_id);
    let authority_seeds: &[&[u8]] = &[SWAP_AUTHORITY_SEED, &[authority_bump]];

    invoke(
        &transfer_checked_instruction(
            source_token_program.key,
            source.key,
            source_mint.key,
            vault_taking_the_input.key,
            payer.key,
            amount_in,
            mint_decimals(source_mint)?,
        ),
        &[
            source.clone(),
            source_mint.clone(),
            vault_taking_the_input.clone(),
            payer.clone(),
        ],
    )?;

    invoke_signed(
        &transfer_checked_instruction(
            destination_token_program.key,
            vault_paying_the_output.key,
            destination_mint.key,
            destination.key,
            vault_authority.key,
            amount_out,
            mint_decimals(destination_mint)?,
        ),
        &[
            vault_paying_the_output.clone(),
            destination_mint.clone(),
            destination.clone(),
            vault_authority.clone(),
        ],
        &[authority_seeds],
    )
}

pub fn read_amounts(instruction_data: &[u8]) -> Result<(u64, u64), ProgramError> {
    let amount_in = instruction_data
        .get(0..8)
        .ok_or(ProgramError::InvalidInstructionData)?;
    let amount_out = instruction_data
        .get(8..16)
        .ok_or(ProgramError::InvalidInstructionData)?;
    let mut buffer = [0u8; 8];
    buffer.copy_from_slice(amount_in);
    let amount_in = u64::from_le_bytes(buffer);
    buffer.copy_from_slice(amount_out);
    Ok((amount_in, u64::from_le_bytes(buffer)))
}

pub fn mint_decimals(mint: &AccountInfo) -> Result<u8, ProgramError> {
    let data = mint.try_borrow_data()?;
    data.get(44)
        .copied()
        .ok_or(ProgramError::InvalidAccountData)
}

#[allow(clippy::too_many_arguments)]
pub fn transfer_checked_instruction(
    token_program: &Pubkey,
    source: &Pubkey,
    mint: &Pubkey,
    destination: &Pubkey,
    authority: &Pubkey,
    amount: u64,
    decimals: u8,
) -> anchor_lang::solana_program::instruction::Instruction {
    let mut data = vec![12u8];
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(decimals);

    anchor_lang::solana_program::instruction::Instruction {
        program_id: *token_program,
        accounts: vec![
            anchor_lang::solana_program::instruction::AccountMeta::new(*source, false),
            anchor_lang::solana_program::instruction::AccountMeta::new_readonly(*mint, false),
            anchor_lang::solana_program::instruction::AccountMeta::new(*destination, false),
            anchor_lang::solana_program::instruction::AccountMeta::new_readonly(*authority, true),
        ],
        data,
    }
}
