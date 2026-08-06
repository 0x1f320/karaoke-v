# voxpane docs (한국어)

> 원문: **[README.md](README.md)**. 영어판이 원본이고 이 문서는 번역이다 — 동작이 바뀌면
> **영어판을 먼저 고치고** 같은 커밋에서 이쪽을 맞춘다.
>
> 기술 용어와 고유명사는 영어 그대로 둔다. 제목도 원문과 동일하게 유지해서, 두 언어 사이를
> 오갈 때 같은 anchor로 떨어지게 했다.

이 코드를 건드리려는 사람을 위한 맥락 — Synthesizer V가 무엇인지, note가 piano roll에서
overlay까지 어떻게 오는지, 각 부분이 어떤 technique 위에 서 있는지, 그리고 돌아가는
시스템을 추측하는 대신 어떻게 들여다보는지.

이건 **convention이 아니다**. 커밋·주석·i18n·테스트는 `CLAUDE.md` / `AGENTS.md`가 다루고,
이 트리는 동작을 다룬다.

## Read in this order

1. **[architecture.ko.md](architecture.ko.md)** — 전체 경로, 끝에서 끝까지. 항상 여기서 시작한다.
2. **[synthv.ko.md](synthv.ko.md)** — host application: 객체 모델, 단위, Lua host, 그리고
   코드가 우회하고 있는 engine 동작들.
3. **[bridge.ko.md](bridge.ko.md)** — script와 app 사이의 데이터 channel.
4. **[geometry.ko.md](geometry.ko.md)** — 좌표계, 그리고 macOS와 Windows가 같은 문제를 왜
   정반대에서 푸는지.
5. **[overlay.ko.md](overlay.ko.md)** — 창 자체: 어떻게 붙고 따라가고 비켜서는지, 그리고
   hot path가 왜 거기에 있는지.
6. **[effects.ko.md](effects.ko.md)** — 실제로 그려지는 것: glow, particles, trail,
   pitch following, 그리고 셋이 공유하는 scene.
7. **[debugging.ko.md](debugging.ko.md)** — 이 모든 것을 돌아가는 중에 관찰하는 법.

## Where to look first

| 증상 | 계층 | 문서 |
| --- | --- | --- |
| SynthV는 떠 있는데 overlay가 아예 없음 | window tracking, 또는 permissions gate | [debugging](debugging.ko.md#1-is-the-app-tracking-synthv), [overlay](overlay.ko.md#following-the-frame) |
| overlay는 있는데 아무것도 안 그려짐 | script가 publish하지 않음 | [debugging](debugging.ko.md#2-is-the-script-alive), [bridge](bridge.ko.md) |
| 스크롤할 때 overlay가 밀림 | hot path, 또는 throttling | [overlay](overlay.ko.md#the-hot-path) |
| 드래그 중 overlay가 창을 쫓아감 | bounds reconciliation | [overlay](overlay.ko.md#native-placement-with-debounced-reconciliation) |
| overlay가 무관한 앱 위에 뜸 | visibility gating | [overlay](overlay.ko.md#visibility-gating) |
| effect가 엉뚱한 시점에 터짐 | transport clock | [architecture](architecture.ko.md#the-frame-loop) |
| effect가 엉뚱한 note에 붙음 | note matching | [geometry](geometry.ko.md#matching-a-note-to-a-rectangle) |
| 스크롤·줌 중 effect가 어긋남 | frame transform | [geometry](geometry.ko.md#staying-aligned) |
| note read가 들어올 때 effect가 튐 | coordinate-space rebasing | [effects](effects.ko.md#coordinate-space-rebasing) |
| onset이 밋밋하거나 glow가 안 꺼짐 | glow envelope | [effects](effects.ko.md#two-summed-envelopes) |
| 120Hz 디스플레이에서 particle이 두 배 | frame-rate independence | [effects](effects.ko.md#frame-rate-independence) |
| trail 뒤로 줄무늬가 남음 | trail의 join rule | [effects](effects.ko.md#join-rules) |
| SynthV에서 편집했는데 note가 옛것 | `rev` / `notesSeq` pairing | [bridge](bridge.ko.md#pairing-the-channels) |
| effect가 화면 밖으로 날아가거나 빈 곳에서 터짐 | pitch curve | [synthv](synthv.ko.md#the-computed-pitch-curve), [effects](effects.ko.md#pitch-following) |
| import한 이미지가 안 나옴 | asset scheme | [effects](effects.ko.md#presets-images-and-the-preview) |
| 한쪽 플랫폼에서만 깨짐 | geometry 분기 | [geometry](geometry.ko.md#two-platforms-two-strategies) |
| 스케일된 디스플레이에서 Windows만 어긋남 | DIP transform | [geometry](geometry.ko.md#physical-pixels-points-and-dips) |
| 이 문서대로 동작하지 않음 | 문서가 낡은 것 — 고쳐라 | — |

## Technique index

제품 안의 자명하지 않은 technique 전부, 어디에 설명되어 있는지, 무엇이 쓰는지. technique
에는 **집이 하나뿐**이고, 나머지는 전부 그리로 링크한다.

| Technique | 집 | 쓰는 곳 |
| --- | --- | --- |
| Replace-in-place channels, no queue | [bridge](bridge.ko.md#the-channels) | 데이터 경로 전체 |
| One write per record (atomicity) | [bridge](bridge.ko.md#atomicity) | script의 channel 쓰기 |
| `rev` / `notesSeq` pairing | [bridge](bridge.ko.md#pairing-the-channels) | schedule 신선도, group 전환 |
| Refuse-on-unknown-layout | [bridge](bridge.ko.md#versioning) | 모든 decoder, `dump.mjs` 포함 |
| Playhead interpolation on the local clock | [architecture](architecture.ko.md#the-frame-loop) | transport, 모든 effect 타이밍 |
| Predict-and-snap, follow, anchor | [geometry](geometry.ko.md#matching-a-note-to-a-rectangle) | note matching, debug reach band |
| Read-scoped coordinate frames | [geometry](geometry.ko.md#staying-aligned) | matching, 그리고 살아 있는 모든 effect |
| Coordinate-space rebasing | [geometry](geometry.ko.md#staying-aligned) | 매칭된 rect, anchor, 모든 effect — [effects](effects.ko.md#coordinate-space-rebasing) |
| Stability flags on a read | [geometry](geometry.ko.md#staying-aligned) | macOS note pump |
| DIP conversion | [geometry](geometry.ko.md#physical-pixels-points-and-dips) | 창 배치, 모든 Windows geometry |
| Canvas identification by implied size | [geometry](geometry.ko.md#two-platforms-two-strategies) | Windows UIA 탐색 |
| Native placement + debounced reconciliation | [overlay](overlay.ko.md#native-placement-with-debounced-reconciliation) | Windows의 overlay 창 |
| Cursor-based drag prediction | [overlay](overlay.ko.md#cursor-based-drag-prediction) | Windows의 overlay와 toolbar |
| Window ownership instead of topmost | [overlay](overlay.ko.md#staying-above-synthv) | Windows의 overlay |
| Visibility and occlusion gating | [overlay](overlay.ko.md#visibility-gating) | overlay, toolbar, tray 상태 |
| No IPC in the per-frame path | [overlay](overlay.ko.md#the-hot-path) | bridge 읽기, geometry 읽기 |
| Sampling paired values together | [overlay](overlay.ko.md#sampling-paired-values-together) | transport, frame transform |
| Docking with hysteresis | [overlay](overlay.ko.md#docking-with-hysteresis) | toolbar |
| Two summed envelopes | [effects](effects.ko.md#two-summed-envelopes) | glow |
| Smoothed random walk | [effects](effects.ko.md#smoothed-random-walk) | glow jitter |
| Sprite pooling with a hard cap | [effects](effects.ko.md#sprite-pooling-with-a-hard-cap) | particles, trail sparkle |
| Reach-parameterised motion | [effects](effects.ko.md#reach-parameterised-motion) | particles |
| Quantized fade | [effects](effects.ko.md#quantized-fade) | trail ribbon |
| Join rules | [effects](effects.ko.md#join-rules) | trail |
| Frame-rate independence | [effects](effects.ko.md#frame-rate-independence) | 모든 effect, 배출률 |
| Procedural textures, built once | [effects](effects.ko.md#procedural-textures-built-once) | glow shape, spark |
| Blend and tint duality | [effects](effects.ko.md#blend-and-tint-duality) | glow, particles, import한 이미지 |
| Synthesized pitch fallback | [effects](effects.ko.md#pitch-following) | pitch following, 설정 preview |
| Measured, not documented | [synthv](synthv.ko.md#the-computed-pitch-curve) | engine에 닿는 모든 것 |

## How to write in here

- **영어판이 원본이다.** 동작이 바뀌면 영어를 먼저 고치고, 같은 커밋에서 이 번역을 맞춘다.
  낡은 문서는 없느니만 못하다 — 다음 사람이 코드 대신 그걸 믿기 때문이다.
- **기술 용어와 고유명사는 영어로 둔다.** 한국어로 옮기면 코드의 식별자와 연결이 끊기고,
  같은 개념에 두 개의 이름이 생긴다.
- **왜**와 **어디서**를 말한다. 코드가 이미 말하는 것을 다시 쓰지 않는다: API 나열은 뭔가
  이름이 바뀌는 순간 낡고, 이 코드베이스의 모듈 헤더가 이미 설명을 담고 있다. 거기로
  링크한다.
- **technique에는 집이 하나다.** 두 곳에서 쓰이면 한 번 설명하고 두 번째에서 링크한다 —
  그리고 위 색인에 양방향으로 추가한다.
- **모든 technique 항목은 "깨지면 무슨 일이 일어나는가"로 끝난다.** 독자가 들고 오는 것이
  바로 그 증상이고, 그게 없으면 항목은 잡학이 된다.
- **관찰된** SynthV 동작은 관찰된 것이라고 표시한다. engine의 pitch 계산이나 메뉴에 대해
  문서화된 것은 거의 없다 — 어떤 주장이 측정에서 왔는지 알아야 어떤 것을 다시 확인해야
  할지 알 수 있다.
