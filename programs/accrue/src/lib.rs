use anchor_lang::prelude::*;

pub mod error;
pub mod kamino;

pub(crate) use kamino::generated::KAMINO_LENDING_ID;

declare_id!("6KUwCyECUrvjppwAe92FxTqHLvw2LKGmfkV7j37r6gBb");

#[program]
pub mod accrue {}
