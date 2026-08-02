// Receives payloads from the SynthV bridge script.
//
// SynthV's scripting host has no file or network access, so the clipboard is its
// only way out. The script writes a marked payload on transport events and takes
// it back a moment later, which means we are not reading a stream — we are
// catching brief blips. Watching NSPasteboard's changeCount is what makes that
// cheap: it is an integer read, so we only pull the string once it has changed.
//
// Detection is stamped here rather than on the JS side. The payload carries a
// playhead reading, and everything downstream extrapolates from it off a local
// clock, so the anchor is only as good as our knowledge of when it arrived.

#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <napi.h>
#import <string>
#import <utility>

#import "bridge.h"

namespace {

// The script holds each payload two orders of magnitude longer than this, so the
// interval sets timestamp precision rather than whether we catch the write.
constexpr CFTimeInterval kPollInterval = 0.005;

Napi::ThreadSafeFunction gPayloadFn;
CFRunLoopTimerRef gTimer = nullptr;
NSInteger gLastChangeCount = 0;
std::string gMarker;

struct Payload {
  std::string text;
  double monotonicMs;
};

double nowMs() {
  return CACurrentMediaTime() * 1000.0;
}

void emit(std::string text, double stamp) {
  if (!gPayloadFn) {
    return;
  }
  auto *data = new Payload{std::move(text), stamp};
  gPayloadFn.NonBlockingCall(data, [](Napi::Env env, Napi::Function cb, Payload *d) {
    cb.Call({Napi::String::New(env, d->text), Napi::Number::New(env, d->monotonicMs)});
    delete d;
  });
}

void pollCallback(CFRunLoopTimerRef, void *) {
  NSPasteboard *pb = NSPasteboard.generalPasteboard;
  NSInteger count = pb.changeCount;
  if (count == gLastChangeCount) {
    return;
  }
  gLastChangeCount = count;

  // Stamp before reading the string — that read costs far more than the compare
  // below, and the payload was already written by the time changeCount moved.
  double stamp = nowMs();

  NSString *text = [pb stringForType:NSPasteboardTypeString];
  const char *utf8 = text.UTF8String;
  if (!utf8) {
    return;  // an image, a file promise, anything that is not text
  }
  std::string s(utf8);
  if (s.rfind(gMarker, 0) != 0) {
    return;  // something the user copied — not ours to touch
  }
  emit(std::move(s), stamp);
}

void stopPolling() {
  if (gTimer) {
    CFRunLoopTimerInvalidate(gTimer);
    CFRelease(gTimer);
    gTimer = nullptr;
  }
  if (gPayloadFn) {
    gPayloadFn.Release();
    gPayloadFn = Napi::ThreadSafeFunction();
  }
  gMarker.clear();
}

Napi::Value StartBridge(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "startBridge(options) requires an options object")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  stopPolling();

  Napi::Object opts = info[0].As<Napi::Object>();
  gMarker = opts.Get("marker").As<Napi::String>().Utf8Value();
  gPayloadFn = Napi::ThreadSafeFunction::New(env, opts.Get("onPayload").As<Napi::Function>(),
                                             "bridge-payload", 0, 1);

  // Whatever sits on the clipboard right now predates us. A leftover payload
  // would anchor playback to a position it left long ago, so skip it.
  gLastChangeCount = NSPasteboard.generalPasteboard.changeCount;

  CFRunLoopTimerContext ctx = {0, nullptr, nullptr, nullptr, nullptr};
  gTimer = CFRunLoopTimerCreate(kCFAllocatorDefault, CFAbsoluteTimeGetCurrent() + kPollInterval,
                                kPollInterval, 0, 0, pollCallback, &ctx);
  CFRunLoopAddTimer(CFRunLoopGetMain(), gTimer, kCFRunLoopCommonModes);
  return env.Undefined();
}

Napi::Value StopBridge(const Napi::CallbackInfo &info) {
  stopPolling();
  return info.Env().Undefined();
}

Napi::Value MonotonicNow(const Napi::CallbackInfo &info) {
  return Napi::Number::New(info.Env(), nowMs());
}

}  // namespace

void RegisterBridge(Napi::Env env, Napi::Object exports) {
  exports.Set("startBridge", Napi::Function::New(env, StartBridge));
  exports.Set("stopBridge", Napi::Function::New(env, StopBridge));
  exports.Set("monotonicNow", Napi::Function::New(env, MonotonicNow));
}
