// Native macOS addon: tracks a target app's main window in-process and emits its
// screen frame so the JS side can stick an Electron window to it.
//
// An AXObserver (or a CGWindowList poll when Accessibility isn't granted) drives
// smooth position updates; a CGWindowList pass gates visibility — the target is
// "visible" only when it's on-screen (not minimized / on another Space) and not
// significantly covered by a window in front. When it isn't visible we emit
// HIDE so the panel gets hidden instead of floating over nothing.
//
// Frames are top-left origin, global points — exactly what Electron's
// win.setBounds() expects. No child process, no pipe.

#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <napi.h>
#import <string>
#import <vector>

namespace {

// Fraction of the target that must be covered by front windows to count as hidden.
constexpr CGFloat kOcclusionThreshold = 0.15;

Napi::ThreadSafeFunction gFrameFn;
Napi::ThreadSafeFunction gStatusFn;
AXObserverRef gObserver = nullptr;
AXUIElementRef gAppEl = nullptr;
AXUIElementRef gWinEl = nullptr;
pid_t gPid = 0;
NSString *gNeedle = nil;
bool gTrusted = false;
bool gVisible = false;
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

// Force the next visible frame to re-emit even if the coordinates are unchanged
// (e.g. after unhiding), so the renderer's window is repositioned + shown.
void markHidden(const std::string &state) {
  gVisible = false;
  gLastFrame = CGRectNull;
  emitStatus(state, "");
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

CGRect boundsOf(NSDictionary *entry) {
  CFDictionaryRef bd = (__bridge CFDictionaryRef)entry[(__bridge NSString *)kCGWindowBounds];
  CGRect r = CGRectNull;
  if (bd) {
    CGRectMakeWithDictionaryRepresentation(bd, &r);
  }
  return r;
}

int layerOf(NSDictionary *entry) {
  NSNumber *layer = entry[(__bridge NSString *)kCGWindowLayer];
  return layer ? layer.intValue : -1;
}

pid_t pidOf(NSDictionary *entry) {
  NSNumber *pid = entry[(__bridge NSString *)kCGWindowOwnerPID];
  return pid ? (pid_t)pid.intValue : 0;
}

// Is the target on-screen and not significantly covered? Fills *out with its
// CGWindowList frame. On-screen windows are ordered front-to-back.
bool evaluateVisibility(CGRect *out) {
  pid_t myPid = (pid_t)NSProcessInfo.processInfo.processIdentifier;
  CGWindowListOption opts = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;
  CFArrayRef list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID);
  if (!list) {
    return false;
  }
  CFIndex count = CFArrayGetCount(list);

  CFIndex targetIdx = -1;
  CGRect targetBounds = CGRectZero;
  CGFloat bestArea = 0;
  for (CFIndex i = 0; i < count; i++) {
    NSDictionary *e = (__bridge NSDictionary *)(CFDictionaryRef)CFArrayGetValueAtIndex(list, i);
    if (pidOf(e) != gPid || layerOf(e) != 0) {
      continue;
    }
    CGRect r = boundsOf(e);
    CGFloat area = r.size.width * r.size.height;
    if (area > bestArea) {
      bestArea = area;
      targetBounds = r;
      targetIdx = i;
    }
  }
  if (targetIdx < 0) {
    CFRelease(list);  // minimized / another Space / off-screen
    return false;
  }

  const CGFloat total = targetBounds.size.width * targetBounds.size.height;
  CGFloat covered = 0;
  for (CFIndex i = 0; i < targetIdx; i++) {  // windows in front of the target
    NSDictionary *e = (__bridge NSDictionary *)(CFDictionaryRef)CFArrayGetValueAtIndex(list, i);
    pid_t pid = pidOf(e);
    if (pid == gPid || pid == myPid || layerOf(e) != 0) {
      continue;  // skip the target's own windows and our panel
    }
    CGRect inter = CGRectIntersection(boundsOf(e), targetBounds);
    if (!CGRectIsNull(inter)) {
      covered += inter.size.width * inter.size.height;
    }
  }
  CFRelease(list);

  *out = targetBounds;
  return total <= 0 || (covered / total) <= kOcclusionThreshold;
}

// Full visibility + position pass. Emits a frame (attached) when the target is
// visible, otherwise HIDE / WAIT.
void reevaluate() {
  NSRunningApplication *app =
      gPid ? [NSRunningApplication runningApplicationWithProcessIdentifier:gPid] : nil;
  if (!app || app.terminated) {
    markHidden("waiting");
    return;
  }
  if (app.hidden) {
    markHidden("hidden");
    return;
  }

  CGRect frame;
  if (!evaluateVisibility(&frame)) {
    markHidden("hidden");
    return;
  }
  gVisible = true;

  // Prefer the AX frame for precision; fall back to the CGWindowList bounds.
  if (gTrusted) {
    if (!gWinEl) {
      gWinEl = copyCurrentWindow();
    }
    CGRect axf;
    if (gWinEl && axFrame(gWinEl, &axf)) {
      frame = axf;
    }
  }
  emitFrame(frame);
  emitStatus("attached", gTrusted ? "ax" : "poll");
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
    markHidden("hidden");
    return;
  }
  if (CFEqual(notification, kAXWindowDeminiaturizedNotification)) {
    reevaluate();
    return;
  }
  if (CFEqual(notification, kAXUIElementDestroyedNotification) ||
      CFEqual(notification, kAXFocusedWindowChangedNotification) ||
      CFEqual(notification, kAXMainWindowChangedNotification)) {
    rebindWindow();
    reevaluate();
    return;
  }
  // moved / resized — only follow while the target is visible (occlusion is
  // gated by the timer's reevaluate()).
  if (!gVisible) {
    return;
  }
  CGRect r;
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
  gVisible = false;
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
  reevaluate();
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
  reevaluate();  // occlusion + visibility pass (and position resync)
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

  // AX mode: 10Hz occlusion/visibility check (AX events drive smooth position).
  // Poll mode: 60Hz drives everything.
  CFTimeInterval interval = gTrusted ? 0.1 : 1.0 / 60.0;
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

// Turn off AppKit's automatic window animations (the fade on show/hide/order)
// for the given window, so the panel appears and disappears instantly.
Napi::Value DisableAnimations(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "disableAnimations(viewHandle) requires a Buffer")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Napi::Buffer<uint8_t> viewBuf = info[0].As<Napi::Buffer<uint8_t>>();
  void **handle = reinterpret_cast<void **>(viewBuf.Data());
  NSView *view = (__bridge NSView *)(*handle);
  NSWindow *win = view.window;
  if (win) {
    win.animationBehavior = NSWindowAnimationBehaviorNone;
  }
  return env.Undefined();
}

// ---------- Piano-roll reader (one-shot AX snapshot for the overlay) ----------
// Walks the target's AX tree once and returns the piano-roll geometry: the
// visible canvas rect, the content group's scroll offset (contentX) + total
// width (contentW, the zoom scale), and the visible note rects — all in global
// screen points. A full walk is ~50ms so callers should poll modestly, not 60fps.

NSString *prRole(AXUIElementRef el) {
  CFTypeRef v = nullptr;
  if (AXUIElementCopyAttributeValue(el, kAXRoleAttribute, &v) == kAXErrorSuccess && v) {
    if (CFGetTypeID(v) == CFStringGetTypeID()) {
      return (__bridge_transfer NSString *)v;
    }
    CFRelease(v);
  }
  return @"";
}

struct PianoRoll {
  CGRect content = CGRectZero;  // widest AXGroup = scrollable content
  CGFloat contentArea = 0;
  CGRect hbar = CGRectNull;  // horizontal scrollbar (lowest)
  CGRect vbar = CGRectNull;  // vertical scrollbar (rightmost)
  std::vector<CGRect> notes;
};

void prWalk(AXUIElementRef el, int depth, PianoRoll &d) {
  if (depth > 30) {
    return;
  }
  NSString *role = prRole(el);
  CGRect f;
  if (axFrame(el, &f)) {
    CGFloat area = f.size.width * f.size.height;
    if ([role isEqualToString:@"AXGroup"] && area > d.contentArea) {
      d.contentArea = area;
      d.content = f;
    }
    if ([role isEqualToString:@"AXScrollBar"]) {
      if (f.size.width > f.size.height) {
        if (CGRectIsNull(d.hbar) || f.origin.y > d.hbar.origin.y) d.hbar = f;
      } else if (CGRectIsNull(d.vbar) || f.origin.x > d.vbar.origin.x) {
        d.vbar = f;
      }
    }
    // Note-shaped groups (one lane tall). Collect loosely here; filter to the
    // canvas rect below so left-edge / short notes aren't dropped by hardcoded bounds.
    if ([role isEqualToString:@"AXGroup"] && f.size.height >= 20 && f.size.height <= 28 &&
        f.size.width >= 4 && f.origin.y > 400) {
      d.notes.push_back(f);
    }
  }
  CFTypeRef ch = nullptr;
  if (AXUIElementCopyAttributeValue(el, kAXChildrenAttribute, &ch) == kAXErrorSuccess && ch) {
    NSArray *arr = (__bridge_transfer NSArray *)ch;
    for (id c in arr) {
      prWalk((__bridge AXUIElementRef)c, depth + 1, d);
    }
  }
}

Napi::Value GetPianoRoll(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  std::string needle = (info.Length() > 0 && info[0].IsString())
                           ? info[0].As<Napi::String>().Utf8Value()
                           : "synthesizer";
  NSString *n = [NSString stringWithUTF8String:needle.c_str()].lowercaseString;
  NSRunningApplication *app = nil;
  for (NSRunningApplication *a in NSWorkspace.sharedWorkspace.runningApplications) {
    if (a.activationPolicy != NSApplicationActivationPolicyRegular) continue;
    if ([(a.localizedName ?: @"").lowercaseString containsString:n]) {
      app = a;
      break;
    }
  }
  if (!app) return env.Null();

  AXUIElementRef axApp = AXUIElementCreateApplication(app.processIdentifier);
  PianoRoll d;
  prWalk(axApp, 0, d);
  CFRelease(axApp);
  if (d.contentArea == 0 || CGRectIsNull(d.hbar) || CGRectIsNull(d.vbar)) {
    return env.Null();
  }

  double cx = d.hbar.origin.x;                  // visible left
  double cy = d.content.origin.y;               // note-area top
  double cw = d.vbar.origin.x - cx;             // to the vertical scrollbar
  double chh = d.hbar.origin.y - cy;            // to the horizontal scrollbar

  auto num = [&](double v) { return Napi::Number::New(env, v); };
  Napi::Object out = Napi::Object::New(env);
  Napi::Object canvas = Napi::Object::New(env);
  canvas.Set("x", num(cx));
  canvas.Set("y", num(cy));
  canvas.Set("w", num(cw));
  canvas.Set("h", num(chh));
  out.Set("canvas", canvas);
  out.Set("contentX", num(d.content.origin.x));
  out.Set("contentW", num(d.content.size.width));
  // Keep note groups within the piano-roll canvas (intersect horizontally so
  // partially-scrolled-off notes still count; sit in the canvas' vertical band).
  // Require ~full lane height to drop odd short header elements.
  std::vector<CGRect> inCanvas;
  for (const CGRect &r : d.notes) {
    if (r.size.height < 22) continue;
    if (r.origin.x + r.size.width > cx && r.origin.x < cx + cw && r.origin.y >= cy - 2 &&
        r.origin.y < cy + chh) {
      inCanvas.push_back(r);
    }
  }
  // Each note renders as two stacked boxes at the same x/w: a phoneme box above
  // and the note body below. Keep the body = the box that has no twin directly
  // below it (its own height down); that drops the phoneme boxes.
  std::vector<CGRect> visible;
  for (const CGRect &r : inCanvas) {
    bool twinBelow = false;
    for (const CGRect &o : inCanvas) {
      if (fabs(o.origin.x - r.origin.x) < 2 && fabs(o.size.width - r.size.width) < 2 &&
          fabs(o.origin.y - (r.origin.y + r.size.height)) < 4) {
        twinBelow = true;
        break;
      }
    }
    if (!twinBelow) {
      visible.push_back(r);
    }
  }
  Napi::Array notes = Napi::Array::New(env, visible.size());
  for (size_t i = 0; i < visible.size(); i++) {
    Napi::Object no = Napi::Object::New(env);
    no.Set("x", num(visible[i].origin.x));
    no.Set("y", num(visible[i].origin.y));
    no.Set("w", num(visible[i].size.width));
    no.Set("h", num(visible[i].size.height));
    notes[i] = no;
  }
  out.Set("notes", notes);
  return out;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("start", Napi::Function::New(env, Start));
  exports.Set("stop", Napi::Function::New(env, Stop));
  exports.Set("disableAnimations", Napi::Function::New(env, DisableAnimations));
  exports.Set("getPianoRoll", Napi::Function::New(env, GetPianoRoll));
  return exports;
}

}  // namespace

NODE_API_MODULE(stick, Init)
