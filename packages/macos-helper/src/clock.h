// Registers the shared monotonic clock (monotonicNow).
#pragma once
#import <napi.h>
void RegisterClock(Napi::Env env, Napi::Object exports);
