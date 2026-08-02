// Follows the SynthV window so the overlay can sit on top of it.
//
// The WinEvent hook is installed with WINEVENT_OUTOFCONTEXT, which means Windows
// delivers the callbacks through the installing thread's message queue. That
// thread must therefore be Electron's main thread — it is the only one pumping
// messages — so start() has to be called from the main process, never a worker.
//
// Frames are reported in physical pixels because that is what Win32 deals in.
// Converting to the DIPs that setBounds wants needs the window's display scale,
// which Electron knows and this addon does not; the JS layer does that step.

#include "stick.h"

#include <windows.h>
#include <dwmapi.h>

#include <string>
#include <utility>

namespace stick {
namespace {

Napi::ThreadSafeFunction gFrameFn;
Napi::ThreadSafeFunction gStatusFn;
HWINEVENTHOOK gHook = nullptr;
HWINEVENTHOOK gMoveHook = nullptr;
HWND gTarget = nullptr;
HWND gFollower = nullptr;
std::wstring gNeedle;
UINT_PTR gRetryTimer = 0;
UINT_PTR gDragTimer = 0;

struct Frame {
  double x, y, w, h;
};

// Dragging is the one case where the target's next position is knowable in
// advance: while the user holds the title bar the window tracks the cursor
// rigidly, so its origin is the origin it had when the drag began plus however
// far the cursor has moved. Predicting from that is what lets the overlay move
// with SynthV instead of one composition frame behind it — the move notification
// only ever arrives after SynthV has already painted itself somewhere new.
bool gDragging = false;
Frame gDragOrigin{};
POINT gDragCursor{};

/** Prediction is abandoned past this much disagreement — an edge snap, say. */
constexpr double kResyncPx = 8.0;

std::wstring Lower(std::wstring text) {
  for (auto &ch : text) {
    ch = static_cast<wchar_t>(towlower(ch));
  }
  return text;
}

HWND FindTarget(const std::wstring &needle) {
  struct Search {
    const std::wstring *needle;
    HWND found;
  } search{&needle, nullptr};

  EnumWindows(
      [](HWND hwnd, LPARAM param) -> BOOL {
        auto *state = reinterpret_cast<Search *>(param);
        if (!IsWindowVisible(hwnd) || GetWindowTextLengthW(hwnd) == 0) {
          return TRUE;
        }
        DWORD pid = 0;
        GetWindowThreadProcessId(hwnd, &pid);
        HANDLE proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
        if (!proc) {
          return TRUE;
        }
        wchar_t path[MAX_PATH] = {};
        DWORD size = MAX_PATH;
        const bool ok = QueryFullProcessImageNameW(proc, 0, path, &size) != 0;
        CloseHandle(proc);
        if (ok && Lower(path).find(*state->needle) != std::wstring::npos) {
          state->found = hwnd;
          return FALSE;
        }
        return TRUE;
      },
      reinterpret_cast<LPARAM>(&search));

  return search.found;
}

// DWM's extended frame bounds exclude the invisible resize border, so this is the
// rectangle the window actually looks like it occupies. GetWindowRect is several
// pixels larger on every side and would leave the overlay visibly offset.
bool FrameOf(HWND hwnd, Frame *out) {
  RECT rect{};
  if (FAILED(DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &rect, sizeof(rect)))) {
    if (!GetWindowRect(hwnd, &rect)) {
      return false;
    }
  }
  out->x = rect.left;
  out->y = rect.top;
  out->w = rect.right - rect.left;
  out->h = rect.bottom - rect.top;
  return out->w > 0 && out->h > 0;
}

void EmitFrame(const Frame &frame) {
  if (!gFrameFn) {
    return;
  }
  auto *data = new Frame(frame);
  gFrameFn.NonBlockingCall(data, [](Napi::Env env, Napi::Function cb, Frame *d) {
    cb.Call({Napi::Number::New(env, d->x), Napi::Number::New(env, d->y),
             Napi::Number::New(env, d->w), Napi::Number::New(env, d->h)});
    delete d;
  });
}

void EmitStatus(const char *state) {
  if (!gStatusFn) {
    return;
  }
  auto *data = new std::string(state);
  gStatusFn.NonBlockingCall(data, [](Napi::Env env, Napi::Function cb, std::string *d) {
    cb.Call({Napi::String::New(env, *d)});
    delete d;
  });
}

// Making the overlay an *owned* window is what glues it to SynthV's z-order:
// Windows keeps it directly above its owner, minimises and restores it alongside,
// and — unlike a global topmost window — lets anything stacked above SynthV cover
// it too. Ownership across processes is not something Microsoft documents, so
// this stays best-effort.
//
// Making the overlay a real WS_CHILD of SynthV was tried twice and is a dead end,
// not a tuning problem: a parent with WS_CLIPCHILDREN — which JUCE sets — excludes
// the area its children cover from its own painting. An overlay that covers the
// whole client area therefore stops SynthV repainting itself entirely. Clearing
// that style on someone else's window only trades the freeze for the parent
// painting over us. Ownership plus a chase is the most Windows allows here.
void SetOwner(HWND follower, HWND owner) {
  if (!follower || !IsWindow(follower)) {
    return;
  }
  SetLastError(0);
  SetWindowLongPtrW(follower, GWLP_HWNDPARENT, reinterpret_cast<LONG_PTR>(owner));
}

// Repositioning here rather than back in JavaScript is the other half: the hook
// runs on the same thread the window lives on, so the move lands in the same
// message batch as SynthV's own, instead of a frame later via IPC and setBounds.
void PlaceFollower(const Frame &frame) {
  if (!gFollower || !IsWindow(gFollower)) {
    return;
  }
  SetWindowPos(gFollower, nullptr, static_cast<int>(frame.x), static_cast<int>(frame.y),
               static_cast<int>(frame.w), static_cast<int>(frame.h),
               SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOREDRAW);
}

void StopDrag();

// The target is normally found after follow() has already handed us the window,
// so attaching has to happen wherever the target first appears, not only there.
void AttachFollower() {
  if (!gFollower || !gTarget) {
    return;
  }
  SetOwner(gFollower, gTarget);
}

void ReportCurrent() {
  if (!gTarget || !IsWindow(gTarget)) {
    gTarget = nullptr;
    EmitStatus("waiting");
    return;
  }
  if (!IsWindowVisible(gTarget) || IsIconic(gTarget)) {
    EmitStatus("hidden");
    return;
  }
  Frame frame{};
  if (!FrameOf(gTarget, &frame)) {
    return;
  }

  if (gDragging) {
    // A resize is not predictable from the cursor, and neither is a window the
    // system snapped to an edge; in both cases the reported frame is the truth
    // and prediction either re-baselines against it or gives up.
    if (frame.w != gDragOrigin.w || frame.h != gDragOrigin.h) {
      StopDrag();
    } else {
      POINT cursor{};
      if (GetCursorPos(&cursor)) {
        const double driftX = frame.x - (gDragOrigin.x + cursor.x - gDragCursor.x);
        const double driftY = frame.y - (gDragOrigin.y + cursor.y - gDragCursor.y);
        if (driftX * driftX + driftY * driftY > kResyncPx * kResyncPx) {
          gDragOrigin = frame;
          gDragCursor = cursor;
        }
      }
    }
  }

  PlaceFollower(frame);
  EmitStatus("attached");
  EmitFrame(frame);
}

void CALLBACK OnDragTimer(HWND, UINT, UINT_PTR, DWORD) {
  POINT cursor{};
  if (!gDragging || !gTarget || !GetCursorPos(&cursor)) {
    return;
  }
  Frame predicted = gDragOrigin;
  predicted.x += cursor.x - gDragCursor.x;
  predicted.y += cursor.y - gDragCursor.y;
  PlaceFollower(predicted);
}

void StopDrag() {
  if (gDragTimer) {
    KillTimer(nullptr, gDragTimer);
    gDragTimer = 0;
  }
  gDragging = false;
}

void CALLBACK OnMoveSizeEvent(HWINEVENTHOOK, DWORD event, HWND hwnd, LONG idObject, LONG,
                              DWORD, DWORD) {
  if (idObject != OBJID_WINDOW || hwnd != gTarget) {
    return;
  }
  if (event == EVENT_SYSTEM_MOVESIZESTART) {
    if (FrameOf(gTarget, &gDragOrigin) && GetCursorPos(&gDragCursor)) {
      gDragging = true;
      if (!gDragTimer) {
        gDragTimer = SetTimer(nullptr, 0, 8, OnDragTimer);
      }
    }
    return;
  }
  StopDrag();
  ReportCurrent();
}

void CALLBACK OnWinEvent(HWINEVENTHOOK, DWORD event, HWND hwnd, LONG idObject, LONG,
                         DWORD, DWORD) {
  if (idObject != OBJID_WINDOW) {
    return;
  }
  if (!gTarget) {
    if (event == EVENT_OBJECT_SHOW || event == EVENT_OBJECT_CREATE) {
      gTarget = FindTarget(gNeedle);
      ReportCurrent();
    }
    return;
  }
  if (hwnd != gTarget) {
    return;
  }
  switch (event) {
    case EVENT_OBJECT_DESTROY:
      StopDrag();
      SetOwner(gFollower, nullptr);
      gTarget = nullptr;
      EmitStatus("waiting");
      break;
    case EVENT_OBJECT_HIDE:
      EmitStatus("hidden");
      break;
    case EVENT_OBJECT_SHOW:
    case EVENT_OBJECT_LOCATIONCHANGE:
      ReportCurrent();
      break;
    default:
      break;
  }
}

// The hook only reports windows that already exist, so a target that is not
// running yet would never be picked up; this ticks until one appears.
void CALLBACK OnRetryTimer(HWND, UINT, UINT_PTR, DWORD) {
  if (gTarget && IsWindow(gTarget)) {
    return;
  }
  gTarget = FindTarget(gNeedle);
  if (gTarget) {
    AttachFollower();
    ReportCurrent();
  }
}

}  // namespace

Napi::Value Start(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "start(options) requires an options object")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Napi::Object opts = info[0].As<Napi::Object>();

  std::u16string given = opts.Get("target").As<Napi::String>().Utf16Value();
  gNeedle = Lower(std::wstring(given.begin(), given.end()));

  gFrameFn = Napi::ThreadSafeFunction::New(env, opts.Get("onFrame").As<Napi::Function>(),
                                           "kvWindowsHelperFrame", 0, 1);
  gStatusFn = Napi::ThreadSafeFunction::New(env, opts.Get("onStatus").As<Napi::Function>(),
                                            "kvWindowsHelperStatus", 0, 1);

  gHook = SetWinEventHook(EVENT_OBJECT_CREATE, EVENT_OBJECT_LOCATIONCHANGE, nullptr,
                          OnWinEvent, 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
  if (!gHook) {
    EmitStatus("unsupported");
    return env.Undefined();
  }

  gMoveHook = SetWinEventHook(EVENT_SYSTEM_MOVESIZESTART, EVENT_SYSTEM_MOVESIZEEND, nullptr,
                              OnMoveSizeEvent, 0, 0,
                              WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);

  gRetryTimer = SetTimer(nullptr, 0, 1000, OnRetryTimer);
  gTarget = FindTarget(gNeedle);
  AttachFollower();
  ReportCurrent();
  return env.Undefined();
}

Napi::Value Follow(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "follow(handle) requires the window handle Buffer")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Napi::Buffer<uint8_t> handle = info[0].As<Napi::Buffer<uint8_t>>();
  if (handle.Length() < sizeof(HWND)) {
    return env.Undefined();
  }
  gFollower = *reinterpret_cast<HWND *>(handle.Data());
  if (gTarget) {
    SetOwner(gFollower, gTarget);
    Frame frame{};
    if (FrameOf(gTarget, &frame)) {
      PlaceFollower(frame);
    }
  }
  return env.Undefined();
}

Napi::Value Unfollow(const Napi::CallbackInfo &info) {
  SetOwner(gFollower, nullptr);
  gFollower = nullptr;
  return info.Env().Undefined();
}

Napi::Value Stop(const Napi::CallbackInfo &info) {
  if (gRetryTimer) {
    KillTimer(nullptr, gRetryTimer);
    gRetryTimer = 0;
  }
  StopDrag();
  if (gMoveHook) {
    UnhookWinEvent(gMoveHook);
    gMoveHook = nullptr;
  }
  if (gHook) {
    UnhookWinEvent(gHook);
    gHook = nullptr;
  }
  SetOwner(gFollower, nullptr);
  gFollower = nullptr;
  gTarget = nullptr;
  if (gFrameFn) {
    gFrameFn.Release();
    gFrameFn = Napi::ThreadSafeFunction();
  }
  if (gStatusFn) {
    gStatusFn.Release();
    gStatusFn = Napi::ThreadSafeFunction();
  }
  return info.Env().Undefined();
}

Napi::Value GetTargetFrame(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  std::wstring needle = gNeedle.empty() ? L"synthv-studio" : gNeedle;
  if (info.Length() > 0 && info[0].IsString()) {
    std::u16string given = info[0].As<Napi::String>().Utf16Value();
    needle = Lower(std::wstring(given.begin(), given.end()));
  }
  HWND hwnd = (gTarget && IsWindow(gTarget)) ? gTarget : FindTarget(needle);
  if (!hwnd) {
    return env.Null();
  }
  Frame frame{};
  if (!FrameOf(hwnd, &frame)) {
    return env.Null();
  }
  Napi::Object out = Napi::Object::New(env);
  out.Set("x", Napi::Number::New(env, frame.x));
  out.Set("y", Napi::Number::New(env, frame.y));
  out.Set("w", Napi::Number::New(env, frame.w));
  out.Set("h", Napi::Number::New(env, frame.h));
  out.Set("visible", Napi::Boolean::New(env, IsWindowVisible(hwnd) && !IsIconic(hwnd)));
  out.Set("foreground", Napi::Boolean::New(env, GetForegroundWindow() == hwnd));
  return out;
}

// Kept so the two helpers present the same surface; Windows has no equivalent of
// AppKit's implicit window animations to switch off.
Napi::Value DisableAnimations(const Napi::CallbackInfo &info) {
  return info.Env().Undefined();
}

Napi::Value MonotonicNow(const Napi::CallbackInfo &info) {
  LARGE_INTEGER frequency{};
  LARGE_INTEGER counter{};
  QueryPerformanceFrequency(&frequency);
  QueryPerformanceCounter(&counter);
  const double ms = frequency.QuadPart > 0
                        ? (static_cast<double>(counter.QuadPart) * 1000.0 /
                           static_cast<double>(frequency.QuadPart))
                        : static_cast<double>(GetTickCount64());
  return Napi::Number::New(info.Env(), ms);
}

}  // namespace stick
