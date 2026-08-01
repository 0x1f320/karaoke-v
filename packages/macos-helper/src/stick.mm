// Native macOS addon: tracks a target app's main window in-process and emits its
// screen frame so the JS side can stick an Electron window to it.
//
// An AXObserver (or a CGWindowList poll fallback when Accessibility isn't
// granted) fires as the target moves; we forward the target's frame — top-left
// origin, global points, exactly what Electron's win.setBounds() expects — over
// a thread-safe function. No child process, no pipe. Positioning is left to
// Electron so multi-monitor display mapping stays correct. Status changes
// (attached / waiting / hidden / permission) are forwarded on a second callback.

#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <napi.h>
#import <string>

namespace {

Napi::ThreadSafeFunction gFrameFn;
Napi::ThreadSafeFunction gStatusFn;
AXObserverRef gObserver = nullptr;
AXUIElementRef gAppEl = nullptr;
AXUIElementRef gWinEl = nullptr;
pid_t gPid = 0;
NSString *gNeedle = nil;
bool gTrusted = false;
CFRunLoopTimerRef gTimer = nullptr;
std::string gLastKey;
CGRect gLastFrame = CGRectNull;

const CFStringRef kWindowNotifications[] = {
    kAXMovedNotification,
    kAXResizedNotification,
    kAXWindowMiniaturizedNotification,
    kAXWindowDeminiaturizedNotification,
    kAXUIElementDestroyedNotification,
};

struct FrameData {
  double x, y, w, h;
};

void emitFrame(CGRect r) {
  if (CGRectEqualToRect(r, gLastFrame)) {
    return;
  }
  gLastFrame = r;
  if (gFrameFn) {
    auto *data = new FrameData{r.origin.x, r.origin.y, r.size.width, r.size.height};
    gFrameFn.NonBlockingCall(data, [](Napi::Env env, Napi::Function cb, FrameData *d) {
      cb.Call({Napi::Number::New(env, d->x), Napi::Number::New(env, d->y),
               Napi::Number::New(env, d->w), Napi::Number::New(env, d->h)});
      delete d;
    });
  }
}

void emitStatus(const std::string &state, const std::string &mode) {
  std::string key = state + "/" + mode;
  if (key == gLastKey) {
    return;
  }
  gLastKey = key;
  if (gStatusFn) {
    auto *data = new std::pair<std::string, std::string>(state, mode);
    gStatusFn.NonBlockingCall(data, [](Napi::Env env, Napi::Function cb,
                                       std::pair<std::string, std::string> *d) {
      cb.Call({Napi::String::New(env, d->first), Napi::String::New(env, d->second)});
      delete d;
    });
  }
}

NSRunningApplication *findApp() {
  for (NSRunningApplication *a in NSWorkspace.sharedWorkspace.runningApplications) {
    if (a.activationPolicy != NSApplicationActivationPolicyRegular) {
      continue;
    }
    NSString *name = a.localizedName ?: @"";
    if ([name.lowercaseString containsString:gNeedle]) {
      return a;
    }
  }
  return nil;
}

bool axFrame(AXUIElementRef el, CGRect *out) {
  CFTypeRef posVal = nullptr;
  CFTypeRef sizeVal = nullptr;
  if (AXUIElementCopyAttributeValue(el, kAXPositionAttribute, &posVal) != kAXErrorSuccess ||
      AXUIElementCopyAttributeValue(el, kAXSizeAttribute, &sizeVal) != kAXErrorSuccess) {
    if (posVal) CFRelease(posVal);
    if (sizeVal) CFRelease(sizeVal);
    return false;
  }
  CGPoint p = CGPointZero;
  CGSize s = CGSizeZero;
  AXValueGetValue((AXValueRef)posVal, kAXValueTypeCGPoint, &p);
  AXValueGetValue((AXValueRef)sizeVal, kAXValueTypeCGSize, &s);
  CFRelease(posVal);
  CFRelease(sizeVal);
  *out = CGRectMake(p.x, p.y, s.width, s.height);
  return true;
}

AXUIElementRef copyCurrentWindow() {
  if (!gAppEl) {
    return nullptr;
  }
  CFTypeRef win = nullptr;
  if (AXUIElementCopyAttributeValue(gAppEl, kAXMainWindowAttribute, &win) == kAXErrorSuccess && win) {
    return (AXUIElementRef)win;
  }
  if (AXUIElementCopyAttributeValue(gAppEl, kAXFocusedWindowAttribute, &win) == kAXErrorSuccess &&
      win) {
    return (AXUIElementRef)win;
  }
  CFTypeRef wins = nullptr;
  if (AXUIElementCopyAttributeValue(gAppEl, kAXWindowsAttribute, &wins) == kAXErrorSuccess && wins) {
    AXUIElementRef first = nullptr;
    if (CFArrayGetCount((CFArrayRef)wins) > 0) {
      first = (AXUIElementRef)CFArrayGetValueAtIndex((CFArrayRef)wins, 0);
      CFRetain(first);
    }
    CFRelease(wins);
    return first;
  }
  return nullptr;
}

bool pollTargetFrame(CGRect *out) {
  CGWindowListOption opts = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;
  CFArrayRef list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID);
  if (!list) {
    return false;
  }
  bool found = false;
  CGFloat bestArea = 0;
  CFIndex count = CFArrayGetCount(list);
  for (CFIndex i = 0; i < count; i++) {
    NSDictionary *e = (__bridge NSDictionary *)(CFDictionaryRef)CFArrayGetValueAtIndex(list, i);
    NSNumber *pid = e[(__bridge NSString *)kCGWindowOwnerPID];
    if (!pid || pid.intValue != gPid) {
      continue;
    }
    NSNumber *layer = e[(__bridge NSString *)kCGWindowLayer];
    if (!layer || layer.intValue != 0) {
      continue;
    }
    CFDictionaryRef boundsDict = (__bridge CFDictionaryRef)e[(__bridge NSString *)kCGWindowBounds];
    CGRect r;
    if (!boundsDict || !CGRectMakeWithDictionaryRepresentation(boundsDict, &r)) {
      continue;
    }
    CGFloat area = r.size.width * r.size.height;
    if (area > bestArea) {
      bestArea = area;
      *out = r;
      found = true;
    }
  }
  CFRelease(list);
  return found;
}

void pushFrame() {
  NSRunningApplication *app =
      gPid ? [NSRunningApplication runningApplicationWithProcessIdentifier:gPid] : nil;
  if (!app || app.terminated) {
    emitStatus("waiting", "");
    return;
  }
  if (app.hidden) {
    emitStatus("hidden", "");
    return;
  }
  CGRect target;
  bool ok = false;
  if (gTrusted) {
    if (!gWinEl) {
      gWinEl = copyCurrentWindow();
    }
    ok = gWinEl && axFrame(gWinEl, &target);
  } else {
    ok = pollTargetFrame(&target);
  }
  if (ok) {
    emitFrame(target);
    emitStatus("attached", gTrusted ? "ax" : "poll");
  } else {
    emitStatus("hidden", "");
  }
}

void teardownObserver() {
  if (gObserver) {
    CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(gObserver),
                          kCFRunLoopCommonModes);
    CFRelease(gObserver);
    gObserver = nullptr;
  }
  if (gWinEl) {
    CFRelease(gWinEl);
    gWinEl = nullptr;
  }
}

void rebindWindow() {
  if (!gObserver) {
    return;
  }
  if (gWinEl) {
    for (CFStringRef n : kWindowNotifications) {
      AXObserverRemoveNotification(gObserver, gWinEl, n);
    }
    CFRelease(gWinEl);
    gWinEl = nullptr;
  }
  gWinEl = copyCurrentWindow();
  if (gWinEl) {
    for (CFStringRef n : kWindowNotifications) {
      AXObserverAddNotification(gObserver, gWinEl, n, nullptr);
    }
  }
}

void observerCallback(AXObserverRef, AXUIElementRef element, CFStringRef notification, void *) {
  if (CFEqual(notification, kAXWindowMiniaturizedNotification)) {
    emitStatus("hidden", "");
    return;
  }
  if (CFEqual(notification, kAXWindowDeminiaturizedNotification)) {
    pushFrame();
    return;
  }
  if (CFEqual(notification, kAXUIElementDestroyedNotification) ||
      CFEqual(notification, kAXFocusedWindowChangedNotification) ||
      CFEqual(notification, kAXMainWindowChangedNotification)) {
    rebindWindow();
    pushFrame();
    return;
  }
  CGRect r;  // moved / resized
  if (axFrame(element, &r)) {
    emitFrame(r);
    emitStatus("attached", "ax");
  }
}

void bindObserver() {
  teardownObserver();
  if (AXObserverCreate(gPid, observerCallback, &gObserver) != kAXErrorSuccess || !gObserver) {
    gObserver = nullptr;
    return;
  }
  AXObserverAddNotification(gObserver, gAppEl, kAXFocusedWindowChangedNotification, nullptr);
  AXObserverAddNotification(gObserver, gAppEl, kAXMainWindowChangedNotification, nullptr);
  rebindWindow();
  CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(gObserver),
                    kCFRunLoopCommonModes);
}

void clearTarget() {
  teardownObserver();
  if (gAppEl) {
    CFRelease(gAppEl);
    gAppEl = nullptr;
  }
  gPid = 0;
  gLastFrame = CGRectNull;
}

void resolve() {
  NSRunningApplication *app = findApp();
  if (!app) {
    clearTarget();
    emitStatus("waiting", "");
    return;
  }
  if (app.processIdentifier != gPid) {
    clearTarget();
    gPid = app.processIdentifier;
    gAppEl = AXUIElementCreateApplication(gPid);
    if (gTrusted) {
      bindObserver();
    }
  }
  pushFrame();
}

void timerCallback(CFRunLoopTimerRef, void *) {
  if (gPid == 0) {
    resolve();
    return;
  }
  NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:gPid];
  if (!app || app.terminated) {
    clearTarget();
    emitStatus("waiting", "");
    return;
  }
  pushFrame();  // poll driver when untrusted; safety re-sync when trusted
}

void stopTracking() {
  if (gTimer) {
    CFRunLoopTimerInvalidate(gTimer);
    CFRelease(gTimer);
    gTimer = nullptr;
  }
  clearTarget();
  gLastKey.clear();
  if (gFrameFn) {
    gFrameFn.Release();
    gFrameFn = Napi::ThreadSafeFunction();
  }
  if (gStatusFn) {
    gStatusFn.Release();
    gStatusFn = Napi::ThreadSafeFunction();
  }
  gNeedle = nil;
}

Napi::Value Start(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "start(options) requires an options object")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  stopTracking();

  Napi::Object opts = info[0].As<Napi::Object>();
  std::string needle = opts.Get("target").As<Napi::String>().Utf8Value();
  gNeedle = [NSString stringWithUTF8String:needle.c_str()].lowercaseString;

  gFrameFn = Napi::ThreadSafeFunction::New(env, opts.Get("onFrame").As<Napi::Function>(),
                                          "stick-frame", 0, 1);
  gStatusFn = Napi::ThreadSafeFunction::New(env, opts.Get("onStatus").As<Napi::Function>(),
                                            "stick-status", 0, 1);

  gTrusted = AXIsProcessTrusted();
  if (!gTrusted) {
    NSDictionary *promptOpts = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt : @YES};
    AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)promptOpts);
    emitStatus("permission", "");
  }

  resolve();

  CFTimeInterval interval = gTrusted ? 0.25 : 1.0 / 60.0;
  CFRunLoopTimerContext ctx = {0, nullptr, nullptr, nullptr, nullptr};
  gTimer = CFRunLoopTimerCreate(kCFAllocatorDefault, CFAbsoluteTimeGetCurrent() + interval, interval,
                                0, 0, timerCallback, &ctx);
  CFRunLoopAddTimer(CFRunLoopGetMain(), gTimer, kCFRunLoopCommonModes);
  return env.Undefined();
}

Napi::Value Stop(const Napi::CallbackInfo &info) {
  stopTracking();
  return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("start", Napi::Function::New(env, Start));
  exports.Set("stop", Napi::Function::New(env, Stop));
  return exports;
}

}  // namespace

NODE_API_MODULE(stick, Init)
