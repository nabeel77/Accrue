use anchor_lang::prelude::*;

declare_id!("5Dgwh9uaimvaibD6xNxsE2yMRGRvbnq6ssVtTouAhLbA");

pub const ORACLE_PRICES_DISCRIMINATOR: [u8; 8] = [89, 128, 118, 221, 6, 72, 180, 146];
pub const ORACLE_PRICES_LEN: usize = 28_712;
pub const MAX_FEEDS: usize = 512;

const OFFSET_FIRST_PRICE: usize = 40;
const DATED_PRICE_LEN: usize = 56;
const DATED_PRICE_VALUE: usize = 0;
const DATED_PRICE_EXPONENT: usize = 8;
const DATED_PRICE_LAST_UPDATED_SLOT: usize = 16;
const DATED_PRICE_UNIX_TIMESTAMP: usize = 24;

pub const ADMIN_SEED: &[u8] = b"admin";

#[error_code]
pub enum PriceFeedError {
    #[msg("That prices account is not the length an OraclePrices account is")]
    WrongLength,
    #[msg("That prices account already carries a discriminator")]
    AlreadyInitialised,
    #[msg("That prices account does not carry the OraclePrices discriminator")]
    NotAPricesAccount,
    #[msg("That feed index is past the end of the account")]
    FeedIndexOutOfRange,
    #[msg("A price of zero would make every value computed from it meaningless")]
    PriceIsZero,
    #[msg("Arithmetic overflowed")]
    MathOverflow,
}

#[account]
#[derive(InitSpace)]
pub struct PricesAdmin {
    pub admin: Pubkey,
    pub prices: Pubkey,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct PriceUpdate {
    pub feed_index: u16,
    pub value: u64,
    pub exponent: u64,
}

#[program]
pub mod price_feed {
    use super::*;

    pub fn initialize(context: Context<Initialize>) -> Result<()> {
        let prices = &context.accounts.prices;
        let mut data = prices.try_borrow_mut_data()?;
        require!(data.len() == ORACLE_PRICES_LEN, PriceFeedError::WrongLength);

        let head = data.get_mut(0..8).ok_or(PriceFeedError::WrongLength)?;
        require!(head == [0u8; 8], PriceFeedError::AlreadyInitialised);
        head.copy_from_slice(&ORACLE_PRICES_DISCRIMINATOR);

        let admin = &mut context.accounts.prices_admin;
        admin.admin = context.accounts.admin.key();
        admin.prices = prices.key();
        admin.bump = context.bumps.prices_admin;
        Ok(())
    }

    pub fn set_prices(context: Context<SetPrices>, updates: Vec<PriceUpdate>) -> Result<()> {
        let clock = Clock::get()?;
        let prices = &context.accounts.prices;
        let mut data = prices.try_borrow_mut_data()?;
        require!(data.len() == ORACLE_PRICES_LEN, PriceFeedError::WrongLength);
        require!(
            data.get(0..8) == Some(&ORACLE_PRICES_DISCRIMINATOR[..]),
            PriceFeedError::NotAPricesAccount
        );

        for update in updates {
            require!(update.value > 0, PriceFeedError::PriceIsZero);
            let index = usize::from(update.feed_index);
            require!(index < MAX_FEEDS, PriceFeedError::FeedIndexOutOfRange);

            let base = OFFSET_FIRST_PRICE
                .checked_add(
                    index
                        .checked_mul(DATED_PRICE_LEN)
                        .ok_or(PriceFeedError::MathOverflow)?,
                )
                .ok_or(PriceFeedError::MathOverflow)?;

            write_unsigned(&mut data, base + DATED_PRICE_VALUE, update.value)?;
            write_unsigned(&mut data, base + DATED_PRICE_EXPONENT, update.exponent)?;
            write_unsigned(&mut data, base + DATED_PRICE_LAST_UPDATED_SLOT, clock.slot)?;
            write_unsigned(
                &mut data,
                base + DATED_PRICE_UNIX_TIMESTAMP,
                u64::try_from(clock.unix_timestamp).map_err(|_| PriceFeedError::MathOverflow)?,
            )?;
        }
        Ok(())
    }
}

fn write_unsigned(data: &mut [u8], offset: usize, value: u64) -> Result<()> {
    let end = offset.checked_add(8).ok_or(PriceFeedError::MathOverflow)?;
    data.get_mut(offset..end)
        .ok_or(PriceFeedError::FeedIndexOutOfRange)?
        .copy_from_slice(&value.to_le_bytes());
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: allocated by the caller at the length an OraclePrices account is, owned by this
    /// program, and given its discriminator here
    #[account(mut, owner = crate::ID)]
    pub prices: UncheckedAccount<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + PricesAdmin::INIT_SPACE,
        seeds = [ADMIN_SEED, prices.key().as_ref()],
        bump,
    )]
    pub prices_admin: Account<'info, PricesAdmin>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPrices<'info> {
    pub admin: Signer<'info>,

    /// CHECK: matched against the account the admin record was created for
    #[account(mut, owner = crate::ID, address = prices_admin.prices @ PriceFeedError::NotAPricesAccount)]
    pub prices: UncheckedAccount<'info>,

    #[account(
        seeds = [ADMIN_SEED, prices.key().as_ref()],
        bump = prices_admin.bump,
        has_one = admin @ PriceFeedError::NotAPricesAccount,
    )]
    pub prices_admin: Account<'info, PricesAdmin>,
}
