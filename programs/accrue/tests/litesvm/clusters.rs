use accrue::constants::{
    JUPITER_V6_PROGRAM_ID, KAMINO_FARMS_PROGRAM_ID, KAMINO_LEND_PROGRAM_ID, SCOPE_PRICE_ACCOUNT,
    SCOPE_PROGRAM_ID,
};

use crate::snapshot::load_mainnet_snapshot;

#[test]
fn the_default_build_names_the_programs_the_mainnet_snapshot_holds() {
    let snapshot = load_mainnet_snapshot().unwrap();

    assert_eq!(
        snapshot.address_of("program_kamino_lend").unwrap(),
        KAMINO_LEND_PROGRAM_ID
    );
    assert_eq!(
        snapshot.address_of("program_farms").unwrap(),
        KAMINO_FARMS_PROGRAM_ID
    );
    assert_eq!(
        snapshot.address_of("program_jupiter_v6").unwrap(),
        JUPITER_V6_PROGRAM_ID
    );
    assert_eq!(
        snapshot.address_of("program_scope").unwrap(),
        SCOPE_PROGRAM_ID
    );
    assert_eq!(
        snapshot.address_of("oracle_scope_prices").unwrap(),
        SCOPE_PRICE_ACCOUNT
    );
}

#[test]
fn the_lending_market_id_the_generated_client_carries_is_the_one_the_constants_name() {
    assert_eq!(
        accrue::kamino::KAMINO_LEND_PROGRAM_ID,
        KAMINO_LEND_PROGRAM_ID,
        "the generated client and the cluster module have to name the same lending market"
    );
}
