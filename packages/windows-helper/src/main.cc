#include <napi.h>

#include "stick.h"
#include "uia.h"

namespace {

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("findCanvas", Napi::Function::New(env, uia::FindCanvas));
  exports.Set("getTargetOrigin", Napi::Function::New(env, uia::GetTargetOrigin));
  exports.Set("getCanvasRect", Napi::Function::New(env, uia::GetCanvasRect));
  exports.Set("listElements", Napi::Function::New(env, uia::ListElements));

  exports.Set("start", Napi::Function::New(env, stick::Start));
  exports.Set("stop", Napi::Function::New(env, stick::Stop));
  exports.Set("follow", Napi::Function::New(env, stick::Follow));
  exports.Set("unfollow", Napi::Function::New(env, stick::Unfollow));
  exports.Set("getTargetFrame", Napi::Function::New(env, stick::GetTargetFrame));
  exports.Set("disableAnimations", Napi::Function::New(env, stick::DisableAnimations));
  exports.Set("monotonicNow", Napi::Function::New(env, stick::MonotonicNow));
  return exports;
}

}  // namespace

NODE_API_MODULE(winhelper, Init)
