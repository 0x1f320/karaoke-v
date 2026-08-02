// Reads the SynthV bridge script's shared buffer straight out of the SynthV
// process. The script has no file, socket or shared-section API — it can only
// allocate an ArrayBuffer — so the buffer is found by scanning the target's
// address space for a magic header and validating it.
//
// Three discovery rules are load-bearing, each learned from a failed attempt:
//
//   * The magic must be validated, never trusted. The script's own source text
//     lives in the same heap, so any byte sequence we look for can also appear
//     there. Only a candidate whose totalSize and trailing magic agree is ours.
//   * The buffer is not at its region's base — it was observed at base + 96 in a
//     region one page larger than the allocation. Scan region contents.
//   * Re-running the script leaves the previous buffer alive with its own tick
//     loop still writing to it. Pick the highest epoch whose heartbeat advances.

#include "shm.h"

#include <windows.h>
#include <tlhelp32.h>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

namespace shm {
namespace {

constexpr uint8_t kMagic[8] = {0x4b, 0x56, 0x2d, 0x53, 0x48, 0x4d, 0x00, 0x01};
constexpr uint32_t kExpectedSize = 4 * 1024 * 1024;
constexpr uint32_t kVersion = 1;

constexpr uintptr_t HDR_TOTAL_SIZE = 0x08;
constexpr uintptr_t HDR_VERSION = 0x0c;
constexpr uintptr_t HDR_EPOCH = 0x10;
constexpr uintptr_t HDR_HEARTBEAT = 0x18;
constexpr uintptr_t HDR_TICK_MS = 0x1c;
constexpr uintptr_t HDR_SCHED_OFF = 0x28;
constexpr uintptr_t HDR_SCHED_SLOT_SIZE = 0x2c;
constexpr uintptr_t HDR_SCHED_ACTIVE = 0x30;
constexpr uintptr_t HDR_SCHED_REVISION = 0x34;
constexpr uintptr_t HDR_CMD_SEQ = 0x38;
constexpr uintptr_t HDR_CMD = 0x3c;
constexpr uintptr_t HDR_CMD_ARG = 0x40;
constexpr uintptr_t HDR_CMD_ACK = 0x48;
constexpr uintptr_t HDR_HOST_HEARTBEAT = 0x4c;

// The script rewrites the hot slot every ~16ms and the write itself is a few
// microseconds, so even a handful of attempts effectively never runs out.
constexpr int kSeqlockAttempts = 8;
constexpr int kScheduleAttempts = 4;

constexpr uintptr_t HOT_OFF = 0x80;
constexpr uintptr_t HOT_SEQ_END = 0x60;

constexpr uintptr_t SLOT_REVISION = 0x00;
constexpr uintptr_t SLOT_NOTE_COUNT = 0x04;
constexpr uintptr_t SLOT_TIME_OFFSET = 0x08;
constexpr uintptr_t SLOT_PITCH_OFFSET = 0x10;
constexpr uintptr_t SLOT_LYRIC_OFF = 0x14;
constexpr uintptr_t SLOT_LYRIC_BYTES = 0x18;
constexpr uintptr_t SLOT_NOTES = 0x20;
constexpr size_t NOTE_STRIDE = 0x30;

#pragma pack(push, 1)
struct HotSlot {
  uint32_t seq;
  uint32_t status;
  double tickTimeMs;
  double playheadSec;
  double playheadBlick;
  double viewT0;
  double viewT1;
  double viewV0;
  double viewV1;
  double pxPerBlick;
  double pxPerValue;
  double x0;
  double y0;
  uint32_t seqEnd;
};

struct NoteRecord {
  double onsetBlick;
  double endBlick;
  double onsetSec;
  double endSec;
  int32_t pitch;
  uint32_t lyricOff;
  uint32_t lyricLen;
  uint32_t pad;
};
#pragma pack(pop)

static_assert(sizeof(NoteRecord) == NOTE_STRIDE, "note record must match the wire layout");
static_assert(offsetof(HotSlot, seqEnd) == HOT_SEQ_END, "hot slot must match the wire layout");

HANDLE gProcess = nullptr;
uintptr_t gBase = 0;

bool Read(uintptr_t address, void *out, size_t size) {
  if (!gProcess) {
    return false;
  }
  SIZE_T got = 0;
  if (!ReadProcessMemory(gProcess, reinterpret_cast<LPCVOID>(address), out, size, &got)) {
    return false;
  }
  return got == size;
}

bool Write(uintptr_t address, const void *data, size_t size) {
  if (!gProcess) {
    return false;
  }
  SIZE_T put = 0;
  if (!WriteProcessMemory(gProcess, reinterpret_cast<LPVOID>(address), data, size, &put)) {
    return false;
  }
  return put == size;
}

template <typename T>
bool ReadValue(uintptr_t address, T *out) {
  return Read(address, out, sizeof(T));
}

DWORD FindProcess(const std::wstring &needle) {
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) {
    return 0;
  }
  PROCESSENTRY32W entry{};
  entry.dwSize = sizeof(entry);
  DWORD found = 0;
  if (Process32FirstW(snapshot, &entry)) {
    do {
      std::wstring name(entry.szExeFile);
      std::transform(name.begin(), name.end(), name.begin(), ::towlower);
      if (name.find(needle) != std::wstring::npos) {
        found = entry.th32ProcessID;
        break;
      }
    } while (Process32NextW(snapshot, &entry));
  }
  CloseHandle(snapshot);
  return found;
}

bool Validate(uintptr_t candidate) {
  uint32_t totalSize = 0;
  if (!ReadValue(candidate + HDR_TOTAL_SIZE, &totalSize) || totalSize != kExpectedSize) {
    return false;
  }
  uint8_t tail[sizeof(kMagic)] = {};
  if (!Read(candidate + totalSize - sizeof(kMagic), tail, sizeof(tail))) {
    return false;
  }
  return memcmp(tail, kMagic, sizeof(kMagic)) == 0;
}

std::vector<uintptr_t> ScanCandidates() {
  std::vector<uintptr_t> hits;
  MEMORY_BASIC_INFORMATION mbi{};
  uintptr_t address = 0;
  std::vector<uint8_t> chunk(1 << 20);

  while (VirtualQueryEx(gProcess, reinterpret_cast<LPCVOID>(address), &mbi, sizeof(mbi)) ==
         sizeof(mbi)) {
    const size_t regionSize = mbi.RegionSize;
    if (regionSize == 0) {
      break;
    }
    const bool interesting = mbi.State == MEM_COMMIT && mbi.Type == MEM_PRIVATE &&
                             mbi.Protect == PAGE_READWRITE && regionSize >= kExpectedSize;
    if (interesting) {
      const uintptr_t regionBase = reinterpret_cast<uintptr_t>(mbi.BaseAddress);
      size_t offset = 0;
      while (offset < regionSize) {
        const size_t want = std::min(chunk.size(), regionSize - offset);
        if (Read(regionBase + offset, chunk.data(), want)) {
          for (size_t i = 0; i + sizeof(kMagic) <= want; i++) {
            if (memcmp(chunk.data() + i, kMagic, sizeof(kMagic)) != 0) {
              continue;
            }
            const uintptr_t candidate = regionBase + offset + i;
            if (Validate(candidate)) {
              hits.push_back(candidate);
            }
          }
        }
        if (want < chunk.size()) {
          break;
        }
        offset += want - (sizeof(kMagic) - 1);
      }
    }
    address += regionSize;
  }
  return hits;
}

void Release() {
  if (gProcess) {
    CloseHandle(gProcess);
    gProcess = nullptr;
  }
  gBase = 0;
}

}  // namespace

Napi::Value Attach(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  std::wstring needle = L"synthv-studio";
  if (info.Length() > 0 && info[0].IsString()) {
    std::u16string given = info[0].As<Napi::String>().Utf16Value();
    needle.assign(given.begin(), given.end());
    std::transform(needle.begin(), needle.end(), needle.begin(), ::towlower);
  }

  Release();

  const DWORD pid = FindProcess(needle);
  if (pid == 0) {
    return env.Null();
  }
  gProcess = OpenProcess(
      PROCESS_QUERY_INFORMATION | PROCESS_VM_READ | PROCESS_VM_WRITE | PROCESS_VM_OPERATION,
      FALSE, pid);
  if (!gProcess) {
    return env.Null();
  }

  std::vector<uintptr_t> hits = ScanCandidates();
  if (hits.empty()) {
    Release();
    return env.Null();
  }

  // A stale buffer from a previous run keeps its own tick loop, so liveness has
  // to be observed rather than assumed.
  std::vector<uint32_t> before(hits.size());
  for (size_t i = 0; i < hits.size(); i++) {
    ReadValue(hits[i] + HDR_HEARTBEAT, &before[i]);
  }
  Sleep(50);

  uintptr_t best = 0;
  double bestEpoch = -1.0;
  for (size_t i = 0; i < hits.size(); i++) {
    uint32_t now = 0;
    double epoch = 0.0;
    if (!ReadValue(hits[i] + HDR_HEARTBEAT, &now) || now == before[i]) {
      continue;
    }
    if (ReadValue(hits[i] + HDR_EPOCH, &epoch) && epoch > bestEpoch) {
      bestEpoch = epoch;
      best = hits[i];
    }
  }
  if (best == 0) {
    Release();
    return env.Null();
  }

  gBase = best;
  uint32_t version = 0;
  uint32_t tickMs = 0;
  ReadValue(gBase + HDR_VERSION, &version);
  ReadValue(gBase + HDR_TICK_MS, &tickMs);

  Napi::Object result = Napi::Object::New(env);
  result.Set("pid", Napi::Number::New(env, pid));
  result.Set("address", Napi::String::New(env, std::to_string(gBase)));
  result.Set("version", Napi::Number::New(env, version));
  result.Set("epochMs", Napi::Number::New(env, bestEpoch));
  result.Set("tickMs", Napi::Number::New(env, tickMs));
  result.Set("candidates", Napi::Number::New(env, static_cast<double>(hits.size())));
  return result;
}

Napi::Value Detach(const Napi::CallbackInfo &info) {
  Release();
  return info.Env().Undefined();
}

// Deliberately stateless and magic-only: this runs on the per-frame path, and a
// heartbeat comparison there would answer "is the script alive" by looking at two
// samples closer together than one script tick, which says nothing. Liveness is
// judged in JavaScript, where the heartbeat is already being read anyway.
Napi::Value IsAttached(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!gProcess || gBase == 0) {
    return Napi::Boolean::New(env, false);
  }
  uint8_t magic[sizeof(kMagic)] = {};
  const bool intact =
      Read(gBase, magic, sizeof(magic)) && memcmp(magic, kMagic, sizeof(kMagic)) == 0;
  return Napi::Boolean::New(env, intact);
}

Napi::Value ReadState(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!gProcess || gBase == 0) {
    return env.Null();
  }

  // A seqlock reader retries; it does not fail. Returning null on a torn read
  // would hand the caller a frame with no geometry, and the overlay would blink
  // out for it — the write takes microseconds, so another attempt always beats
  // dropping the frame.
  HotSlot hot{};
  bool got = false;
  for (int attempt = 0; attempt < kSeqlockAttempts && !got; attempt++) {
    if (!Read(gBase + HOT_OFF, &hot, sizeof(hot))) {
      return env.Null();
    }
    got = hot.seq == hot.seqEnd && (hot.seq & 1u) == 0;
  }
  if (!got) {
    return env.Null();
  }

  uint32_t heartbeat = 0;
  ReadValue(gBase + HDR_HEARTBEAT, &heartbeat);

  Napi::Object out = Napi::Object::New(env);
  out.Set("seq", Napi::Number::New(env, hot.seq));
  out.Set("heartbeat", Napi::Number::New(env, heartbeat));
  out.Set("status", Napi::Number::New(env, hot.status));
  out.Set("tickTimeMs", Napi::Number::New(env, hot.tickTimeMs));
  out.Set("playheadSec", Napi::Number::New(env, hot.playheadSec));
  out.Set("playheadBlick", Napi::Number::New(env, hot.playheadBlick));
  out.Set("viewT0", Napi::Number::New(env, hot.viewT0));
  out.Set("viewT1", Napi::Number::New(env, hot.viewT1));
  out.Set("viewV0", Napi::Number::New(env, hot.viewV0));
  out.Set("viewV1", Napi::Number::New(env, hot.viewV1));
  out.Set("pxPerBlick", Napi::Number::New(env, hot.pxPerBlick));
  out.Set("pxPerValue", Napi::Number::New(env, hot.pxPerValue));
  out.Set("x0", Napi::Number::New(env, hot.x0));
  out.Set("y0", Napi::Number::New(env, hot.y0));
  return out;
}

Napi::Value GetScheduleRevision(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  uint32_t revision = 0;
  if (!gProcess || gBase == 0 || !ReadValue(gBase + HDR_SCHED_REVISION, &revision)) {
    return env.Null();
  }
  return Napi::Number::New(env, revision);
}

Napi::Value ReadSchedule(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!gProcess || gBase == 0) {
    return env.Null();
  }

  uint32_t schedOff = 0;
  uint32_t slotSize = 0;
  if (!ReadValue(gBase + HDR_SCHED_OFF, &schedOff) ||
      !ReadValue(gBase + HDR_SCHED_SLOT_SIZE, &slotSize) || slotSize == 0) {
    return env.Null();
  }

  // Same rule as the hot slot: a publish landing mid-read is a retry, not a
  // failure. Schedules change a few times a minute, so this practically never
  // spins more than once.
  uintptr_t slot = 0;
  uint32_t revision = 0;
  uint32_t count = 0;
  double timeOffset = 0.0;
  int32_t pitchOffset = 0;
  std::vector<NoteRecord> records;
  bool got = false;

  for (int attempt = 0; attempt < kScheduleAttempts && !got; attempt++) {
    uint32_t active = 0;
    if (!ReadValue(gBase + HDR_SCHED_ACTIVE, &active) ||
        !ReadValue(gBase + HDR_SCHED_REVISION, &revision) || active > 1) {
      return env.Null();
    }
    slot = gBase + schedOff + static_cast<uintptr_t>(active) * slotSize;

    uint32_t slotRevision = 0;
    if (!ReadValue(slot + SLOT_REVISION, &slotRevision) ||
        !ReadValue(slot + SLOT_NOTE_COUNT, &count) ||
        !ReadValue(slot + SLOT_TIME_OFFSET, &timeOffset) ||
        !ReadValue(slot + SLOT_PITCH_OFFSET, &pitchOffset)) {
      return env.Null();
    }
    if (slotRevision != revision ||
        static_cast<size_t>(count) * NOTE_STRIDE + SLOT_NOTES > slotSize) {
      continue;
    }

    records.assign(count, NoteRecord{});
    if (count > 0 &&
        !Read(slot + SLOT_NOTES, records.data(), records.size() * sizeof(NoteRecord))) {
      return env.Null();
    }

    uint32_t after = 0;
    if (!ReadValue(gBase + HDR_SCHED_REVISION, &after)) {
      return env.Null();
    }
    got = after == revision;
  }
  if (!got) {
    return env.Null();
  }

  // One read for the whole lyric pool. Reading per note would put a
  // cross-process round trip on every note of every schedule refresh.
  uint32_t poolOff = 0;
  uint32_t poolBytes = 0;
  std::vector<uint8_t> pool;
  if (ReadValue(slot + SLOT_LYRIC_OFF, &poolOff) &&
      ReadValue(slot + SLOT_LYRIC_BYTES, &poolBytes) && poolBytes > 0 &&
      static_cast<size_t>(poolOff) + poolBytes <= slotSize) {
    pool.resize(poolBytes);
    if (!Read(slot + poolOff, pool.data(), pool.size())) {
      pool.clear();
    }
  }

  Napi::Array notes = Napi::Array::New(env, count);
  for (uint32_t i = 0; i < count; i++) {
    const NoteRecord &rec = records[i];
    Napi::Object note = Napi::Object::New(env);
    note.Set("onsetBlick", Napi::Number::New(env, rec.onsetBlick));
    note.Set("endBlick", Napi::Number::New(env, rec.endBlick));
    note.Set("onsetSec", Napi::Number::New(env, rec.onsetSec));
    note.Set("endSec", Napi::Number::New(env, rec.endSec));
    note.Set("pitch", Napi::Number::New(env, rec.pitch));

    std::u16string lyric;
    const size_t start = rec.lyricOff >= poolOff ? rec.lyricOff - poolOff : pool.size();
    const size_t bytes = static_cast<size_t>(rec.lyricLen) * 2;
    if (rec.lyricLen > 0 && start + bytes <= pool.size()) {
      lyric.assign(reinterpret_cast<const char16_t *>(pool.data() + start), rec.lyricLen);
    }
    note.Set("lyric", Napi::String::New(env, lyric));
    notes.Set(i, note);
  }

  Napi::Object out = Napi::Object::New(env);
  out.Set("revision", Napi::Number::New(env, revision));
  out.Set("timeOffset", Napi::Number::New(env, timeOffset));
  out.Set("pitchOffset", Napi::Number::New(env, pitchOffset));
  out.Set("notes", notes);
  return out;
}

Napi::Value SendCommand(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!gProcess || gBase == 0) {
    return env.Null();
  }
  const uint32_t command = info.Length() > 0 ? info[0].As<Napi::Number>().Uint32Value() : 0;
  const double arg = info.Length() > 1 ? info[1].As<Napi::Number>().DoubleValue() : 0.0;

  uint32_t seq = 0;
  ReadValue(gBase + HDR_CMD_SEQ, &seq);
  seq++;

  // Payload before the sequence bump: the script watches cmdSeq, so it must not
  // see a new sequence pointing at a command that has not landed yet.
  if (!Write(gBase + HDR_CMD, &command, sizeof(command)) ||
      !Write(gBase + HDR_CMD_ARG, &arg, sizeof(arg)) ||
      !Write(gBase + HDR_CMD_SEQ, &seq, sizeof(seq))) {
    return env.Null();
  }
  return Napi::Number::New(env, seq);
}

}  // namespace shm
