// Registers the piano-roll AX reader (getPianoRoll, getViewport) on the addon.
#pragma once

#import <napi.h>

void RegisterPianoRoll(Napi::Env env, Napi::Object exports);
