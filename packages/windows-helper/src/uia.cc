// Supplies the one thing the bridge script cannot: where the piano roll actually
// is on screen. The script's t2x/v2y are canvas-local, so the overlay needs the
// canvas's screen rectangle to place anything, and SynthV draws the whole editor
// into a single JUCE HWND — there is no child window to measure.
//
// JUCE's accessibility layer exposes a flat UIA tree (~140 elements, all direct
// children of the window) with screen-coordinate bounding rectangles. The canvas
// is identified by agreement with the bridge, not by guessing at the layout: the
// visible time and value ranges times their px-per-unit give the canvas's exact
// pixel size, so we look for the element with those dimensions. That check is
// self-verifying and survives SynthV rearranging its panels.

#include "uia.h"

#include <windows.h>
#include <uiautomation.h>
#include <dwmapi.h>

#include <cmath>
#include <string>

namespace uia {
namespace {

constexpr double kTolerance = 2.0;

IUIAutomation *gAutomation = nullptr;
IUIAutomationElement *gCanvas = nullptr;
HWND gWindow = nullptr;
bool gComReady = false;

bool EnsureCom() {
  if (gComReady) {
    return true;
  }
  const HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  // The host may already have initialised COM on this thread with either model;
  // both outcomes are fine, we just must not uninitialise what we did not own.
  if (hr == S_OK || hr == S_FALSE || hr == RPC_E_CHANGED_MODE) {
    gComReady = true;
    return true;
  }
  return false;
}

bool EnsureAutomation() {
  if (gAutomation) {
    return true;
  }
  if (!EnsureCom()) {
    return false;
  }
  const HRESULT hr = CoCreateInstance(__uuidof(CUIAutomation), nullptr, CLSCTX_INPROC_SERVER,
                                      __uuidof(IUIAutomation),
                                      reinterpret_cast<void **>(&gAutomation));
  return SUCCEEDED(hr) && gAutomation != nullptr;
}

void ReleaseCanvas() {
  if (gCanvas) {
    gCanvas->Release();
    gCanvas = nullptr;
  }
}

HWND FindWindowForProcess(const std::wstring &needle) {
  struct Search {
    std::wstring needle;
    HWND found;
  } search{needle, nullptr};

  EnumWindows(
      [](HWND hwnd, LPARAM param) -> BOOL {
        auto *state = reinterpret_cast<Search *>(param);
        if (!IsWindowVisible(hwnd)) {
          return TRUE;
        }
        DWORD pid = 0;
        GetWindowThreadProcessId(hwnd, &pid);
        if (pid == 0) {
          return TRUE;
        }
        HANDLE proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
        if (!proc) {
          return TRUE;
        }
        wchar_t path[MAX_PATH] = {};
        DWORD size = MAX_PATH;
        const bool ok = QueryFullProcessImageNameW(proc, 0, path, &size) != 0;
        CloseHandle(proc);
        if (!ok) {
          return TRUE;
        }
        std::wstring name(path);
        for (auto &ch : name) {
          ch = static_cast<wchar_t>(towlower(ch));
        }
        if (name.find(state->needle) == std::wstring::npos) {
          return TRUE;
        }
        // The main window is the one with a title; JUCE also keeps hidden helpers.
        if (GetWindowTextLengthW(hwnd) == 0) {
          return TRUE;
        }
        state->found = hwnd;
        return FALSE;
      },
      reinterpret_cast<LPARAM>(&search));

  return search.found;
}

// Same rectangle the stick module positions the overlay to, so anything measured
// against it lands in the overlay's own coordinate space exactly.
bool FrameOf(HWND hwnd, RECT *out) {
  if (FAILED(DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, out, sizeof(RECT)))) {
    return GetWindowRect(hwnd, out) != 0;
  }
  return true;
}

Napi::Object RectToObject(Napi::Env env, const RECT &rect) {
  Napi::Object out = Napi::Object::New(env);
  out.Set("x", Napi::Number::New(env, rect.left));
  out.Set("y", Napi::Number::New(env, rect.top));
  out.Set("w", Napi::Number::New(env, rect.right - rect.left));
  out.Set("h", Napi::Number::New(env, rect.bottom - rect.top));
  return out;
}

}  // namespace

Napi::Value FindCanvas(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "findCanvas(options) requires an options object")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  Napi::Object opts = info[0].As<Napi::Object>();
  const double expectW = opts.Get("width").As<Napi::Number>().DoubleValue();
  const double expectH = opts.Get("height").As<Napi::Number>().DoubleValue();

  std::wstring needle = L"synthv-studio";
  if (opts.Has("target") && opts.Get("target").IsString()) {
    std::u16string given = opts.Get("target").As<Napi::String>().Utf16Value();
    needle.assign(given.begin(), given.end());
    for (auto &ch : needle) {
      ch = static_cast<wchar_t>(towlower(ch));
    }
  }

  if (!EnsureAutomation()) {
    return env.Null();
  }
  const HWND hwnd = FindWindowForProcess(needle);
  if (!hwnd) {
    return env.Null();
  }

  IUIAutomationElement *root = nullptr;
  if (FAILED(gAutomation->ElementFromHandle(hwnd, &root)) || !root) {
    return env.Null();
  }

  IUIAutomationCondition *condition = nullptr;
  gAutomation->CreateTrueCondition(&condition);

  IUIAutomationElementArray *children = nullptr;
  const HRESULT hr = root->FindAll(TreeScope_Children, condition, &children);
  if (condition) {
    condition->Release();
  }
  root->Release();
  if (FAILED(hr) || !children) {
    return env.Null();
  }

  int length = 0;
  children->get_Length(&length);

  ReleaseCanvas();
  RECT best{};
  double bestError = kTolerance * 2.0;

  for (int i = 0; i < length; i++) {
    IUIAutomationElement *element = nullptr;
    if (FAILED(children->GetElement(i, &element)) || !element) {
      continue;
    }
    RECT rect{};
    if (SUCCEEDED(element->get_CurrentBoundingRectangle(&rect))) {
      const double w = static_cast<double>(rect.right - rect.left);
      const double h = static_cast<double>(rect.bottom - rect.top);
      const double error = std::abs(w - expectW) + std::abs(h - expectH);
      if (std::abs(w - expectW) <= kTolerance && std::abs(h - expectH) <= kTolerance &&
          error < bestError) {
        bestError = error;
        best = rect;
        ReleaseCanvas();
        gCanvas = element;
        element->AddRef();
      }
    }
    element->Release();
  }
  children->Release();

  if (!gCanvas) {
    return env.Null();
  }

  gWindow = hwnd;
  Napi::Object out = RectToObject(env, best);
  out.Set("hwnd", Napi::String::New(env, std::to_string(reinterpret_cast<uintptr_t>(hwnd))));
  out.Set("elements", Napi::Number::New(env, length));
  RECT frame{};
  if (FrameOf(hwnd, &frame)) {
    out.Set("origin", RectToObject(env, frame));
  }
  return out;
}

// The window origin is what the canvas rectangle is anchored to, and reading it
// costs a DWM call rather than a cross-process UI Automation round trip. Deriving
// the canvas from it every frame is both cheaper and — because the two numbers
// come from the same instant — free of the drift that made the drawing wobble
// while the window moved.
Napi::Value GetTargetOrigin(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!gWindow || !IsWindow(gWindow)) {
    gWindow = nullptr;
    return env.Null();
  }
  RECT frame{};
  if (!FrameOf(gWindow, &frame)) {
    return env.Null();
  }
  return RectToObject(env, frame);
}

Napi::Value GetCanvasRect(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!gCanvas) {
    return env.Null();
  }
  RECT rect{};
  if (FAILED(gCanvas->get_CurrentBoundingRectangle(&rect))) {
    // The cached element went stale (layout rebuild, project switch); the caller
    // is expected to run findCanvas again rather than keep a dead rectangle.
    ReleaseCanvas();
    return env.Null();
  }
  if (rect.right - rect.left <= 0 || rect.bottom - rect.top <= 0) {
    ReleaseCanvas();
    return env.Null();
  }
  return RectToObject(env, rect);
}

Napi::Value ListElements(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  std::wstring needle = L"synthv-studio";
  if (info.Length() > 0 && info[0].IsString()) {
    std::u16string given = info[0].As<Napi::String>().Utf16Value();
    needle.assign(given.begin(), given.end());
    for (auto &ch : needle) {
      ch = static_cast<wchar_t>(towlower(ch));
    }
  }
  if (!EnsureAutomation()) {
    return env.Null();
  }
  const HWND hwnd = FindWindowForProcess(needle);
  if (!hwnd) {
    return env.Null();
  }
  IUIAutomationElement *root = nullptr;
  if (FAILED(gAutomation->ElementFromHandle(hwnd, &root)) || !root) {
    return env.Null();
  }
  IUIAutomationCondition *condition = nullptr;
  gAutomation->CreateTrueCondition(&condition);
  IUIAutomationElementArray *children = nullptr;
  const HRESULT hr = root->FindAll(TreeScope_Children, condition, &children);
  if (condition) {
    condition->Release();
  }
  root->Release();
  if (FAILED(hr) || !children) {
    return env.Null();
  }

  int length = 0;
  children->get_Length(&length);
  Napi::Array out = Napi::Array::New(env, length);
  for (int i = 0; i < length; i++) {
    IUIAutomationElement *element = nullptr;
    if (FAILED(children->GetElement(i, &element)) || !element) {
      continue;
    }
    RECT rect{};
    element->get_CurrentBoundingRectangle(&rect);
    CONTROLTYPEID type = 0;
    element->get_CurrentControlType(&type);
    Napi::Object item = RectToObject(env, rect);
    item.Set("controlType", Napi::Number::New(env, type));
    out.Set(i, item);
    element->Release();
  }
  children->Release();
  return out;
}

}  // namespace uia
