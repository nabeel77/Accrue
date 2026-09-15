use accrue::kamino::{decode_reserve, KAMINO_LEND_PROGRAM_ID};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

use crate::snapshot::{kamino_program_path, load_mainnet_snapshot, MainnetSnapshot};

const SCOPE_PRICES_LABEL: &str = "oracle_scope_prices";
const MARKET_LABEL: &str = "xstocks_market";
const FEE_PAYER_LAMPORTS: u64 = 10_000_000_000;

fn build_refresh_reserve_instruction(
    snapshot: &MainnetSnapshot,
    reserve_label: &str,
) -> solana_instruction::Instruction {
    accrue::kamino::generated::instructions::RefreshReserve {
        reserve: snapshot.address_of(reserve_label).unwrap(),
        lending_market: snapshot.address_of(MARKET_LABEL).unwrap(),
        pyth_oracle: None,
        switchboard_price_oracle: None,
        switchboard_twap_oracle: None,
        scope_prices: Some(snapshot.address_of(SCOPE_PRICES_LABEL).unwrap()),
    }
    .instruction()
}

fn reserve_bytes(snapshot: &MainnetSnapshot, reserve_label: &str) -> Vec<u8> {
    BASE64_STANDARD
        .decode(
            &snapshot
                .account_by_label(reserve_label)
                .unwrap()
                .data_base64,
        )
        .unwrap()
}

#[test]
fn the_deployed_kamino_program_refreshes_a_reserve_on_the_snapshot() {
    let program_path = kamino_program_path();
    assert!(
        program_path.exists(),
        "{} is missing. Run `pnpm fixtures:programs` first.",
        program_path.display()
    );

    let mut snapshot = load_mainnet_snapshot().unwrap();
    snapshot
        .svm
        .add_program_from_file(KAMINO_LEND_PROGRAM_ID, &program_path)
        .unwrap();

    let fee_payer = Keypair::new();
    snapshot
        .svm
        .airdrop(&fee_payer.pubkey(), FEE_PAYER_LAMPORTS)
        .unwrap();

    let reserve_address = snapshot.address_of("reserve_nvdax").unwrap();
    let before = decode_reserve(&reserve_bytes(&snapshot, "reserve_nvdax")).unwrap();

    let instruction = build_refresh_reserve_instruction(&snapshot, "reserve_nvdax");
    let message = Message::new(&[instruction], Some(&fee_payer.pubkey()));
    let transaction = Transaction::new(&[&fee_payer], message, snapshot.svm.latest_blockhash());

    let outcome = snapshot.svm.send_transaction(transaction);
    let landed = outcome.unwrap_or_else(|failure| {
        panic!(
            "refresh_reserve reverted: {:?}\n{:#?}",
            failure.err, failure.meta.logs
        )
    });

    assert!(
        landed
            .logs
            .iter()
            .any(|line| line.contains(&KAMINO_LEND_PROGRAM_ID.to_string())),
        "the deployed lending market program did not run"
    );

    let refreshed_account = snapshot.svm.get_account(&reserve_address).unwrap();
    let after = decode_reserve(&refreshed_account.data).unwrap();

    assert_eq!(after.liquidity_mint, before.liquidity_mint);
    assert_eq!(after.lending_market, before.lending_market);
    assert_eq!(after.loan_to_value_pct, before.loan_to_value_pct);
    assert_eq!(
        after.liquidation_threshold_pct,
        before.liquidation_threshold_pct
    );
    assert!(
        after.last_update_slot >= before.last_update_slot,
        "the refresh must not move the reserve backwards"
    );
    assert!(
        !after.is_stale,
        "a reserve is not stale in the slot it was refreshed in"
    );
    assert!(
        after.liquidity_market_price_scaled > 0,
        "the refresh must leave a price the guard can read"
    );
}

#[test]
fn refreshing_the_usdc_reserve_leaves_a_price_near_one_dollar() {
    let mut snapshot = load_mainnet_snapshot().unwrap();
    snapshot
        .svm
        .add_program_from_file(KAMINO_LEND_PROGRAM_ID, kamino_program_path())
        .unwrap();

    let fee_payer = Keypair::new();
    snapshot
        .svm
        .airdrop(&fee_payer.pubkey(), FEE_PAYER_LAMPORTS)
        .unwrap();

    let instruction = build_refresh_reserve_instruction(&snapshot, "reserve_usdc");
    let message = Message::new(&[instruction], Some(&fee_payer.pubkey()));
    let transaction = Transaction::new(&[&fee_payer], message, snapshot.svm.latest_blockhash());

    snapshot
        .svm
        .send_transaction(transaction)
        .unwrap_or_else(|failure| {
            panic!(
                "refresh_reserve reverted: {:?}\n{:#?}",
                failure.err, failure.meta.logs
            )
        });

    let reserve_address = snapshot.address_of("reserve_usdc").unwrap();
    let account = snapshot.svm.get_account(&reserve_address).unwrap();
    let reserve = decode_reserve(&account.data).unwrap();

    let one_dollar = accrue::kamino::SCALED_FRACTION_ONE;
    let price = reserve.liquidity_market_price_scaled;
    assert!(
        price > one_dollar / 2 && price < one_dollar * 2,
        "USDC priced at {price} scaled units, which is nowhere near one dollar"
    );
}
