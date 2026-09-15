use std::{
    fs,
    path::{Path, PathBuf},
    str::FromStr,
};

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use litesvm::LiteSVM;
use serde::{de::Error as DeserializeError, Deserialize, Deserializer};
use solana_account::Account;
use solana_address::Address;

/// Every account we capture is rent exempt, which the runtime marks with this epoch.
const RENT_EXEMPT_FOREVER: u64 = u64::MAX;

/// One mainnet account captured by `pnpm fixtures:refresh`, in the shape that script writes.
#[derive(Deserialize)]
pub struct FixtureAccount {
    pub label: String,
    pub description: String,
    pub address: String,
    pub owner: String,
    #[serde(deserialize_with = "u64_from_string")]
    pub lamports: u64,
    pub executable: bool,
    pub data_base64: String,
}

#[derive(Deserialize)]
struct FixtureManifest {
    slot: u64,
    unix_timestamp: i64,
    cluster: String,
}

pub struct MainnetSnapshot {
    pub svm: LiteSVM,
    pub slot: u64,
    pub unix_timestamp: i64,
    pub cluster: String,
    pub accounts: Vec<FixtureAccount>,
}

impl MainnetSnapshot {
    pub fn account_by_label(&self, label: &str) -> Result<&FixtureAccount> {
        self.accounts
            .iter()
            .find(|account| account.label == label)
            .ok_or_else(|| anyhow!("no fixture account labelled {label}"))
    }

    pub fn address_of(&self, label: &str) -> Result<Address> {
        parse_address(&self.account_by_label(label)?.address)
    }
}

pub fn fixtures_directory() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures")
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures"))
}

/// Loads every captured account into a fresh LiteSVM and warps the clock to the slot they
/// were captured at, so Kamino's own staleness checks see the world as it was at that slot.
pub fn load_mainnet_snapshot() -> Result<MainnetSnapshot> {
    let directory = fixtures_directory();
    let manifest_path = directory.join("snapshot.json");
    let manifest_text = fs::read_to_string(&manifest_path).with_context(|| {
        format!(
            "no fixture manifest at {}. Run `pnpm fixtures:refresh` first.",
            manifest_path.display()
        )
    })?;
    let manifest: FixtureManifest = serde_json::from_str(&manifest_text)
        .with_context(|| format!("{} is not a fixture manifest", manifest_path.display()))?;

    let accounts = read_accounts(&directory)?;
    if accounts.is_empty() {
        return Err(anyhow!(
            "no fixture accounts under {}. Run `pnpm fixtures:refresh` first.",
            directory.join("accounts").display()
        ));
    }

    let mut svm = LiteSVM::new();
    svm.warp_to_slot(manifest.slot);

    for fixture in &accounts {
        let address = parse_address(&fixture.address)?;
        let owner = parse_address(&fixture.owner)?;
        let data = BASE64_STANDARD
            .decode(&fixture.data_base64)
            .with_context(|| format!("fixture {} has unreadable data", fixture.label))?;
        svm.set_account(
            address,
            Account {
                lamports: fixture.lamports,
                data,
                owner,
                executable: fixture.executable,
                rent_epoch: RENT_EXEMPT_FOREVER,
            },
        )
        .map_err(|error| anyhow!("could not load fixture {}: {error:?}", fixture.label))?;
    }

    Ok(MainnetSnapshot {
        svm,
        slot: manifest.slot,
        unix_timestamp: manifest.unix_timestamp,
        cluster: manifest.cluster,
        accounts,
    })
}

fn read_accounts(directory: &Path) -> Result<Vec<FixtureAccount>> {
    let accounts_directory = directory.join("accounts");
    let entries = match fs::read_dir(&accounts_directory) {
        Ok(entries) => entries,
        Err(_) => return Ok(Vec::new()),
    };

    let mut accounts = Vec::new();
    for entry in entries {
        let path = entry?.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
            continue;
        }
        let text = fs::read_to_string(&path)
            .with_context(|| format!("could not read {}", path.display()))?;
        let account: FixtureAccount = serde_json::from_str(&text)
            .with_context(|| format!("{} is not a fixture account", path.display()))?;
        accounts.push(account);
    }
    accounts.sort_by(|left, right| left.label.cmp(&right.label));
    Ok(accounts)
}

fn parse_address(value: &str) -> Result<Address> {
    Address::from_str(value).with_context(|| format!("{value} is not a base58 address"))
}

/// Lamports are captured as a string because a large u64 does not survive a JSON number.
fn u64_from_string<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u64, D::Error> {
    let text = String::deserialize(deserializer)?;
    text.parse().map_err(DeserializeError::custom)
}
