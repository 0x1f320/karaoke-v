#pragma once

#include <napi.h>

namespace uia {

Napi::Value FindCanvas(const Napi::CallbackInfo &info);
Napi::Value GetTargetOrigin(const Napi::CallbackInfo &info);
Napi::Value GetCanvasRect(const Napi::CallbackInfo &info);
Napi::Value ListElements(const Napi::CallbackInfo &info);

}  // namespace uia
