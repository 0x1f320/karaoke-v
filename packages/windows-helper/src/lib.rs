// Native Windows addon: follows the SynthV window so the overlay can sit on top
// of it, and answers the one question the bridge script cannot — where the piano
// roll canvas is on screen.

// Everything here is Win32, so a non-Windows target builds an empty addon rather
// than failing. `cargo check --target x86_64-pc-windows-msvc` is what actually
// compiles this code from a macOS checkout.
#[cfg(windows)]
#[macro_use]
extern crate napi_derive;

#[cfg(windows)]
mod stick;
#[cfg(windows)]
mod types;
#[cfg(windows)]
mod uia;
#[cfg(windows)]
mod win;
