use anchor_lang::prelude::*;

#[error_code]
pub enum AccrueError {
    #[msg("Arithmetic overflowed")]
    MathOverflow,
    #[msg("That account is not owned by the lending market program")]
    NotAKaminoAccount,
    #[msg("The lending market account is shorter than its layout")]
    KaminoAccountTooShort,
    #[msg("A lending market field is outside the range the program can represent")]
    KaminoFieldOutOfRange,
}
