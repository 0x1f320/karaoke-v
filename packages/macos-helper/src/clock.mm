// The monotonic clock everything else is stamped against.
//
// AX reads and bridge records are both anchored to a moment, and downstream they
// are extrapolated from — so their age has to be measurable without assuming two
// processes agree about what time it is. CACurrentMediaTime is that reference:
// it is the same clock the addon's own reads use.

#import <QuartzCore/QuartzCore.h>
#import <napi.h>

#import "clock.h"

namespace {

Napi::Value MonotonicNow(const Napi::CallbackInfo &info) {
  return Napi::Number::New(info.Env(), CACurrentMediaTime() * 1000.0);
}

}  // namespace

void RegisterClock(Napi::Env env, Napi::Object exports) {
  exports.Set("monotonicNow", Napi::Function::New(env, MonotonicNow));
}
