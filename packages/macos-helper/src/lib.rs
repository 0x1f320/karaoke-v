// Native macOS addon: tracks a target app's window and reads SynthV's piano-roll
// geometry out of the Accessibility API, so the JS side can stick an Electron
// window to the target and paint effects over its notes.

#[macro_use]
extern crate napi_derive;

mod audio;
mod ax;
mod clock;
mod pianoroll;
mod scripts;
mod stick;
mod types;
