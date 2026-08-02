// Reads SynthV's piano-roll geometry via the Accessibility API for the overlay.
//
// getPianoRoll()/getPianoRollAsync() walk the target's AX tree (~50ms) and return
// the visible canvas rect, the content group's scroll offset (contentX) + total
// width (contentW, the zoom scale), and the visible note rects — global screen
// points. The async variant runs the walk off the main thread so callers can
// refresh notes without hitching. Both cache the geometry elements so
// getViewport() can re-read the scroll/zoom + canvas cheaply (~µs) each frame.
//
// The canvas rect comes from the two largest scrollbars (robust); the content
// group (for scroll/zoom) is the widest group aligned to the canvas' top-left.

#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <napi.h>
#import <utility>
#import <vector>

#import "ax.h"
#import "pianoroll.h"

namespace {

// Accumulator during the tree walk.
struct Walked {
  CGRect hbar = CGRectNull;
  CGRect vbar = CGRectNull;
  AXUIElementRef hbarEl = nullptr;
  AXUIElementRef vbarEl = nullptr;
  std::vector<std::pair<CGRect, AXUIElementRef>> groups;  // large group candidates (retained)
  std::vector<std::pair<CGRect, AXUIElementRef>> notes;   // note-shaped candidates (retained)
};

// Computed result (screen points) + geometry elements for the viewport cache.
struct PianoRollResult {
  bool found = false;
  CGRect canvas = CGRectZero;
  double contentX = 0;
  double contentW = 0;
  // Vertical reference: one note chip's element + its y at read time. Nothing
  // scalar in SynthV's AX tree tracks vertical scroll (the scrollbar value is
  // dead, no thumb child, no moving group) — but chip frames do move, so one
  // cached chip read per frame gives the vertical scroll delta directly.
  AXUIElementRef refEl = nullptr;
  double refY = 0;
  // False when the chips moved vertically during this read: their y values are
  // then mutually skewed (no per-chip y reference exists) — discard the read.
  bool yStable = true;
  std::vector<CGRect> notes;
  AXUIElementRef contentEl = nullptr;
  AXUIElementRef hbarEl = nullptr;
  AXUIElementRef vbarEl = nullptr;
};

void prPick(AXUIElementRef el, CGRect f, CGRect &rect, AXUIElementRef &ref) {
  rect = f;
  if (ref) CFRelease(ref);
  ref = (AXUIElementRef)CFRetain(el);
}

// Cached elements from the last full read, so getViewport reads cheaply.
AXUIElementRef gPrContent = nullptr;
AXUIElementRef gPrHbar = nullptr;
AXUIElementRef gPrVbar = nullptr;
AXUIElementRef gPrRef = nullptr;  // vertical reference chip (from last stable read)

void prClearCache() {
  if (gPrContent) {
    CFRelease(gPrContent);
    gPrContent = nullptr;
  }
  if (gPrHbar) {
    CFRelease(gPrHbar);
    gPrHbar = nullptr;
  }
  if (gPrVbar) {
    CFRelease(gPrVbar);
    gPrVbar = nullptr;
  }
  if (gPrRef) {
    CFRelease(gPrRef);
    gPrRef = nullptr;
  }
}

// role + frame + children of a node. Reads all four AX attributes in ONE IPC
// round-trip via AXUIElementCopyMultipleAttributeValues (vs 4 separate calls).
bool prReadNode(AXUIElementRef el, NSString **role, CGRect *frame, NSArray **children) {
  static NSArray *attrs = @[
    (__bridge NSString *)kAXRoleAttribute, (__bridge NSString *)kAXPositionAttribute,
    (__bridge NSString *)kAXSizeAttribute, (__bridge NSString *)kAXChildrenAttribute
  ];
  CFArrayRef valuesRef = nullptr;
  if (AXUIElementCopyMultipleAttributeValues(el, (__bridge CFArrayRef)attrs,
                                             (AXCopyMultipleAttributeOptions)0,
                                             &valuesRef) != kAXErrorSuccess ||
      !valuesRef) {
    return false;
  }
  NSArray *values = (__bridge_transfer NSArray *)valuesRef;
  if (values.count < 4) {
    return false;
  }
  *role = [values[0] isKindOfClass:NSString.class] ? values[0] : @"";
  id pv = values[1];
  id sv = values[2];
  CGPoint p = CGPointZero;
  CGSize s = CGSizeZero;
  bool okP = CFGetTypeID((__bridge CFTypeRef)pv) == AXValueGetTypeID() &&
             AXValueGetValue((__bridge AXValueRef)pv, kAXValueTypeCGPoint, &p);
  bool okS = CFGetTypeID((__bridge CFTypeRef)sv) == AXValueGetTypeID() &&
             AXValueGetValue((__bridge AXValueRef)sv, kAXValueTypeCGSize, &s);
  *frame = (okP && okS) ? CGRectMake(p.x, p.y, s.width, s.height) : CGRectNull;
  *children = [values[3] isKindOfClass:NSArray.class] ? values[3] : nil;
  return true;
}

void prWalk(AXUIElementRef el, int depth, Walked &d) {
  if (depth > 30) {
    return;
  }
  NSString *role = @"";
  CGRect f = CGRectNull;
  NSArray *children = nil;
  if (!prReadNode(el, &role, &f, &children)) {
    return;
  }
  if (!CGRectIsNull(f)) {
    // The note-area scrollbars are the largest: widest horizontal, tallest vertical.
    if ([role isEqualToString:@"AXScrollBar"]) {
      if (f.size.width > f.size.height) {
        if (CGRectIsNull(d.hbar) || f.size.width > d.hbar.size.width) prPick(el, f, d.hbar, d.hbarEl);
      } else if (CGRectIsNull(d.vbar) || f.size.height > d.vbar.size.height) {
        prPick(el, f, d.vbar, d.vbarEl);
      }
    }
    // Content-group candidates: large groups (span the note area).
    if ([role isEqualToString:@"AXGroup"] && f.size.width >= 400 && f.size.height >= 400) {
      d.groups.push_back({f, (AXUIElementRef)CFRetain(el)});
    }
    // Note-shaped groups (one lane tall). Collect loosely; filter to the canvas below.
    if ([role isEqualToString:@"AXGroup"] && f.size.height >= 20 && f.size.height <= 28 &&
        f.size.width >= 4 && f.origin.y > 400) {
      d.notes.push_back({f, (AXUIElementRef)CFRetain(el)});
    }
  }
  for (id c in children) {
    prWalk((__bridge AXUIElementRef)c, depth + 1, d);
  }
}

// Walk the app (by pid) and compute the piano-roll geometry. AX/CoreGraphics only
// — safe to call off the main thread. Never touches the module cache.
// Resolve the app's main window (falls back to focused / first window), so the
// walk skips the large menu-bar subtree. Returns a retained ref, or null.
AXUIElementRef copyMainWindow(AXUIElementRef axApp) {
  CFTypeRef w = nullptr;
  if (AXUIElementCopyAttributeValue(axApp, kAXMainWindowAttribute, &w) == kAXErrorSuccess && w) {
    return (AXUIElementRef)w;
  }
  if (AXUIElementCopyAttributeValue(axApp, kAXFocusedWindowAttribute, &w) == kAXErrorSuccess && w) {
    return (AXUIElementRef)w;
  }
  CFTypeRef wins = nullptr;
  if (AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute, &wins) == kAXErrorSuccess && wins) {
    AXUIElementRef first = nullptr;
    if (CFArrayGetCount((CFArrayRef)wins) > 0) {
      first = (AXUIElementRef)CFRetain(CFArrayGetValueAtIndex((CFArrayRef)wins, 0));
    }
    CFRelease(wins);
    return first;
  }
  return nullptr;
}

PianoRollResult prCompute(pid_t pid) {
  PianoRollResult r;
  AXUIElementRef axApp = AXUIElementCreateApplication(pid);
  AXUIElementRef root = copyMainWindow(axApp);
  Walked d;
  prWalk(root ? root : axApp, 0, d);
  if (root) CFRelease(root);
  CFRelease(axApp);
  if (CGRectIsNull(d.hbar) || CGRectIsNull(d.vbar)) {
    for (auto &g : d.groups) {
      if (g.second) CFRelease(g.second);
    }
    for (auto &nn : d.notes) {
      if (nn.second) CFRelease(nn.second);
    }
    if (d.hbarEl) CFRelease(d.hbarEl);
    if (d.vbarEl) CFRelease(d.vbarEl);
    return r;  // found = false
  }

  double cx = d.hbar.origin.x;
  double cy = d.vbar.origin.y;
  double cw = d.vbar.origin.x - cx;
  double chh = d.hbar.origin.y - cy;

  // Content group = the widest group confined to the canvas region vertically and
  // overlapping it horizontally. Vertical confinement is what excludes the
  // full-window group, so it can't win by width when zoomed out.
  //
  // Horizontal position is deliberately NOT constrained. The content group's left
  // edge is where the content begins, which only coincides with the canvas' left
  // edge when the note group starts at the very beginning of the view. Requiring
  // that (it once read `gf.origin.x <= cx + 8`) dropped every candidate whenever
  // the group sat mid-viewport, leaving getViewport with nothing to read — and a
  // null viewport means the overlay draws nothing at all, so the notes looked
  // undetected even though the walk had found them.
  CGRect content = CGRectMake(cx, cy, cw, chh);  // fallback: no scroll info
  AXUIElementRef contentEl = nullptr;
  CGFloat best = -1;
  for (auto &g : d.groups) {
    const CGRect &gf = g.first;
    if (gf.origin.x < cx + cw - 8 && gf.origin.x + gf.size.width > cx + 8 &&
        gf.origin.y >= cy - 8 && gf.origin.y + gf.size.height <= cy + chh + 8 &&
        gf.size.width > best) {
      best = gf.size.width;
      content = gf;
      contentEl = g.second;
    }
  }

  // Chip candidates in the canvas' vertical band (walk-time frames). The x filter
  // and pair-matching wait until after normalization below: mid-scroll, walk-time
  // x coordinates are skewed and can't be compared.
  std::vector<AXUIElementRef> els;
  std::vector<CGRect> rawChips;
  for (auto &nn : d.notes) {
    const CGRect &n = nn.first;
    if (n.size.height < 22) continue;
    if (n.origin.y >= cy - 2 && n.origin.y < cy + chh) {
      els.push_back(nn.second);
      rawChips.push_back(n);
    }
  }

  // Skew-free frames. The walk samples each element at a different instant, so a
  // read taken mid-scroll disagrees across chips by v*dt px — enough to break the
  // 2px pair-matching below (leaving phoneme chips behind) and to bake x errors
  // into the output. Re-read every chip back-to-back with the content group and
  // normalize into one reference content frame (xRef); adjacent reads are ~100us
  // apart, so the residual skew is sub-pixel at any scroll speed.
  double xRef = content.origin.x;
  double contentW = content.size.width;
  std::vector<std::pair<CGRect, AXUIElementRef>> chips;  // normalized frame + element
  if (contentEl) {
    CGRect cf;
    if (axFrame(contentEl, &cf)) {
      xRef = cf.origin.x;
      contentW = cf.size.width;
    }
    for (AXUIElementRef el : els) {
      CGRect nf;
      if (!axFrame(el, &nf)) continue;
      CGRect cf2;
      double ci = axFrame(contentEl, &cf2) ? cf2.origin.x : xRef;
      nf.origin.x += (xRef - ci);  // normalize into the xRef content frame
      chips.push_back({nf, el});
    }
  } else {
    for (size_t i = 0; i < els.size(); i++) chips.push_back({rawChips[i], els[i]});
  }

  // Visible chips: x-intersect the canvas, in consistent (normalized) coords.
  std::vector<std::pair<CGRect, AXUIElementRef>> vis;
  for (auto &c : chips) {
    if (c.first.origin.x + c.first.size.width > cx && c.first.origin.x < cx + cw) {
      vis.push_back(c);
    }
  }

  // Each note exposes two stacked 24px chips: the phoneme label above and the
  // lyric chip on the note itself (verified by screen capture). Pair matching is
  // by X-OVERLAP + one lane down, not exact x: notes on a track are sequential
  // in time so real notes' x ranges never overlap — only a pair's chips do —
  // and overlap survives the few-px divergence SynthV's label relayout causes
  // mid-scrub (exact-x matching missed those, leaving phantom phoneme boxes).
  // Keep the lyric chip = the one with no overlapping twin directly below it.
  for (auto &nn : vis) {
    const CGRect &n = nn.first;
    bool twinBelow = false;
    for (auto &oo : vis) {
      const CGRect &o = oo.first;
      double overlap = fmin(n.origin.x + n.size.width, o.origin.x + o.size.width) -
                       fmax(n.origin.x, o.origin.x);
      if (overlap > 2 && fabs(o.size.width - n.size.width) < 2 &&
          fabs(o.origin.y - (n.origin.y + n.size.height)) < 4) {
        twinBelow = true;
        break;
      }
    }
    if (!twinBelow) {
      if (!r.refEl) {
        r.refEl = (AXUIElementRef)CFRetain(nn.second);
        r.refY = n.origin.y;
      }
      r.notes.push_back(n);
    }
  }

  // Stability check: re-read the reference chip after all chip reads. If it moved,
  // vertical scroll was in motion during this read and the per-chip y values are
  // mutually skewed — flag the read so callers discard it.
  if (r.refEl) {
    CGRect rf;
    if (axFrame(r.refEl, &rf) && fabs(rf.origin.y - r.refY) > 0.5) {
      r.yStable = false;
    }
  }

  r.found = true;
  r.canvas = CGRectMake(cx, cy, cw, chh);
  r.contentX = xRef;
  r.contentW = contentW;
  r.contentEl = contentEl ? (AXUIElementRef)CFRetain(contentEl) : nullptr;
  r.hbarEl = d.hbarEl;  // transfer ownership
  r.vbarEl = d.vbarEl;
  d.hbarEl = d.vbarEl = nullptr;
  for (auto &g : d.groups) {
    if (g.second) CFRelease(g.second);
  }
  for (auto &nn : d.notes) {
    if (nn.second) CFRelease(nn.second);
  }
  return r;
}

Napi::Object prBuild(Napi::Env env, const PianoRollResult &r) {
  auto num = [&](double v) { return Napi::Number::New(env, v); };
  Napi::Object out = Napi::Object::New(env);
  Napi::Object canvas = Napi::Object::New(env);
  canvas.Set("x", num(r.canvas.origin.x));
  canvas.Set("y", num(r.canvas.origin.y));
  canvas.Set("w", num(r.canvas.size.width));
  canvas.Set("h", num(r.canvas.size.height));
  out.Set("canvas", canvas);
  out.Set("contentX", num(r.contentX));
  out.Set("contentW", num(r.contentW));
  out.Set("refY", num(r.refY));
  out.Set("yStable", Napi::Boolean::New(env, r.yStable));
  Napi::Array notes = Napi::Array::New(env, r.notes.size());
  for (size_t i = 0; i < r.notes.size(); i++) {
    Napi::Object no = Napi::Object::New(env);
    no.Set("x", num(r.notes[i].origin.x));
    no.Set("y", num(r.notes[i].origin.y));
    no.Set("w", num(r.notes[i].size.width));
    no.Set("h", num(r.notes[i].size.height));
    notes[i] = no;
  }
  out.Set("notes", notes);
  return out;
}

// Move the result's geometry elements into the module cache (main thread only).
// The vertical reference chip is only adopted from stable reads: an unstable
// read is discarded by the caller, and swapping the reference underneath the
// caller's last accepted read would make refY deltas compare different chips.
void prAdopt(PianoRollResult &r) {
  AXUIElementRef keepRef = nullptr;
  if (!r.yStable && gPrRef) {
    keepRef = (AXUIElementRef)CFRetain(gPrRef);
  }
  prClearCache();
  gPrContent = r.contentEl;
  gPrHbar = r.hbarEl;
  gPrVbar = r.vbarEl;
  if (r.yStable) {
    gPrRef = r.refEl;
  } else {
    gPrRef = keepRef;
    if (r.refEl) CFRelease(r.refEl);
  }
  r.contentEl = r.hbarEl = r.vbarEl = r.refEl = nullptr;
}

pid_t findSynthPid(NSString *needle) {
  for (NSRunningApplication *a in NSWorkspace.sharedWorkspace.runningApplications) {
    if (a.activationPolicy != NSApplicationActivationPolicyRegular) continue;
    if ([(a.localizedName ?: @"").lowercaseString containsString:needle]) {
      return a.processIdentifier;
    }
  }
  return 0;
}

NSString *needleArg(const Napi::CallbackInfo &info) {
  std::string s = (info.Length() > 0 && info[0].IsString())
                      ? info[0].As<Napi::String>().Utf8Value()
                      : "synthesizer";
  return [NSString stringWithUTF8String:s.c_str()].lowercaseString;
}

Napi::Value GetPianoRoll(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  pid_t pid = findSynthPid(needleArg(info));
  if (pid == 0) return env.Null();
  PianoRollResult r = prCompute(pid);
  if (!r.found) return env.Null();
  Napi::Object out = prBuild(env, r);
  prAdopt(r);
  return out;
}

// Runs the walk off the main thread, resolving a Promise with the result.
class PianoRollWorker : public Napi::AsyncWorker {
 public:
  PianoRollWorker(Napi::Env env, pid_t pid, Napi::Promise::Deferred deferred)
      : Napi::AsyncWorker(env), pid_(pid), deferred_(deferred) {}

  void Execute() override { result_ = prCompute(pid_); }

  void OnOK() override {
    Napi::Env env = Env();
    if (!result_.found) {
      deferred_.Resolve(env.Null());
      return;
    }
    Napi::Object out = prBuild(env, result_);
    prAdopt(result_);
    deferred_.Resolve(out);
  }

  void OnError(const Napi::Error &e) override { deferred_.Reject(e.Value()); }

 private:
  pid_t pid_;
  Napi::Promise::Deferred deferred_;
  PianoRollResult result_;
};

Napi::Value GetPianoRollAsync(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  auto deferred = Napi::Promise::Deferred::New(env);
  pid_t pid = findSynthPid(needleArg(info));
  if (pid == 0) {
    deferred.Resolve(env.Null());
    return deferred.Promise();
  }
  auto *worker = new PianoRollWorker(env, pid, deferred);
  worker->Queue();
  return deferred.Promise();
}

// Cheap read: canvas rect + scroll/zoom from the cached elements (no walk).
Napi::Value GetViewport(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!gPrHbar || !gPrVbar) {
    return env.Null();
  }
  CGRect hbar, vbar;
  if (!axFrame(gPrHbar, &hbar) || !axFrame(gPrVbar, &vbar)) {
    prClearCache();
    return env.Null();
  }
  // No content group means no scroll reference — the same case prCompute falls
  // back on, so answer the same way it does (contentX = the canvas' left edge)
  // rather than returning null. Null here blanks the overlay on every frame,
  // which is far worse than a scroll correction that reads as zero between the
  // note reads.
  CGRect content = CGRectMake(hbar.origin.x, vbar.origin.y, vbar.origin.x - hbar.origin.x,
                              hbar.origin.y - vbar.origin.y);
  if (gPrContent && !axFrame(gPrContent, &content)) {
    prClearCache();
    return env.Null();
  }
  // Vertical reference: the cached chip's current y. Compared against the read's
  // refY it gives the vertical scroll delta in exact pixels. The chip element can
  // die (note edited/deleted, track switched) — then omit refY; the next full
  // read re-caches a fresh reference.
  bool haveRefY = false;
  double refY = 0;
  if (gPrRef) {
    CGRect rf;
    if (axFrame(gPrRef, &rf)) {
      haveRefY = true;
      refY = rf.origin.y;
    } else {
      CFRelease(gPrRef);
      gPrRef = nullptr;
    }
  }

  auto num = [&](double v) { return Napi::Number::New(env, v); };
  double cx = hbar.origin.x;
  double cy = vbar.origin.y;
  Napi::Object out = Napi::Object::New(env);
  Napi::Object canvas = Napi::Object::New(env);
  canvas.Set("x", num(cx));
  canvas.Set("y", num(cy));
  canvas.Set("w", num(vbar.origin.x - cx));
  canvas.Set("h", num(hbar.origin.y - cy));
  out.Set("canvas", canvas);
  out.Set("contentX", num(content.origin.x));
  out.Set("contentW", num(content.size.width));
  if (haveRefY) {
    out.Set("refY", num(refY));
  }
  return out;
}

}  // namespace

void RegisterPianoRoll(Napi::Env env, Napi::Object exports) {
  exports.Set("getPianoRoll", Napi::Function::New(env, GetPianoRoll));
  exports.Set("getPianoRollAsync", Napi::Function::New(env, GetPianoRollAsync));
  exports.Set("getViewport", Napi::Function::New(env, GetViewport));
}
