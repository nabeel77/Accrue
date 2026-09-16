#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects,
    clippy::integer_division,
    clippy::result_large_err,
    clippy::too_many_arguments
)]

mod actions;
mod clusters;
mod compute_units;
mod grow;
mod hostile_route;
mod kamino_layout;
mod kamino_refresh;
mod leave;
mod open_position;
mod owner_instructions;
mod permissions;
mod protect;
mod snapshot;
mod world;

use std::path::PathBuf;

use snapshot::{load_mainnet_snapshot, MainnetSnapshot};

const KAMINO_LEND_PROGRAM: &str = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";
const XSTOCKS_MARKET_ADDRESS: &str = "5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua";
const XSTOCKS_MARKET_LABEL: &str = "xstocks_market";
const USDC_RESERVE_LABEL: &str = "reserve_usdc";

fn compiled_program_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/accrue.so")
}

#[test]
fn snapshot_loads_every_captured_account() {
    let snapshot = load_mainnet_snapshot().unwrap();

    assert_eq!(snapshot.cluster, "mainnet-beta");
    assert!(
        snapshot.slot > 0,
        "the snapshot must record the slot it was taken at"
    );
    assert!(
        snapshot.unix_timestamp > 0,
        "the snapshot must record the block time it was taken at"
    );
    assert!(
        snapshot.accounts.len() >= 20,
        "expected the market, its reserves and the mints, got {} accounts",
        snapshot.accounts.len()
    );

    for fixture in &snapshot.accounts {
        assert!(
            !fixture.description.trim().is_empty(),
            "fixture {} has no description saying why it is captured",
            fixture.label
        );
    }
}

#[test]
fn the_market_and_its_reserves_belong_to_kamino() {
    let snapshot = load_mainnet_snapshot().unwrap();

    let market = snapshot.account_by_label(XSTOCKS_MARKET_LABEL).unwrap();
    assert_eq!(
        market.owner, KAMINO_LEND_PROGRAM,
        "the xStocks market must be owned by the deployed Kamino Lend program"
    );
    assert_eq!(
        snapshot
            .address_of(XSTOCKS_MARKET_LABEL)
            .unwrap()
            .to_string(),
        XSTOCKS_MARKET_ADDRESS
    );

    let usdc_reserve = snapshot.account_by_label(USDC_RESERVE_LABEL).unwrap();
    assert_eq!(usdc_reserve.owner, KAMINO_LEND_PROGRAM);
    assert!(
        !usdc_reserve.data_base64.is_empty(),
        "a reserve with no data would make every later balance assertion meaningless"
    );
}

#[test]
fn every_captured_account_is_readable_inside_the_runtime() {
    let MainnetSnapshot { svm, accounts, .. } = load_mainnet_snapshot().unwrap();

    for fixture in &accounts {
        let address = fixture.address.parse().unwrap();
        let loaded = svm
            .get_account(&address)
            .unwrap_or_else(|| panic!("{} did not load into the runtime", fixture.label));
        assert_eq!(loaded.owner.to_string(), fixture.owner, "{}", fixture.label);
        assert_eq!(loaded.lamports, fixture.lamports, "{}", fixture.label);
    }
}

#[test]
fn the_accrue_program_deploys_into_the_snapshot() {
    let program_path = compiled_program_path();
    assert!(
        program_path.exists(),
        "{} is missing. Run `anchor build` before the LiteSVM suite.",
        program_path.display()
    );

    let mut snapshot = load_mainnet_snapshot().unwrap();
    snapshot
        .svm
        .add_program_from_file(accrue::ID, &program_path)
        .unwrap();

    let deployed = snapshot.svm.get_account(&accrue::ID).unwrap();
    assert!(
        deployed.executable,
        "the program account must be executable"
    );
}
