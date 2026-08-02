#include <napi.h>

#include "shm.h"
#include "stick.h"
#include "uia.h"

namespace {

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("attach", Napi::Function::New(env, shm::Attach));
  exports.Set("detach", Napi::Function::New(env, shm::Detach));
  exports.Set("isAttached", Napi::Function::New(env, shm::IsAttached));
  exports.Set("readState", Napi::Function::New(env, shm::ReadState));
  exports.Set("getScheduleRevision", Napi::Function::New(env, shm::GetScheduleRevision));
  exports.Set("readSchedule", Napi::Function::New(env, shm::ReadSchedule));
  exports.Set("sendCommand", Napi::Function::New(env, shm::SendCommand));

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
