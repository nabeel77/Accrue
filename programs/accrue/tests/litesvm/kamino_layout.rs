use std::{collections::HashMap, fs, str::FromStr};

use accrue::kamino::{
    decode_obligation, decode_reserve, ObligationSnapshot, ReserveSnapshot, OBLIGATION_ACCOUNT_LEN,
    RESERVE_ACCOUNT_LEN,
};
use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use serde::Deserialize;
use solana_address::Address;

use crate::snapshot::{fixtures_directory, load_mainnet_snapshot, MainnetSnapshot};

const TOKEN_PROGRAM: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM: &str = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const XSTOCKS_MARKET: &str = "5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua";
const OBLIGATION_FIXTURE_LABEL: &str = "obligation_with_debt";
const ONYC_RESERVE_LABEL: &str = "reserve_onyc_onre_market";
const ONRE_MARKET: &str = "47tfyEG9SsdEnUm9cw5kY9BXngQGqu3LBoop9j5uTAv8";
const SHARED_SCOPE_PRICES: &str = "3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH";
const EMPTY_ADDRESS: &str = "11111111111111111111111111111111";

#[derive(Deserialize)]
struct ExpectedReserve {
    reserve: String,
    symbol: String,
    liquidity_mint: String,
    loan_to_value_pct: u8,
}

#[derive(Deserialize)]
struct ExpectedObligationEntry {
    reserve: String,
    amount: String,
}

#[derive(Deserialize)]
struct ExpectedObligation {
    address: String,
    lending_market: String,
    owner: String,
    deposits: Vec<ExpectedObligationEntry>,
    borrows: Vec<ExpectedObligationEntry>,
}

#[derive(Deserialize)]
struct KaminoExpectedDecoding {
    market: String,
    reserves: Vec<ExpectedReserve>,
    obligation: ExpectedObligation,
}

fn read_expected_decoding() -> Result<KaminoExpectedDecoding> {
    let path = fixtures_directory().join("kamino-expected.json");
    let text = fs::read_to_string(&path).with_context(|| {
        format!(
            "no expected decoding at {}. Run `pnpm fixtures:refresh` first.",
            path.display()
        )
    })?;
    serde_json::from_str(&text).with_context(|| format!("{} is malformed", path.display()))
}

fn decode_fixture_reserve(snapshot: &MainnetSnapshot, label: &str) -> Result<ReserveSnapshot> {
    let fixture = snapshot.account_by_label(label)?;
    let data = BASE64_STANDARD.decode(&fixture.data_base64)?;
    decode_reserve(&data).map_err(|error| anyhow!("{label} did not decode: {error:?}"))
}

fn decode_fixture_obligation(
    snapshot: &MainnetSnapshot,
    label: &str,
) -> Result<ObligationSnapshot> {
    let fixture = snapshot.account_by_label(label)?;
    let data = BASE64_STANDARD.decode(&fixture.data_base64)?;
    decode_obligation(&data).map_err(|error| anyhow!("{label} did not decode: {error:?}"))
}

fn reserve_labels(snapshot: &MainnetSnapshot) -> Vec<String> {
    snapshot
        .accounts
        .iter()
        .filter(|fixture| fixture.label.starts_with("reserve_"))
        .map(|fixture| fixture.label.clone())
        .collect()
}

fn xstocks_market_reserve_labels(snapshot: &MainnetSnapshot) -> Vec<String> {
    reserve_labels(snapshot)
        .into_iter()
        .filter(|label| label != ONYC_RESERVE_LABEL)
        .collect()
}

#[test]
fn every_reserve_fixture_is_exactly_the_length_the_layout_expects() {
    let snapshot = load_mainnet_snapshot().unwrap();
    for label in reserve_labels(&snapshot) {
        let fixture = snapshot.account_by_label(&label).unwrap();
        let data = BASE64_STANDARD.decode(&fixture.data_base64).unwrap();
        assert_eq!(
            data.len(),
            RESERVE_ACCOUNT_LEN,
            "{label} is {} bytes, the layout says {RESERVE_ACCOUNT_LEN}",
            data.len()
        );
    }
}

#[test]
fn the_obligation_fixture_is_exactly_the_length_the_layout_expects() {
    let snapshot = load_mainnet_snapshot().unwrap();
    let fixture = snapshot.account_by_label(OBLIGATION_FIXTURE_LABEL).unwrap();
    let data = BASE64_STANDARD.decode(&fixture.data_base64).unwrap();
    assert_eq!(data.len(), OBLIGATION_ACCOUNT_LEN);
}

#[test]
fn every_reserve_field_matches_what_the_lending_market_reports() {
    let snapshot = load_mainnet_snapshot().unwrap();
    let expected = read_expected_decoding().unwrap();
    assert_eq!(expected.market, XSTOCKS_MARKET);

    let expected_by_reserve: HashMap<&str, &ExpectedReserve> = expected
        .reserves
        .iter()
        .map(|entry| (entry.reserve.as_str(), entry))
        .collect();

    let market = Address::from_str(XSTOCKS_MARKET).unwrap();
    let token_program = Address::from_str(TOKEN_PROGRAM).unwrap();
    let token_2022_program = Address::from_str(TOKEN_2022_PROGRAM).unwrap();

    let mut checked = 0;
    for label in xstocks_market_reserve_labels(&snapshot) {
        let fixture = snapshot.account_by_label(&label).unwrap();
        let reserve = decode_fixture_reserve(&snapshot, &label).unwrap();
        let expected_reserve = expected_by_reserve
            .get(fixture.address.as_str())
            .unwrap_or_else(|| panic!("{label} is not in the market's own reserve list"));

        assert_eq!(
            reserve.lending_market, market,
            "{label} points at another market"
        );
        assert_eq!(
            reserve.liquidity_mint.to_string(),
            expected_reserve.liquidity_mint,
            "{label} ({}) decoded the wrong liquidity mint",
            expected_reserve.symbol
        );
        assert_eq!(
            reserve.loan_to_value_pct, expected_reserve.loan_to_value_pct,
            "{label} ({}) decoded the wrong max loan to value",
            expected_reserve.symbol
        );
        assert!(
            reserve.liquidity_token_program == token_program
                || reserve.liquidity_token_program == token_2022_program,
            "{label} decoded a token program that is neither Token nor Token 2022: {}",
            reserve.liquidity_token_program
        );
        assert!(
            reserve.liquidity_mint_decimals <= 18,
            "{label} decoded {} decimals",
            reserve.liquidity_mint_decimals
        );
        assert!(
            reserve.liquidation_threshold_pct >= reserve.loan_to_value_pct,
            "{label} decoded a liquidation threshold under the max loan to value"
        );
        assert!(
            reserve.liquidation_threshold_pct <= 100,
            "{label} decoded a liquidation threshold above 100 percent"
        );
        assert_ne!(
            reserve.collateral_mint,
            Address::default(),
            "{label} decoded an empty collateral mint"
        );
        assert!(
            reserve.last_update_slot > 0 && reserve.last_update_slot <= snapshot.slot,
            "{label} decoded a last update slot outside the snapshot"
        );
        checked += 1;
    }

    assert!(checked >= 11, "expected every reserve, checked {checked}");
}

#[test]
fn the_obligation_decodes_to_the_same_deposits_and_borrows_the_market_reports() {
    let snapshot = load_mainnet_snapshot().unwrap();
    let expected = read_expected_decoding().unwrap();
    let obligation = decode_fixture_obligation(&snapshot, OBLIGATION_FIXTURE_LABEL).unwrap();
    let fixture = snapshot.account_by_label(OBLIGATION_FIXTURE_LABEL).unwrap();

    assert_eq!(fixture.address, expected.obligation.address);
    assert_eq!(
        obligation.lending_market.to_string(),
        expected.obligation.lending_market
    );
    assert_eq!(obligation.owner.to_string(), expected.obligation.owner);
    assert!(obligation.has_debt, "the fixture must carry a loan");

    let decoded_deposits: Vec<(String, u64)> = obligation
        .deposits
        .iter()
        .filter(|deposit| deposit.deposit_reserve.to_string() != EMPTY_ADDRESS)
        .map(|deposit| {
            (
                deposit.deposit_reserve.to_string(),
                deposit.deposited_amount,
            )
        })
        .collect();
    let expected_deposits: Vec<(String, u64)> = expected
        .obligation
        .deposits
        .iter()
        .map(|entry| (entry.reserve.clone(), entry.amount.parse().unwrap()))
        .collect();
    assert_eq!(decoded_deposits, expected_deposits);

    let decoded_borrow_reserves: Vec<String> = obligation
        .borrows
        .iter()
        .filter(|borrow| borrow.borrow_reserve.to_string() != EMPTY_ADDRESS)
        .map(|borrow| borrow.borrow_reserve.to_string())
        .collect();
    let expected_borrow_reserves: Vec<String> = expected
        .obligation
        .borrows
        .iter()
        .map(|entry| entry.reserve.clone())
        .collect();
    assert_eq!(decoded_borrow_reserves, expected_borrow_reserves);
}

#[test]
fn the_obligation_totals_agree_with_the_entries_they_are_made_of() {
    let snapshot = load_mainnet_snapshot().unwrap();
    let obligation = decode_fixture_obligation(&snapshot, OBLIGATION_FIXTURE_LABEL).unwrap();

    let summed_deposits: u128 = obligation
        .deposits
        .iter()
        .map(|deposit| deposit.market_value_scaled)
        .sum();
    assert_eq!(
        summed_deposits, obligation.deposited_value_scaled,
        "the deposit entries do not add up to the deposited total, so an offset is wrong"
    );

    let summed_borrows: u128 = obligation
        .borrows
        .iter()
        .map(|borrow| borrow.market_value_scaled)
        .sum();
    assert_eq!(
        summed_borrows, obligation.borrowed_assets_market_value_scaled,
        "the borrow entries do not add up to the borrowed total, so an offset is wrong"
    );

    assert!(
        obligation.allowed_borrow_value_scaled < obligation.unhealthy_borrow_value_scaled,
        "the allowed borrow value must sit under the unhealthy one"
    );
    assert!(
        obligation.allowed_borrow_value_scaled < obligation.deposited_value_scaled,
        "the allowed borrow value must sit under the deposited value"
    );
}

#[test]
fn the_loan_to_value_the_guard_reads_matches_the_obligation_totals() {
    let snapshot = load_mainnet_snapshot().unwrap();
    let obligation = decode_fixture_obligation(&snapshot, OBLIGATION_FIXTURE_LABEL).unwrap();

    let loan_to_value_bps = obligation.loan_to_value_bps().unwrap();
    let expected_bps = u16::try_from(
        obligation
            .borrowed_assets_market_value_scaled
            .checked_mul(10_000)
            .unwrap()
            / obligation.deposited_value_scaled,
    )
    .unwrap();

    assert_eq!(loan_to_value_bps, expected_bps);
    assert!(
        loan_to_value_bps > 0 && loan_to_value_bps < 10_000,
        "a live obligation should sit between zero and full"
    );
}

#[test]
fn the_nvdax_reserve_decodes_the_numbers_the_product_is_built_on() {
    let snapshot = load_mainnet_snapshot().unwrap();
    let reserve = decode_fixture_reserve(&snapshot, "reserve_nvdax").unwrap();

    assert_eq!(
        reserve.liquidity_mint.to_string(),
        "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh"
    );
    assert_eq!(
        reserve.liquidity_token_program.to_string(),
        TOKEN_2022_PROGRAM,
        "the stock tokens are Token 2022 mints"
    );
    assert_eq!(reserve.loan_to_value_pct, 55);
    assert_eq!(reserve.max_loan_to_value_bps().unwrap(), 5_500);
    assert_eq!(
        reserve.liquidation_threshold_bps().unwrap(),
        u16::from(reserve.liquidation_threshold_pct) * 100
    );
    assert!(reserve.is_active());
    assert!(!reserve.is_flagged_for_exit());
}

#[test]
fn the_usdc_reserve_decodes_as_the_borrow_side() {
    let snapshot = load_mainnet_snapshot().unwrap();
    let reserve = decode_fixture_reserve(&snapshot, "reserve_usdc").unwrap();

    assert_eq!(
        reserve.liquidity_mint.to_string(),
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    );
    assert_eq!(reserve.liquidity_token_program.to_string(), TOKEN_PROGRAM);
    assert_eq!(reserve.liquidity_mint_decimals, 6);
    assert!(
        reserve.liquidity_available_amount > 0,
        "there must be USDC left to borrow"
    );
    assert!(reserve.borrow_limit > 0);
    assert_eq!(
        reserve.borrow_factor_pct, 100,
        "the market weights USDC debt at one for one today"
    );
    assert_eq!(reserve.borrow_factor_pct().unwrap(), 100);
}

#[test]
fn every_reserve_reports_the_borrow_factor_the_market_weights_its_debt_by() {
    let snapshot = load_mainnet_snapshot().unwrap();

    for label in xstocks_market_reserve_labels(&snapshot) {
        let reserve = decode_fixture_reserve(&snapshot, &label).unwrap();
        assert!(
            reserve.borrow_factor_pct >= 100 && reserve.borrow_factor_pct <= 1_000,
            "{label} decoded a borrow factor of {}, which is outside anything the market uses",
            reserve.borrow_factor_pct
        );
    }

    let stock = decode_fixture_reserve(&snapshot, "reserve_nvdax").unwrap();
    assert_eq!(
        stock.borrow_factor_pct, 225,
        "a stock reserve weights its debt well above one, which is why the guard has to divide by it"
    );
}

#[test]
fn a_reserve_reports_the_limit_timestamps_a_deleveraging_would_set() {
    let snapshot = load_mainnet_snapshot().unwrap();

    for label in ["reserve_usdc", "reserve_nvdax", "reserve_spyx"] {
        let reserve = decode_fixture_reserve(&snapshot, label).unwrap();
        assert_eq!(
            reserve.deposit_limit_crossed_timestamp, 0,
            "{label} has not crossed its deposit limit"
        );
        assert_eq!(
            reserve.borrow_limit_crossed_timestamp, 0,
            "{label} has not crossed its borrow limit"
        );
        assert!(!reserve.is_being_deleveraged());
    }

    let retired = decode_fixture_reserve(&snapshot, "reserve_metax").unwrap();
    assert_eq!(
        retired.deposit_limit_crossed_timestamp, 1_753_830_774,
        "the retired reserve records the moment it crossed its deposit limit, which is what proves the offset"
    );
}

#[test]
fn a_reserve_without_farms_reports_no_farms() {
    let snapshot = load_mainnet_snapshot().unwrap();
    let reserve = decode_fixture_reserve(&snapshot, "reserve_nvdax").unwrap();

    assert_eq!(
        reserve.has_collateral_farm(),
        reserve.farm_collateral != Address::default()
    );
    assert_eq!(
        reserve.has_debt_farm(),
        reserve.farm_debt != Address::default()
    );
}

#[test]
fn a_reserve_shorter_than_the_layout_is_refused() {
    let snapshot = load_mainnet_snapshot().unwrap();
    let fixture = snapshot.account_by_label("reserve_nvdax").unwrap();
    let mut data = BASE64_STANDARD.decode(&fixture.data_base64).unwrap();
    data.truncate(RESERVE_ACCOUNT_LEN - 1);

    assert!(
        decode_reserve(&data).is_err(),
        "a truncated reserve must be refused, never decoded from whatever is there"
    );
}

#[test]
fn an_obligation_shorter_than_the_layout_is_refused() {
    let snapshot = load_mainnet_snapshot().unwrap();
    let fixture = snapshot.account_by_label(OBLIGATION_FIXTURE_LABEL).unwrap();
    let mut data = BASE64_STANDARD.decode(&fixture.data_base64).unwrap();
    data.truncate(OBLIGATION_ACCOUNT_LEN - 1);

    assert!(decode_obligation(&data).is_err());
}

#[test]
fn the_onyc_reserve_carries_its_own_market_and_price_feed() {
    let snapshot = load_mainnet_snapshot().unwrap();
    let reserve = decode_fixture_reserve(&snapshot, ONYC_RESERVE_LABEL).unwrap();

    assert_eq!(
        reserve.lending_market.to_string(),
        ONRE_MARKET,
        "ONyc has no reserve on the xStocks market, so this one must come from the OnRe market"
    );
    assert_eq!(
        reserve.liquidity_mint.to_string(),
        "5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5"
    );
    assert_eq!(reserve.liquidity_token_program.to_string(), TOKEN_PROGRAM);
    assert_eq!(reserve.liquidity_mint_decimals, 9);
    assert_eq!(
        reserve.scope_price_account().unwrap().to_string(),
        SHARED_SCOPE_PRICES,
        "ONyc prices through the same Scope account as the stocks today"
    );
    assert_eq!(reserve.scope_feed_index().unwrap(), 350);
}

#[test]
fn every_stock_reserve_names_the_scope_feed_the_guard_will_read() {
    let snapshot = load_mainnet_snapshot().unwrap();

    for label in xstocks_market_reserve_labels(&snapshot) {
        let reserve = decode_fixture_reserve(&snapshot, &label).unwrap();
        assert_eq!(
            reserve.scope_price_account().unwrap().to_string(),
            SHARED_SCOPE_PRICES,
            "{label} prices through a Scope account the config does not expect"
        );
        assert_ne!(
            reserve.scope_feed_index().unwrap(),
            u16::MAX,
            "{label} has no Scope feed index"
        );
    }
}
