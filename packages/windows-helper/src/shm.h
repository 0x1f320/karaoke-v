#pragma once

#include <napi.h>

namespace shm {

Napi::Value Attach(const Napi::CallbackInfo &info);
Napi::Value Detach(const Napi::CallbackInfo &info);
Napi::Value IsAttached(const Napi::CallbackInfo &info);
Napi::Value ReadState(const Napi::CallbackInfo &info);
Napi::Value GetScheduleRevision(const Napi::CallbackInfo &info);
Napi::Value ReadSchedule(const Napi::CallbackInfo &info);
Napi::Value SendCommand(const Napi::CallbackInfo &info);

}  // namespace shm
