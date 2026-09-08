//! Pure, OS-independent decision logic. No file IO, no process spawning —
//! every function here is deterministic and fully unit-tested with `cargo
//! test`. This mirrors (and supersedes) the former TypeScript `core/` layer.

pub mod analytics;
pub mod cleanup_safety;
pub mod filter;
pub mod identity;
pub mod migrations;
pub mod safety;
