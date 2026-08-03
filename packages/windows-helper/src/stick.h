#pragma once

#include <napi.h>

namespace stick {

Napi::Value Start(const Napi::CallbackInfo &info);
Napi::Value Stop(const Napi::CallbackInfo &info);
Napi::Value Follow(const Napi::CallbackInfo &info);
Napi::Value Unfollow(const Napi::CallbackInfo &info);
Napi::Value GetTargetFrame(const Napi::CallbackInfo &info);
Napi::Value DisableAnimations(const Napi::CallbackInfo &info);
Napi::Value MonotonicNow(const Napi::CallbackInfo &info);

}  // namespace stick
