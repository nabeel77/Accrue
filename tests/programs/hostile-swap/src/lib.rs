//! Test only. Stands in for the swap router at its own address and tries, one attack per mode,
//! every way a route could take something it was not given, so each one can be proven to revert.

use anchor_lang::solana_program::account_info::{next_account_info, AccountInfo};
use anchor_lang::solana_program::entrypoint;
use anchor_lang::solana_program::entrypoint::ProgramResult;
use anchor_lang::solana_program::program::invoke;
use anchor_lang::solana_program::program_error::ProgramError;
use anchor_lang::solana_program::pubkey::Pubkey;

pub const ATTACK_KEEP_THE_INPUT_AND_PAY_NOTHING: u8 = 0;
pub const ATTACK_PAY_LESS_THAN_THE_MINIMUM: u8 = 1;
pub const ATTACK_SEND_THE_OUTPUT_SOMEWHERE_ELSE: u8 = 2;
pub const ATTACK_DRAIN_AN_ACCOUNT_IT_WAS_HANDED: u8 = 3;
pub const ATTACK_CLOSE_AN_ACCOUNT_IT_WAS_HANDED: u8 = 4;
pub const ATTACK_HONEST_FILL: u8 = 5;

pub const SWAP_AUTHORITY_SEED: &[u8] = b"swap";

const TRANSFER_CHECKED_DISCRIMINATOR: u8 = 12;
const CLOSE_ACCOUNT_DISCRIMINATOR: u8 = 9;

entrypoint!(attack_the_position);

/// Accounts, in order: the caller that authorises the input, the input account, the output
/// account, the vault that takes the input, the vault that pays the output, the vault authority,
/// the input mint, the output mint, the input token program, the output token program, then the
/// account this attack wants to walk away with.
/// Data: one mode byte, eight bytes of input amount, eight bytes of output amount.
pub fn attack_the_position(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let mode = *instruction_data
        .first()
        .ok_or(ProgramError::InvalidInstructionData)?;
    let amount_in = read_u64(instruction_data, 1)?;
    let amount_out = read_u64(instruction_data, 9)?;

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
    let what_it_wants_to_take = next_account_info(account_iterator).ok();

    take_the_input(
        source_token_program,
        source,
        source_mint,
        vault_taking_the_input,
        payer,
        amount_in,
    )?;

    match mode {
        ATTACK_KEEP_THE_INPUT_AND_PAY_NOTHING => Ok(()),

        ATTACK_PAY_LESS_THAN_THE_MINIMUM | ATTACK_HONEST_FILL => pay_the_output(
            program_id,
            destination_token_program,
            vault_paying_the_output,
            destination_mint,
            destination,
            vault_authority,
            amount_out,
        ),

        ATTACK_SEND_THE_OUTPUT_SOMEWHERE_ELSE => {
            let elsewhere = what_it_wants_to_take.ok_or(ProgramError::NotEnoughAccountKeys)?;
            pay_the_output(
                program_id,
                destination_token_program,
                vault_paying_the_output,
                destination_mint,
                elsewhere,
                vault_authority,
                amount_out,
            )
        }

        ATTACK_DRAIN_AN_ACCOUNT_IT_WAS_HANDED => {
            let taking = what_it_wants_to_take.ok_or(ProgramError::NotEnoughAccountKeys)?;
            take_the_input(
                source_token_program,
                taking,
                source_mint,
                vault_taking_the_input,
                payer,
                token_account_amount(taking)?,
            )
        }

        ATTACK_CLOSE_AN_ACCOUNT_IT_WAS_HANDED => {
            let taking = what_it_wants_to_take.ok_or(ProgramError::NotEnoughAccountKeys)?;
            invoke(
                &anchor_lang::solana_program::instruction::Instruction {
                    program_id: *source_token_program.key,
                    accounts: vec![
                        anchor_lang::solana_program::instruction::AccountMeta::new(
                            *source.key,
                            false,
                        ),
                        anchor_lang::solana_program::instruction::AccountMeta::new(
                            *taking.key,
                            false,
                        ),
                        anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                            *payer.key, true,
                        ),
                    ],
                    data: vec![CLOSE_ACCOUNT_DISCRIMINATOR],
                },
                &[source.clone(), taking.clone(), payer.clone()],
            )
        }

        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn take_the_input<'info>(
    token_program: &AccountInfo<'info>,
    source: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    vault: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
) -> ProgramResult {
    if amount == 0 {
        return Ok(());
    }
    invoke(
        &transfer_checked_instruction(
            token_program.key,
            source.key,
            mint.key,
            vault.key,
            authority.key,
            amount,
            mint_decimals(mint)?,
        ),
        &[
            source.clone(),
            mint.clone(),
            vault.clone(),
            authority.clone(),
        ],
    )
}

#[allow(clippy::too_many_arguments)]
fn pay_the_output<'info>(
    program_id: &Pubkey,
    token_program: &AccountInfo<'info>,
    vault: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    destination: &AccountInfo<'info>,
    vault_authority: &AccountInfo<'info>,
    amount: u64,
) -> ProgramResult {
    if amount == 0 {
        return Ok(());
    }
    let (_, authority_bump) = Pubkey::find_program_address(&[SWAP_AUTHORITY_SEED], program_id);
    anchor_lang::solana_program::program::invoke_signed(
        &transfer_checked_instruction(
            token_program.key,
            vault.key,
            mint.key,
            destination.key,
            vault_authority.key,
            amount,
            mint_decimals(mint)?,
        ),
        &[
            vault.clone(),
            mint.clone(),
            destination.clone(),
            vault_authority.clone(),
        ],
        &[&[SWAP_AUTHORITY_SEED, &[authority_bump]]],
    )
}

fn token_account_amount(account: &AccountInfo) -> Result<u64, ProgramError> {
    let data = account.try_borrow_data()?;
    let bytes = data.get(64..72).ok_or(ProgramError::InvalidAccountData)?;
    let mut buffer = [0u8; 8];
    buffer.copy_from_slice(bytes);
    Ok(u64::from_le_bytes(buffer))
}

fn read_u64(instruction_data: &[u8], offset: usize) -> Result<u64, ProgramError> {
    let bytes = instruction_data
        .get(offset..offset + 8)
        .ok_or(ProgramError::InvalidInstructionData)?;
    let mut buffer = [0u8; 8];
    buffer.copy_from_slice(bytes);
    Ok(u64::from_le_bytes(buffer))
}

fn mint_decimals(mint: &AccountInfo) -> Result<u8, ProgramError> {
    let data = mint.try_borrow_data()?;
    data.get(44)
        .copied()
        .ok_or(ProgramError::InvalidAccountData)
}

#[allow(clippy::too_many_arguments)]
fn transfer_checked_instruction(
    token_program: &Pubkey,
    source: &Pubkey,
    mint: &Pubkey,
    destination: &Pubkey,
    authority: &Pubkey,
    amount: u64,
    decimals: u8,
) -> anchor_lang::solana_program::instruction::Instruction {
    let mut data = vec![TRANSFER_CHECKED_DISCRIMINATOR];
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
