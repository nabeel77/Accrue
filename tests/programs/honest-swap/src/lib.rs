//! Stands in for the swap router at its own address and fills at the price the caller asks for, so
//! the guard and owner instructions can be exercised without a live route. Used by the LiteSVM
//! suite and deployed to the devnet sandbox, where a pool also carries the rate the sandbox router
//! quotes from.

use anchor_lang::prelude::SolanaSysvar;
use anchor_lang::solana_program::account_info::{next_account_info, AccountInfo};
use anchor_lang::solana_program::entrypoint;
use anchor_lang::solana_program::entrypoint::ProgramResult;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_lang::solana_program::program_error::ProgramError;
use anchor_lang::solana_program::pubkey::Pubkey;
use anchor_lang::solana_program::rent::Rent;
use anchor_lang::solana_program::system_instruction;

pub const SWAP_AUTHORITY_SEED: &[u8] = b"swap";
pub const POOL_SEED: &[u8] = b"pool";

pub const SWAP_INSTRUCTION_DATA_LEN: usize = 16;

pub const INITIALIZE_POOL_TAG: u8 = 0;
pub const FUND_TAG: u8 = 1;
pub const SET_RATE_TAG: u8 = 2;

pub const POOL_MAGIC: [u8; 8] = *b"swappool";
pub const POOL_ACCOUNT_LEN: usize = 185;

const POOL_OFFSET_ADMIN: usize = 8;
const POOL_OFFSET_SOURCE_MINT: usize = 40;
const POOL_OFFSET_DESTINATION_MINT: usize = 72;
const POOL_OFFSET_SOURCE_VAULT: usize = 104;
const POOL_OFFSET_DESTINATION_VAULT: usize = 136;
const POOL_OFFSET_NUMERATOR: usize = 168;
const POOL_OFFSET_DENOMINATOR: usize = 176;
const POOL_OFFSET_BUMP: usize = 184;

const ASSOCIATED_TOKEN_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

entrypoint!(dispatch);

/// The swap is the only instruction whose data is exactly sixteen bytes, so it keeps the shape it
/// has always had and everything added for the sandbox is tagged by a first byte instead.
pub fn dispatch(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.len() == SWAP_INSTRUCTION_DATA_LEN {
        return fill_the_route(program_id, accounts, instruction_data);
    }
    match instruction_data.first() {
        Some(&INITIALIZE_POOL_TAG) => initialize_pool(program_id, accounts, instruction_data),
        Some(&FUND_TAG) => fund(accounts, instruction_data),
        Some(&SET_RATE_TAG) => set_rate(program_id, accounts, instruction_data),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

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

/// Accounts, in order: the payer and admin, the pool account, the vault authority, the input mint,
/// the output mint, the vault that takes the input, the vault that pays the output, the input
/// token program, the output token program, the associated token program, the system program.
/// Data: the tag, then eight bytes of rate numerator and eight of rate denominator.
fn initialize_pool(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let (numerator, denominator) = read_rate(instruction_data)?;

    let account_iterator = &mut accounts.iter();
    let admin = next_account_info(account_iterator)?;
    let pool = next_account_info(account_iterator)?;
    let vault_authority = next_account_info(account_iterator)?;
    let source_mint = next_account_info(account_iterator)?;
    let destination_mint = next_account_info(account_iterator)?;
    let source_vault = next_account_info(account_iterator)?;
    let destination_vault = next_account_info(account_iterator)?;
    let source_token_program = next_account_info(account_iterator)?;
    let destination_token_program = next_account_info(account_iterator)?;
    let associated_token_program = next_account_info(account_iterator)?;
    let system_program = next_account_info(account_iterator)?;

    if !admin.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if associated_token_program.key != &ASSOCIATED_TOKEN_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    require_the_vault_authority(program_id, vault_authority.key)?;

    let pool_bump =
        require_the_pool_address(program_id, pool.key, source_mint.key, destination_mint.key)?;

    for (vault, mint, token_program) in [
        (source_vault, source_mint, source_token_program),
        (
            destination_vault,
            destination_mint,
            destination_token_program,
        ),
    ] {
        invoke(
            &create_associated_token_account_instruction(
                associated_token_program.key,
                admin.key,
                vault.key,
                vault_authority.key,
                mint.key,
                token_program.key,
            ),
            &[
                admin.clone(),
                vault.clone(),
                vault_authority.clone(),
                mint.clone(),
                system_program.clone(),
                token_program.clone(),
            ],
        )?;
    }

    if pool.data_is_empty() {
        let rent = Rent::get()?.minimum_balance(POOL_ACCOUNT_LEN);
        let space =
            u64::try_from(POOL_ACCOUNT_LEN).map_err(|_| ProgramError::ArithmeticOverflow)?;
        invoke_signed(
            &system_instruction::create_account(admin.key, pool.key, rent, space, program_id),
            &[admin.clone(), pool.clone(), system_program.clone()],
            &[&[
                POOL_SEED,
                source_mint.key.as_ref(),
                destination_mint.key.as_ref(),
                &[pool_bump],
            ]],
        )?;
    } else if pool.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }

    let mut data = pool.try_borrow_mut_data()?;
    write_slice(&mut data, 0, &POOL_MAGIC)?;
    write_slice(&mut data, POOL_OFFSET_ADMIN, admin.key.as_ref())?;
    write_slice(&mut data, POOL_OFFSET_SOURCE_MINT, source_mint.key.as_ref())?;
    write_slice(
        &mut data,
        POOL_OFFSET_DESTINATION_MINT,
        destination_mint.key.as_ref(),
    )?;
    write_slice(
        &mut data,
        POOL_OFFSET_SOURCE_VAULT,
        source_vault.key.as_ref(),
    )?;
    write_slice(
        &mut data,
        POOL_OFFSET_DESTINATION_VAULT,
        destination_vault.key.as_ref(),
    )?;
    write_slice(&mut data, POOL_OFFSET_NUMERATOR, &numerator.to_le_bytes())?;
    write_slice(
        &mut data,
        POOL_OFFSET_DENOMINATOR,
        &denominator.to_le_bytes(),
    )?;
    write_slice(&mut data, POOL_OFFSET_BUMP, &[pool_bump])?;
    Ok(())
}

/// Accounts, in order: the funder, the token account it pays from, the vault it fills, the mint,
/// the token program. Data: the tag then eight bytes of amount.
fn fund(accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    let amount = read_amount(instruction_data)?;

    let account_iterator = &mut accounts.iter();
    let funder = next_account_info(account_iterator)?;
    let source = next_account_info(account_iterator)?;
    let vault = next_account_info(account_iterator)?;
    let mint = next_account_info(account_iterator)?;
    let token_program = next_account_info(account_iterator)?;

    if !funder.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    invoke(
        &transfer_checked_instruction(
            token_program.key,
            source.key,
            mint.key,
            vault.key,
            funder.key,
            amount,
            mint_decimals(mint)?,
        ),
        &[source.clone(), mint.clone(), vault.clone(), funder.clone()],
    )
}

/// Accounts, in order: the admin, the pool account. Data: the tag, then eight bytes of numerator
/// and eight of denominator.
fn set_rate(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let (numerator, denominator) = read_rate(instruction_data)?;

    let account_iterator = &mut accounts.iter();
    let admin = next_account_info(account_iterator)?;
    let pool = next_account_info(account_iterator)?;

    if !admin.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if pool.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }

    let mut data = pool.try_borrow_mut_data()?;
    if data.get(0..8) != Some(&POOL_MAGIC[..]) {
        return Err(ProgramError::InvalidAccountData);
    }
    if data.get(POOL_OFFSET_ADMIN..POOL_OFFSET_SOURCE_MINT) != Some(admin.key.as_ref()) {
        return Err(ProgramError::MissingRequiredSignature);
    }

    write_slice(&mut data, POOL_OFFSET_NUMERATOR, &numerator.to_le_bytes())?;
    write_slice(
        &mut data,
        POOL_OFFSET_DENOMINATOR,
        &denominator.to_le_bytes(),
    )?;
    Ok(())
}

pub fn pool_address(
    program_id: &Pubkey,
    source_mint: &Pubkey,
    destination_mint: &Pubkey,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[POOL_SEED, source_mint.as_ref(), destination_mint.as_ref()],
        program_id,
    )
}

fn require_the_pool_address(
    program_id: &Pubkey,
    pool: &Pubkey,
    source_mint: &Pubkey,
    destination_mint: &Pubkey,
) -> Result<u8, ProgramError> {
    let (expected, bump) = pool_address(program_id, source_mint, destination_mint);
    if &expected != pool {
        return Err(ProgramError::InvalidSeeds);
    }
    Ok(bump)
}

fn require_the_vault_authority(program_id: &Pubkey, authority: &Pubkey) -> ProgramResult {
    let (expected, _) = Pubkey::find_program_address(&[SWAP_AUTHORITY_SEED], program_id);
    if &expected != authority {
        return Err(ProgramError::InvalidSeeds);
    }
    Ok(())
}

fn write_slice(data: &mut [u8], offset: usize, bytes: &[u8]) -> ProgramResult {
    let end = offset
        .checked_add(bytes.len())
        .ok_or(ProgramError::ArithmeticOverflow)?;
    data.get_mut(offset..end)
        .ok_or(ProgramError::AccountDataTooSmall)?
        .copy_from_slice(bytes);
    Ok(())
}

fn read_amount(instruction_data: &[u8]) -> Result<u64, ProgramError> {
    let bytes = instruction_data
        .get(1..9)
        .ok_or(ProgramError::InvalidInstructionData)?;
    let mut buffer = [0u8; 8];
    buffer.copy_from_slice(bytes);
    Ok(u64::from_le_bytes(buffer))
}

fn read_rate(instruction_data: &[u8]) -> Result<(u64, u64), ProgramError> {
    let numerator = read_amount(instruction_data)?;
    let bytes = instruction_data
        .get(9..17)
        .ok_or(ProgramError::InvalidInstructionData)?;
    let mut buffer = [0u8; 8];
    buffer.copy_from_slice(bytes);
    let denominator = u64::from_le_bytes(buffer);
    if denominator == 0 {
        return Err(ProgramError::InvalidInstructionData);
    }
    Ok((numerator, denominator))
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

fn create_associated_token_account_instruction(
    associated_token_program: &Pubkey,
    payer: &Pubkey,
    associated_account: &Pubkey,
    owner: &Pubkey,
    mint: &Pubkey,
    token_program: &Pubkey,
) -> anchor_lang::solana_program::instruction::Instruction {
    use anchor_lang::solana_program::instruction::AccountMeta;
    anchor_lang::solana_program::instruction::Instruction {
        program_id: *associated_token_program,
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(*associated_account, false),
            AccountMeta::new_readonly(*owner, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(anchor_lang::solana_program::system_program::ID, false),
            AccountMeta::new_readonly(*token_program, false),
        ],
        data: vec![1u8],
    }
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
