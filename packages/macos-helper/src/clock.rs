// The monotonic clock everything else is stamped against.
//
// AX reads and bridge records are both anchored to a moment, and downstream they
// are extrapolated from — so their age has to be measurable without assuming two
// processes agree about what time it is. CACurrentMediaTime is that reference:
// it is the same clock the addon's own reads use.

use objc2_quartz_core::CACurrentMediaTime;

#[napi]
pub fn monotonic_now() -> f64 {
    CACurrentMediaTime() * 1000.0
}
