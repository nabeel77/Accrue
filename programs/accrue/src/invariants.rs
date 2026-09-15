use anchor_lang::prelude::*;

use crate::constants::{
    is_known_token_program, ASSOCIATED_TOKEN_PROGRAM_ID, JUPITER_V6_PROGRAM_ID,
    KAMINO_FARMS_PROGRAM_ID, KAMINO_LEND_PROGRAM_ID,
};
use crate::error::AccrueError;
use crate::kamino::read_obligation_deposited_amount;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CollateralMovement {
    MustNotMove,
    ExactlyIn(u64),
    ExactlyOut(u64),
}

#[derive(Clone, Copy, Debug)]
pub struct SwapBounds {
    pub amount_in: u64,
    pub minimum_out: u64,
}

#[derive(Clone, Copy, Debug)]
pub enum SwapCheck {
    NoSwapInThisInstruction,
    BoundsCheckedAroundTheCall,
    EndsWithAtLeast {
        source: Pubkey,
        destination: Pubkey,
        bounds: SwapBounds,
    },
}

pub struct InvariantCheck<'a, 'info> {
    pub accounts: &'a PositionAccounts<'info>,
    pub collateral_reserve: &'a Pubkey,
    pub before: &'a PositionLedger,
    pub collateral_movement: CollateralMovement,
    pub swap: SwapCheck,
}

pub struct PositionAccounts<'info> {
    pub position: AccountInfo<'info>,
    pub collateral_token_account: AccountInfo<'info>,
    pub usdc_token_account: AccountInfo<'info>,
    pub destination_token_account: AccountInfo<'info>,
    pub obligation: AccountInfo<'info>,
}

#[derive(Clone, Copy, Debug)]
pub struct PositionLedger {
    pub position_lamports: u64,
    pub collateral_lamports: u64,
    pub usdc_lamports: u64,
    pub destination_lamports: u64,
    pub collateral_balance: u64,
    pub usdc_balance: u64,
    pub destination_balance: u64,
    pub obligation_collateral: u64,
}

pub fn token_account_amount(account: &AccountInfo<'_>) -> Result<u64> {
    require!(
        is_known_token_program(account.owner),
        AccrueError::UnknownTokenProgram
    );
    let data = account.try_borrow_data()?;
    let bytes = data.get(64..72).ok_or(AccrueError::KaminoAccountTooShort)?;
    let mut buffer = [0u8; 8];
    buffer.copy_from_slice(bytes);
    Ok(u64::from_le_bytes(buffer))
}

const TOKEN_ACCOUNT_OWNER_OFFSET: usize = 32;
const TOKEN_ACCOUNT_DELEGATE_TAG_OFFSET: usize = 72;
const TOKEN_ACCOUNT_CLOSE_AUTHORITY_TAG_OFFSET: usize = 129;
const COPTION_NONE: u32 = 0;

fn coption_is_none(data: &[u8], offset: usize) -> Result<bool> {
    let end = offset
        .checked_add(4)
        .ok_or(AccrueError::KaminoAccountTooShort)?;
    let bytes = data
        .get(offset..end)
        .ok_or(AccrueError::KaminoAccountTooShort)?;
    let mut buffer = [0u8; 4];
    buffer.copy_from_slice(bytes);
    Ok(u32::from_le_bytes(buffer) == COPTION_NONE)
}

pub fn assert_the_position_still_holds_its_token_account(
    account: &AccountInfo<'_>,
    position: &Pubkey,
) -> Result<()> {
    require!(
        is_known_token_program(account.owner),
        AccrueError::UnknownTokenProgram
    );
    let data = account.try_borrow_data()?;

    let owner_bytes = data
        .get(TOKEN_ACCOUNT_OWNER_OFFSET..TOKEN_ACCOUNT_OWNER_OFFSET.saturating_add(32))
        .ok_or(AccrueError::KaminoAccountTooShort)?;
    let mut buffer = [0u8; 32];
    buffer.copy_from_slice(owner_bytes);
    require_keys_eq!(
        Pubkey::new_from_array(buffer),
        *position,
        AccrueError::PositionTokenAccountOwnerChanged
    );

    require!(
        coption_is_none(&data, TOKEN_ACCOUNT_DELEGATE_TAG_OFFSET)?,
        AccrueError::PositionTokenAccountHasADelegate
    );
    require!(
        coption_is_none(&data, TOKEN_ACCOUNT_CLOSE_AUTHORITY_TAG_OFFSET)?,
        AccrueError::PositionTokenAccountHasACloseAuthority
    );
    Ok(())
}

pub fn token_account_owner(account: &AccountInfo<'_>) -> Result<Pubkey> {
    require!(
        is_known_token_program(account.owner),
        AccrueError::UnknownTokenProgram
    );
    let data = account.try_borrow_data()?;
    let bytes = data.get(32..64).ok_or(AccrueError::KaminoAccountTooShort)?;
    let mut buffer = [0u8; 32];
    buffer.copy_from_slice(bytes);
    Ok(Pubkey::new_from_array(buffer))
}

pub fn token_account_mint(account: &AccountInfo<'_>) -> Result<Pubkey> {
    require!(
        is_known_token_program(account.owner),
        AccrueError::UnknownTokenProgram
    );
    let data = account.try_borrow_data()?;
    let bytes = data.get(0..32).ok_or(AccrueError::KaminoAccountTooShort)?;
    let mut buffer = [0u8; 32];
    buffer.copy_from_slice(bytes);
    Ok(Pubkey::new_from_array(buffer))
}

pub fn read_position_ledger(
    accounts: &PositionAccounts<'_>,
    collateral_reserve: &Pubkey,
) -> Result<PositionLedger> {
    Ok(PositionLedger {
        position_lamports: accounts.position.lamports(),
        collateral_lamports: accounts.collateral_token_account.lamports(),
        usdc_lamports: accounts.usdc_token_account.lamports(),
        destination_lamports: accounts.destination_token_account.lamports(),
        collateral_balance: token_account_amount(&accounts.collateral_token_account)?,
        usdc_balance: token_account_amount(&accounts.usdc_token_account)?,
        destination_balance: token_account_amount(&accounts.destination_token_account)?,
        obligation_collateral: read_obligation_deposited_amount(
            &accounts.obligation,
            collateral_reserve,
        )?,
    })
}

pub fn assert_swap_route_touches_nothing_it_must_not(
    route_accounts: &[AccountInfo<'_>],
    position_accounts: &PositionAccounts<'_>,
    swap_source: &Pubkey,
    swap_destination: &Pubkey,
) -> Result<()> {
    let position_key = position_accounts.position.key();
    let obligation_key = position_accounts.obligation.key();
    let collateral_key = position_accounts.collateral_token_account.key();
    let usdc_key = position_accounts.usdc_token_account.key();
    let destination_key = position_accounts.destination_token_account.key();

    for account in route_accounts {
        let key = account.key();

        if key == position_key {
            continue;
        }

        require_keys_neq!(
            key,
            obligation_key,
            AccrueError::SwapRouteTouchesAForbiddenAccount
        );
        require_keys_neq!(
            key,
            crate::ID,
            AccrueError::SwapRouteTouchesAForbiddenAccount
        );
        require_keys_neq!(
            key,
            KAMINO_LEND_PROGRAM_ID,
            AccrueError::SwapRouteTouchesAForbiddenAccount
        );
        require_keys_neq!(
            key,
            KAMINO_FARMS_PROGRAM_ID,
            AccrueError::SwapRouteTouchesAForbiddenAccount
        );

        require!(
            *account.owner != crate::ID,
            AccrueError::SwapRouteTouchesAForbiddenAccount
        );
        require!(
            *account.owner != KAMINO_LEND_PROGRAM_ID,
            AccrueError::SwapRouteTouchesAForbiddenAccount
        );

        let touches_our_token_account =
            key == collateral_key || key == usdc_key || key == destination_key;
        if touches_our_token_account {
            let is_part_of_this_swap = key == *swap_source || key == *swap_destination;
            require!(
                is_part_of_this_swap,
                AccrueError::SwapRouteTouchesAForbiddenAccount
            );
        }

        if account.executable {
            let is_allowed_program = key == JUPITER_V6_PROGRAM_ID
                || is_known_token_program(&key)
                || key == ASSOCIATED_TOKEN_PROGRAM_ID
                || key == anchor_lang::solana_program::system_program::ID;
            require!(
                is_allowed_program || !account.is_signer,
                AccrueError::SwapRouteCallsAnUnknownProgram
            );
        }
    }

    Ok(())
}

pub fn assert_invariants_hold(check: &InvariantCheck<'_, '_>) -> Result<()> {
    let accounts = check.accounts;

    require!(
        !accounts.position.data_is_empty(),
        AccrueError::PositionAccountMissing
    );
    require!(
        !accounts.collateral_token_account.data_is_empty(),
        AccrueError::PositionAccountMissing
    );
    require!(
        !accounts.usdc_token_account.data_is_empty(),
        AccrueError::PositionAccountMissing
    );
    require!(
        !accounts.destination_token_account.data_is_empty(),
        AccrueError::PositionAccountMissing
    );

    let position_key = accounts.position.key();
    assert_the_position_still_holds_its_token_account(
        &accounts.collateral_token_account,
        &position_key,
    )?;
    assert_the_position_still_holds_its_token_account(&accounts.usdc_token_account, &position_key)?;
    assert_the_position_still_holds_its_token_account(
        &accounts.destination_token_account,
        &position_key,
    )?;

    let before = check.before;
    let after = read_position_ledger(accounts, check.collateral_reserve)?;

    require!(
        after.position_lamports >= before.position_lamports,
        AccrueError::PositionLamportsTaken
    );
    require!(
        after.collateral_lamports >= before.collateral_lamports,
        AccrueError::PositionLamportsTaken
    );
    require!(
        after.usdc_lamports >= before.usdc_lamports,
        AccrueError::PositionLamportsTaken
    );
    require!(
        after.destination_lamports >= before.destination_lamports,
        AccrueError::PositionLamportsTaken
    );

    match check.collateral_movement {
        CollateralMovement::MustNotMove => {
            require!(
                after.collateral_balance == before.collateral_balance,
                AccrueError::CollateralBalanceMoved
            );
            require!(
                after.obligation_collateral == before.obligation_collateral,
                AccrueError::ObligationCollateralMoved
            );
        }
        CollateralMovement::ExactlyIn(amount) => {
            let expected = before
                .obligation_collateral
                .checked_add(amount)
                .ok_or(AccrueError::MathOverflow)?;
            require!(
                after.obligation_collateral == expected,
                AccrueError::ObligationCollateralMoved
            );
        }
        CollateralMovement::ExactlyOut(amount) => {
            let expected = before
                .obligation_collateral
                .checked_sub(amount)
                .ok_or(AccrueError::MathOverflow)?;
            require!(
                after.obligation_collateral == expected,
                AccrueError::ObligationCollateralMoved
            );
        }
    }

    if let SwapCheck::EndsWithAtLeast {
        source,
        destination,
        bounds,
    } = check.swap
    {
        let spent = balance_change_for(accounts, before, &after, &source, true)?;
        require!(spent <= bounds.amount_in, AccrueError::SwapSpentTooMuch);

        let received = balance_change_for(accounts, before, &after, &destination, false)?;
        require!(
            received >= bounds.minimum_out,
            AccrueError::SwapReturnedTooLittle
        );
    }

    Ok(())
}

fn balance_change_for(
    accounts: &PositionAccounts<'_>,
    before: &PositionLedger,
    after: &PositionLedger,
    account: &Pubkey,
    expect_decrease: bool,
) -> Result<u64> {
    let (before_amount, after_amount) = if *account == accounts.usdc_token_account.key() {
        (before.usdc_balance, after.usdc_balance)
    } else if *account == accounts.destination_token_account.key() {
        (before.destination_balance, after.destination_balance)
    } else if *account == accounts.collateral_token_account.key() {
        (before.collateral_balance, after.collateral_balance)
    } else {
        return Err(AccrueError::TokenLeftForAForbiddenAddress.into());
    };

    if expect_decrease {
        before_amount
            .checked_sub(after_amount)
            .ok_or_else(|| AccrueError::SwapSpentTooMuch.into())
    } else {
        after_amount
            .checked_sub(before_amount)
            .ok_or_else(|| AccrueError::SwapReturnedTooLittle.into())
    }
}
