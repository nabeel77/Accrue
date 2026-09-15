use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;

use crate::error::AccrueError;

use super::generated::instructions::{
    BorrowObligationLiquidityV2, BorrowObligationLiquidityV2InstructionArgs,
    DepositReserveLiquidityAndObligationCollateralV2,
    DepositReserveLiquidityAndObligationCollateralV2InstructionArgs, InitObligation,
    InitObligationFarmsForReserve, InitObligationFarmsForReserveInstructionArgs,
    InitObligationInstructionArgs, InitUserMetadata, InitUserMetadataInstructionArgs,
    RefreshObligation, RefreshReserve, RepayObligationLiquidityV2,
    RepayObligationLiquidityV2InstructionArgs,
    WithdrawObligationCollateralAndRedeemReserveCollateralV2,
    WithdrawObligationCollateralAndRedeemReserveCollateralV2InstructionArgs,
};

pub const FARM_MODE_COLLATERAL: u8 = 0;
pub const FARM_MODE_DEBT: u8 = 1;

pub struct ReserveRefresh<'info> {
    pub reserve: AccountInfo<'info>,
    pub lending_market: AccountInfo<'info>,
    pub scope_prices: AccountInfo<'info>,
}

pub struct ObligationContext<'info> {
    pub obligation: AccountInfo<'info>,
    pub lending_market: AccountInfo<'info>,
    pub lending_market_authority: AccountInfo<'info>,
    pub position: AccountInfo<'info>,
    pub kamino_program: AccountInfo<'info>,
}

pub struct FarmAccounts<'info> {
    pub reserve_farm_state: Option<AccountInfo<'info>>,
    pub obligation_farm_user_state: Option<AccountInfo<'info>>,
    pub farms_program: AccountInfo<'info>,
}

impl<'info> FarmAccounts<'info> {
    fn keys(&self) -> (Option<Pubkey>, Option<Pubkey>) {
        (
            self.obligation_farm_user_state
                .as_ref()
                .map(|account| account.key()),
            self.reserve_farm_state
                .as_ref()
                .map(|account| account.key()),
        )
    }

    fn account_infos(&self) -> Vec<AccountInfo<'info>> {
        let mut infos = vec![self.farms_program.clone()];
        if let Some(account) = &self.reserve_farm_state {
            infos.push(account.clone());
        }
        if let Some(account) = &self.obligation_farm_user_state {
            infos.push(account.clone());
        }
        infos
    }
}

pub fn farm_accounts_for_reserve<'info>(
    reserve_farm: Pubkey,
    reserve_farm_state: Option<AccountInfo<'info>>,
    obligation_farm_user_state: Option<AccountInfo<'info>>,
    farms_program: AccountInfo<'info>,
) -> Result<FarmAccounts<'info>> {
    if reserve_farm == Pubkey::default() {
        require!(
            reserve_farm_state.is_none() && obligation_farm_user_state.is_none(),
            AccrueError::ReserveNamesNoFarm
        );
        return Ok(FarmAccounts {
            reserve_farm_state: None,
            obligation_farm_user_state: None,
            farms_program,
        });
    }

    let reserve_farm_state = reserve_farm_state.ok_or(AccrueError::FarmAccountMissing)?;
    require_keys_eq!(
        reserve_farm_state.key(),
        reserve_farm,
        AccrueError::WrongFarmAccount
    );
    let obligation_farm_user_state =
        obligation_farm_user_state.ok_or(AccrueError::FarmAccountMissing)?;

    Ok(FarmAccounts {
        reserve_farm_state: Some(reserve_farm_state),
        obligation_farm_user_state: Some(obligation_farm_user_state),
        farms_program,
    })
}

pub struct DepositAccounts<'info> {
    pub reserve: AccountInfo<'info>,
    pub reserve_liquidity_mint: AccountInfo<'info>,
    pub reserve_liquidity_supply: AccountInfo<'info>,
    pub reserve_collateral_mint: AccountInfo<'info>,
    pub reserve_destination_deposit_collateral: AccountInfo<'info>,
    pub source_liquidity: AccountInfo<'info>,
    pub collateral_token_program: AccountInfo<'info>,
    pub liquidity_token_program: AccountInfo<'info>,
    pub instruction_sysvar: AccountInfo<'info>,
}

pub struct BorrowAccounts<'info> {
    pub reserve: AccountInfo<'info>,
    pub reserve_liquidity_mint: AccountInfo<'info>,
    pub reserve_source_liquidity: AccountInfo<'info>,
    pub fee_receiver: AccountInfo<'info>,
    pub destination_liquidity: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
    pub instruction_sysvar: AccountInfo<'info>,
}

pub struct RepayAccounts<'info> {
    pub reserve: AccountInfo<'info>,
    pub reserve_liquidity_mint: AccountInfo<'info>,
    pub reserve_destination_liquidity: AccountInfo<'info>,
    pub source_liquidity: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
    pub instruction_sysvar: AccountInfo<'info>,
}

pub struct WithdrawAccounts<'info> {
    pub reserve: AccountInfo<'info>,
    pub reserve_liquidity_mint: AccountInfo<'info>,
    pub reserve_source_collateral: AccountInfo<'info>,
    pub reserve_collateral_mint: AccountInfo<'info>,
    pub reserve_liquidity_supply: AccountInfo<'info>,
    pub destination_liquidity: AccountInfo<'info>,
    pub collateral_token_program: AccountInfo<'info>,
    pub liquidity_token_program: AccountInfo<'info>,
    pub instruction_sysvar: AccountInfo<'info>,
}

pub struct InitObligationAccounts<'info> {
    pub obligation: AccountInfo<'info>,
    pub lending_market: AccountInfo<'info>,
    pub seed1_account: AccountInfo<'info>,
    pub seed2_account: AccountInfo<'info>,
    pub owner_user_metadata: AccountInfo<'info>,
    pub fee_payer: AccountInfo<'info>,
    pub position: AccountInfo<'info>,
    pub kamino_program: AccountInfo<'info>,
    pub rent: AccountInfo<'info>,
    pub system_program: AccountInfo<'info>,
}

pub struct InitUserMetadataAccounts<'info> {
    pub user_metadata: AccountInfo<'info>,
    pub fee_payer: AccountInfo<'info>,
    pub position: AccountInfo<'info>,
    pub kamino_program: AccountInfo<'info>,
    pub rent: AccountInfo<'info>,
    pub system_program: AccountInfo<'info>,
}

pub struct InitObligationFarmAccounts<'info> {
    pub fee_payer: AccountInfo<'info>,
    pub obligation: AccountInfo<'info>,
    pub lending_market: AccountInfo<'info>,
    pub lending_market_authority: AccountInfo<'info>,
    pub reserve: AccountInfo<'info>,
    pub reserve_farm_state: AccountInfo<'info>,
    pub obligation_farm_user_state: AccountInfo<'info>,
    pub position: AccountInfo<'info>,
    pub farms_program: AccountInfo<'info>,
    pub rent: AccountInfo<'info>,
    pub system_program: AccountInfo<'info>,
}

pub fn refresh_reserve<'info>(
    refresh: &ReserveRefresh<'info>,
    kamino_program: &AccountInfo<'info>,
) -> Result<()> {
    let instruction = RefreshReserve {
        reserve: refresh.reserve.key(),
        lending_market: refresh.lending_market.key(),
        pyth_oracle: None,
        switchboard_price_oracle: None,
        switchboard_twap_oracle: None,
        scope_prices: Some(refresh.scope_prices.key()),
    }
    .instruction();

    invoke_signed(
        &instruction,
        &[
            refresh.reserve.clone(),
            refresh.lending_market.clone(),
            kamino_program.clone(),
            refresh.scope_prices.clone(),
        ],
        &[],
    )?;
    Ok(())
}

pub fn refresh_obligation<'info>(
    obligation: &AccountInfo<'info>,
    lending_market: &AccountInfo<'info>,
    known_reserves: &[AccountInfo<'info>],
) -> Result<()> {
    let wanted = super::read_obligation_reserves_in_order(obligation)?;
    let mut ordered_reserves: Vec<AccountInfo<'info>> = Vec::with_capacity(wanted.len());
    for reserve in &wanted {
        ordered_reserves.push(find_reserve(known_reserves, reserve)?);
    }

    let mut instruction = RefreshObligation {
        lending_market: lending_market.key(),
        obligation: obligation.key(),
    }
    .instruction();

    let mut account_infos = vec![lending_market.clone(), obligation.clone()];
    for reserve in ordered_reserves {
        instruction
            .accounts
            .push(solana_instruction::AccountMeta::new(reserve.key(), false));
        account_infos.push(reserve);
    }

    invoke_signed(&instruction, &account_infos, &[])?;
    Ok(())
}

fn find_reserve<'info>(
    known_reserves: &[AccountInfo<'info>],
    wanted: &Pubkey,
) -> Result<AccountInfo<'info>> {
    known_reserves
        .iter()
        .find(|reserve| reserve.key() == *wanted)
        .cloned()
        .ok_or_else(|| AccrueError::ObligationNamesAnUnknownReserve.into())
}

pub fn init_user_metadata<'info>(
    accounts: &InitUserMetadataAccounts<'info>,
    position_seeds: &[&[u8]],
) -> Result<()> {
    let instruction = InitUserMetadata {
        owner: accounts.position.key(),
        fee_payer: accounts.fee_payer.key(),
        user_metadata: accounts.user_metadata.key(),
        referrer_user_metadata: None,
        rent: accounts.rent.key(),
        system_program: accounts.system_program.key(),
    }
    .instruction(InitUserMetadataInstructionArgs {
        user_lookup_table: Pubkey::default(),
    });

    invoke_signed(
        &instruction,
        &[
            accounts.position.clone(),
            accounts.fee_payer.clone(),
            accounts.user_metadata.clone(),
            accounts.kamino_program.clone(),
            accounts.rent.clone(),
            accounts.system_program.clone(),
        ],
        &[position_seeds],
    )?;
    Ok(())
}

pub fn init_obligation<'info>(
    accounts: &InitObligationAccounts<'info>,
    position_seeds: &[&[u8]],
) -> Result<()> {
    let instruction = InitObligation {
        obligation_owner: accounts.position.key(),
        fee_payer: accounts.fee_payer.key(),
        obligation: accounts.obligation.key(),
        lending_market: accounts.lending_market.key(),
        seed1_account: accounts.seed1_account.key(),
        seed2_account: accounts.seed2_account.key(),
        owner_user_metadata: accounts.owner_user_metadata.key(),
        rent: accounts.rent.key(),
        system_program: accounts.system_program.key(),
    }
    .instruction(InitObligationInstructionArgs { tag: 0, id: 0 });

    invoke_signed(
        &instruction,
        &[
            accounts.position.clone(),
            accounts.fee_payer.clone(),
            accounts.obligation.clone(),
            accounts.lending_market.clone(),
            accounts.seed1_account.clone(),
            accounts.seed2_account.clone(),
            accounts.owner_user_metadata.clone(),
            accounts.kamino_program.clone(),
            accounts.rent.clone(),
            accounts.system_program.clone(),
        ],
        &[position_seeds],
    )?;
    Ok(())
}

pub fn init_obligation_farm<'info>(
    accounts: &InitObligationFarmAccounts<'info>,
    mode: u8,
    position_seeds: &[&[u8]],
) -> Result<()> {
    let instruction = InitObligationFarmsForReserve {
        payer: accounts.fee_payer.key(),
        owner: accounts.position.key(),
        obligation: accounts.obligation.key(),
        lending_market_authority: accounts.lending_market_authority.key(),
        reserve: accounts.reserve.key(),
        reserve_farm_state: accounts.reserve_farm_state.key(),
        obligation_farm: accounts.obligation_farm_user_state.key(),
        lending_market: accounts.lending_market.key(),
        farms_program: accounts.farms_program.key(),
        rent: accounts.rent.key(),
        system_program: accounts.system_program.key(),
    }
    .instruction(InitObligationFarmsForReserveInstructionArgs { mode });

    invoke_signed(
        &instruction,
        &[
            accounts.fee_payer.clone(),
            accounts.position.clone(),
            accounts.obligation.clone(),
            accounts.lending_market_authority.clone(),
            accounts.reserve.clone(),
            accounts.reserve_farm_state.clone(),
            accounts.obligation_farm_user_state.clone(),
            accounts.lending_market.clone(),
            accounts.farms_program.clone(),
            accounts.rent.clone(),
            accounts.system_program.clone(),
        ],
        &[position_seeds],
    )?;
    Ok(())
}

pub fn deposit_collateral<'info>(
    obligation: &ObligationContext<'info>,
    accounts: &DepositAccounts<'info>,
    farms: &FarmAccounts<'info>,
    amount: u64,
    position_seeds: &[&[u8]],
) -> Result<()> {
    let (obligation_farm_user_state, reserve_farm_state) = farms.keys();
    let instruction = DepositReserveLiquidityAndObligationCollateralV2 {
        owner: obligation.position.key(),
        obligation: obligation.obligation.key(),
        lending_market: obligation.lending_market.key(),
        lending_market_authority: obligation.lending_market_authority.key(),
        reserve: accounts.reserve.key(),
        reserve_liquidity_mint: accounts.reserve_liquidity_mint.key(),
        reserve_liquidity_supply: accounts.reserve_liquidity_supply.key(),
        reserve_collateral_mint: accounts.reserve_collateral_mint.key(),
        reserve_destination_deposit_collateral: accounts
            .reserve_destination_deposit_collateral
            .key(),
        user_source_liquidity: accounts.source_liquidity.key(),
        placeholder_user_destination_collateral: None,
        collateral_token_program: accounts.collateral_token_program.key(),
        liquidity_token_program: accounts.liquidity_token_program.key(),
        instruction_sysvar_account: accounts.instruction_sysvar.key(),
        obligation_farm_user_state,
        reserve_farm_state,
        farms_program: farms.farms_program.key(),
    }
    .instruction(
        DepositReserveLiquidityAndObligationCollateralV2InstructionArgs {
            liquidity_amount: amount,
        },
    );

    let mut account_infos = vec![
        obligation.position.clone(),
        obligation.obligation.clone(),
        obligation.lending_market.clone(),
        obligation.lending_market_authority.clone(),
        obligation.kamino_program.clone(),
        accounts.reserve.clone(),
        accounts.reserve_liquidity_mint.clone(),
        accounts.reserve_liquidity_supply.clone(),
        accounts.reserve_collateral_mint.clone(),
        accounts.reserve_destination_deposit_collateral.clone(),
        accounts.source_liquidity.clone(),
        accounts.collateral_token_program.clone(),
        accounts.liquidity_token_program.clone(),
        accounts.instruction_sysvar.clone(),
    ];
    account_infos.extend(farms.account_infos());

    invoke_signed(&instruction, &account_infos, &[position_seeds])?;
    Ok(())
}

pub fn borrow_liquidity<'info>(
    obligation: &ObligationContext<'info>,
    accounts: &BorrowAccounts<'info>,
    farms: &FarmAccounts<'info>,
    amount: u64,
    position_seeds: &[&[u8]],
) -> Result<()> {
    let (obligation_farm_user_state, reserve_farm_state) = farms.keys();
    let instruction = BorrowObligationLiquidityV2 {
        owner: obligation.position.key(),
        obligation: obligation.obligation.key(),
        lending_market: obligation.lending_market.key(),
        lending_market_authority: obligation.lending_market_authority.key(),
        borrow_reserve: accounts.reserve.key(),
        borrow_reserve_liquidity_mint: accounts.reserve_liquidity_mint.key(),
        reserve_source_liquidity: accounts.reserve_source_liquidity.key(),
        borrow_reserve_liquidity_fee_receiver: accounts.fee_receiver.key(),
        user_destination_liquidity: accounts.destination_liquidity.key(),
        referrer_token_state: None,
        token_program: accounts.token_program.key(),
        instruction_sysvar_account: accounts.instruction_sysvar.key(),
        obligation_farm_user_state,
        reserve_farm_state,
        farms_program: farms.farms_program.key(),
    }
    .instruction(BorrowObligationLiquidityV2InstructionArgs {
        liquidity_amount: amount,
    });

    let mut account_infos = vec![
        obligation.position.clone(),
        obligation.obligation.clone(),
        obligation.lending_market.clone(),
        obligation.lending_market_authority.clone(),
        obligation.kamino_program.clone(),
        accounts.reserve.clone(),
        accounts.reserve_liquidity_mint.clone(),
        accounts.reserve_source_liquidity.clone(),
        accounts.fee_receiver.clone(),
        accounts.destination_liquidity.clone(),
        accounts.token_program.clone(),
        accounts.instruction_sysvar.clone(),
    ];
    account_infos.extend(farms.account_infos());

    invoke_signed(&instruction, &account_infos, &[position_seeds])?;
    Ok(())
}

pub fn repay_liquidity<'info>(
    obligation: &ObligationContext<'info>,
    accounts: &RepayAccounts<'info>,
    farms: &FarmAccounts<'info>,
    amount: u64,
    position_seeds: &[&[u8]],
) -> Result<()> {
    let (obligation_farm_user_state, reserve_farm_state) = farms.keys();
    let instruction = RepayObligationLiquidityV2 {
        owner: obligation.position.key(),
        obligation: obligation.obligation.key(),
        lending_market: obligation.lending_market.key(),
        repay_reserve: accounts.reserve.key(),
        reserve_liquidity_mint: accounts.reserve_liquidity_mint.key(),
        reserve_destination_liquidity: accounts.reserve_destination_liquidity.key(),
        user_source_liquidity: accounts.source_liquidity.key(),
        token_program: accounts.token_program.key(),
        instruction_sysvar_account: accounts.instruction_sysvar.key(),
        obligation_farm_user_state,
        reserve_farm_state,
        lending_market_authority: obligation.lending_market_authority.key(),
        farms_program: farms.farms_program.key(),
    }
    .instruction(RepayObligationLiquidityV2InstructionArgs {
        liquidity_amount: amount,
    });

    let mut account_infos = vec![
        obligation.position.clone(),
        obligation.obligation.clone(),
        obligation.lending_market.clone(),
        obligation.lending_market_authority.clone(),
        obligation.kamino_program.clone(),
        accounts.reserve.clone(),
        accounts.reserve_liquidity_mint.clone(),
        accounts.reserve_destination_liquidity.clone(),
        accounts.source_liquidity.clone(),
        accounts.token_program.clone(),
        accounts.instruction_sysvar.clone(),
    ];
    account_infos.extend(farms.account_infos());

    invoke_signed(&instruction, &account_infos, &[position_seeds])?;
    Ok(())
}

pub fn withdraw_collateral<'info>(
    obligation: &ObligationContext<'info>,
    accounts: &WithdrawAccounts<'info>,
    farms: &FarmAccounts<'info>,
    collateral_amount: u64,
    position_seeds: &[&[u8]],
) -> Result<()> {
    let (obligation_farm_user_state, reserve_farm_state) = farms.keys();
    let instruction = WithdrawObligationCollateralAndRedeemReserveCollateralV2 {
        owner: obligation.position.key(),
        obligation: obligation.obligation.key(),
        lending_market: obligation.lending_market.key(),
        lending_market_authority: obligation.lending_market_authority.key(),
        withdraw_reserve: accounts.reserve.key(),
        reserve_liquidity_mint: accounts.reserve_liquidity_mint.key(),
        reserve_source_collateral: accounts.reserve_source_collateral.key(),
        reserve_collateral_mint: accounts.reserve_collateral_mint.key(),
        reserve_liquidity_supply: accounts.reserve_liquidity_supply.key(),
        user_destination_liquidity: accounts.destination_liquidity.key(),
        placeholder_user_destination_collateral: None,
        collateral_token_program: accounts.collateral_token_program.key(),
        liquidity_token_program: accounts.liquidity_token_program.key(),
        instruction_sysvar_account: accounts.instruction_sysvar.key(),
        obligation_farm_user_state,
        reserve_farm_state,
        farms_program: farms.farms_program.key(),
    }
    .instruction(
        WithdrawObligationCollateralAndRedeemReserveCollateralV2InstructionArgs {
            collateral_amount,
        },
    );

    let mut account_infos = vec![
        obligation.position.clone(),
        obligation.obligation.clone(),
        obligation.lending_market.clone(),
        obligation.lending_market_authority.clone(),
        obligation.kamino_program.clone(),
        accounts.reserve.clone(),
        accounts.reserve_liquidity_mint.clone(),
        accounts.reserve_source_collateral.clone(),
        accounts.reserve_collateral_mint.clone(),
        accounts.reserve_liquidity_supply.clone(),
        accounts.destination_liquidity.clone(),
        accounts.collateral_token_program.clone(),
        accounts.liquidity_token_program.clone(),
        accounts.instruction_sysvar.clone(),
    ];
    account_infos.extend(farms.account_infos());

    invoke_signed(&instruction, &account_infos, &[position_seeds])?;
    Ok(())
}
