use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;

use super::generated::instructions::{
    BorrowObligationLiquidity, BorrowObligationLiquidityInstructionArgs,
    DepositReserveLiquidityAndObligationCollateral,
    DepositReserveLiquidityAndObligationCollateralInstructionArgs, InitObligation,
    InitObligationInstructionArgs, InitUserMetadata, InitUserMetadataInstructionArgs,
    RefreshObligation, RefreshReserve, RepayObligationLiquidity,
    RepayObligationLiquidityInstructionArgs,
    WithdrawObligationCollateralAndRedeemReserveCollateral,
    WithdrawObligationCollateralAndRedeemReserveCollateralInstructionArgs,
};

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
    pub rent: AccountInfo<'info>,
    pub system_program: AccountInfo<'info>,
}

pub struct InitUserMetadataAccounts<'info> {
    pub user_metadata: AccountInfo<'info>,
    pub fee_payer: AccountInfo<'info>,
    pub position: AccountInfo<'info>,
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
    remaining_reserves: &[AccountInfo<'info>],
) -> Result<()> {
    let mut instruction = RefreshObligation {
        lending_market: lending_market.key(),
        obligation: obligation.key(),
    }
    .instruction();

    let mut account_infos = vec![lending_market.clone(), obligation.clone()];
    for reserve in remaining_reserves {
        instruction
            .accounts
            .push(solana_instruction::AccountMeta::new(reserve.key(), false));
        account_infos.push(reserve.clone());
    }

    invoke_signed(&instruction, &account_infos, &[])?;
    Ok(())
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
    amount: u64,
    position_seeds: &[&[u8]],
) -> Result<()> {
    let instruction = DepositReserveLiquidityAndObligationCollateral {
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
    }
    .instruction(
        DepositReserveLiquidityAndObligationCollateralInstructionArgs {
            liquidity_amount: amount,
        },
    );

    invoke_signed(
        &instruction,
        &[
            obligation.position.clone(),
            obligation.obligation.clone(),
            obligation.lending_market.clone(),
            obligation.lending_market_authority.clone(),
            accounts.reserve.clone(),
            accounts.reserve_liquidity_mint.clone(),
            accounts.reserve_liquidity_supply.clone(),
            accounts.reserve_collateral_mint.clone(),
            accounts.reserve_destination_deposit_collateral.clone(),
            accounts.source_liquidity.clone(),
            accounts.collateral_token_program.clone(),
            accounts.liquidity_token_program.clone(),
            accounts.instruction_sysvar.clone(),
        ],
        &[position_seeds],
    )?;
    Ok(())
}

pub fn borrow_liquidity<'info>(
    obligation: &ObligationContext<'info>,
    accounts: &BorrowAccounts<'info>,
    amount: u64,
    position_seeds: &[&[u8]],
) -> Result<()> {
    let instruction = BorrowObligationLiquidity {
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
    }
    .instruction(BorrowObligationLiquidityInstructionArgs {
        liquidity_amount: amount,
    });

    invoke_signed(
        &instruction,
        &[
            obligation.position.clone(),
            obligation.obligation.clone(),
            obligation.lending_market.clone(),
            obligation.lending_market_authority.clone(),
            accounts.reserve.clone(),
            accounts.reserve_liquidity_mint.clone(),
            accounts.reserve_source_liquidity.clone(),
            accounts.fee_receiver.clone(),
            accounts.destination_liquidity.clone(),
            accounts.token_program.clone(),
            accounts.instruction_sysvar.clone(),
        ],
        &[position_seeds],
    )?;
    Ok(())
}

pub fn repay_liquidity<'info>(
    obligation: &ObligationContext<'info>,
    accounts: &RepayAccounts<'info>,
    amount: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let instruction = RepayObligationLiquidity {
        owner: obligation.position.key(),
        obligation: obligation.obligation.key(),
        lending_market: obligation.lending_market.key(),
        repay_reserve: accounts.reserve.key(),
        reserve_liquidity_mint: accounts.reserve_liquidity_mint.key(),
        reserve_destination_liquidity: accounts.reserve_destination_liquidity.key(),
        user_source_liquidity: accounts.source_liquidity.key(),
        token_program: accounts.token_program.key(),
        instruction_sysvar_account: accounts.instruction_sysvar.key(),
    }
    .instruction(RepayObligationLiquidityInstructionArgs {
        liquidity_amount: amount,
    });

    invoke_signed(
        &instruction,
        &[
            obligation.position.clone(),
            obligation.obligation.clone(),
            obligation.lending_market.clone(),
            accounts.reserve.clone(),
            accounts.reserve_liquidity_mint.clone(),
            accounts.reserve_destination_liquidity.clone(),
            accounts.source_liquidity.clone(),
            accounts.token_program.clone(),
            accounts.instruction_sysvar.clone(),
        ],
        signer_seeds,
    )?;
    Ok(())
}

pub fn withdraw_collateral<'info>(
    obligation: &ObligationContext<'info>,
    accounts: &WithdrawAccounts<'info>,
    collateral_amount: u64,
    position_seeds: &[&[u8]],
) -> Result<()> {
    let instruction = WithdrawObligationCollateralAndRedeemReserveCollateral {
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
    }
    .instruction(
        WithdrawObligationCollateralAndRedeemReserveCollateralInstructionArgs { collateral_amount },
    );

    invoke_signed(
        &instruction,
        &[
            obligation.position.clone(),
            obligation.obligation.clone(),
            obligation.lending_market.clone(),
            obligation.lending_market_authority.clone(),
            accounts.reserve.clone(),
            accounts.reserve_liquidity_mint.clone(),
            accounts.reserve_source_collateral.clone(),
            accounts.reserve_collateral_mint.clone(),
            accounts.reserve_liquidity_supply.clone(),
            accounts.destination_liquidity.clone(),
            accounts.collateral_token_program.clone(),
            accounts.liquidity_token_program.clone(),
            accounts.instruction_sysvar.clone(),
        ],
        &[position_seeds],
    )?;
    Ok(())
}
