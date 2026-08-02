// Registers the SynthV bridge receiver (startBridge, stopBridge, monotonicNow).
#pragma once

#import <napi.h>

void RegisterBridge(Napi::Env env, Napi::Object exports);
