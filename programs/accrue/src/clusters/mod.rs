#[cfg(any(
    all(feature = "mainnet", feature = "devnet"),
    all(feature = "mainnet", feature = "localnet"),
    all(feature = "devnet", feature = "localnet"),
))]
compile_error!("Enable exactly one cluster: mainnet, devnet or localnet.");

#[cfg(not(any(feature = "mainnet", feature = "devnet", feature = "localnet")))]
compile_error!("Enable one cluster: mainnet, devnet or localnet.");

#[cfg(feature = "devnet")]
mod devnet;
#[cfg(feature = "localnet")]
mod localnet;
#[cfg(feature = "mainnet")]
mod mainnet;

#[cfg(feature = "devnet")]
pub use devnet::*;
#[cfg(feature = "localnet")]
pub use localnet::*;
#[cfg(feature = "mainnet")]
pub use mainnet::*;
