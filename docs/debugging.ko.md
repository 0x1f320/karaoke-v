# Debugging (한국어)

> 원문: **[debugging.md](debugging.md)**. 영어판이 원본이다.

overlay에는 에러 상태가 없다. 잘못되면 아무것도 안 그리거나, 맞는 것을 틀린 곳에 그린다 —
그래서 첫 수는 절대 grep이 아니라 **어느 계층이 답하기를 멈췄는지** 알아내는 것이다.

경로를 따라 내려간다. 아래 각 단계에는 자기 상태를 볼 방법이 있다.

## Running it

```sh
pnpm install
pnpm dev            # turbo run dev --filter @voxpane/app
```

체크아웃에는 Node뿐 아니라 **Rust**(`rustup`)가 필요하다: 두 플랫폼 helper가 Rust + napi-rs
이고, `dev`가 `^build`에 의존한다. Node-API 덕분에 바이너리 하나를 Node와 Electron이 모두
로드하므로 Electron용 재빌드 단계는 없다 — `rebuild:native`를 찾고 있다면, 그런 건 존재하지
않는다.

macOS에서 앱은 무엇이든 시작하기 전에 **Accessibility**가 필요하고, permissions 창이 그
게이트다. Screen Recording은 *필요 없다* — 점유 판정은 `CGWindowList`에서 bounds·pid·layer를
읽는데, 그 권한이 관장하는 대상이 아니다.

쓸모 있는 환경 변수: `SYNTHV_SCRIPTS_DIR`가 bridge script가 설치되는 위치를 override한다.
기본 경로 어느 것도 해당되지 않는 SynthV 설치를 위한 것이고, Turbo가 `dev`로 전달한다.

### Where output goes

| 프로세스 | 어디로 |
| --- | --- |
| main | `pnpm dev`를 돌린 터미널 |
| overlay renderer | 자체 DevTools 창 — dev에서 자동으로 열림 |
| toolbar renderer | 자체 DevTools 창 — dev에서 자동으로 열림 |
| settings / permissions renderer | 기본으로 DevTools 없음. 필요하면 `openDevTools`를 추가 |
| Lua script | **SynthV 바깥 어디에도 없음** — 아래 참조 |

script가 사각지대다. 개발자가 볼 수 있는 어디에도 로그를 남길 수 없고, 그래서 side panel로
보고하고 `dump`가 존재한다.

## 1. Is the app tracking SynthV?

증상: SynthV가 분명히 열려 있는데 overlay가 아예 없거나 엉뚱한 곳에 있다.

- **tray 메뉴에 답이 있다.** 메뉴 바 항목(macOS) / tray 아이콘(Windows)을 열면, 비활성화된
  첫 줄이 추적 상태다. stick observer가 `attached` / `waiting` / `hidden` / `permission`을
  보고한다. SynthV가 돌고 있는데 `waiting`이면 대상 탐색이 실패한 것이다 — macOS는 앱의 지역화된
  이름(`"synth"`), Windows는 실행 파일(`"synthv-studio"`)로 매칭한다(`shared/native.ts`).
  SynthV가 닫혀 있으면 5초 유예 뒤에 알림도 띄우는데, 로그인 시 자동 실행 경쟁 상황에서 알림이
  뜨지 않게 하려고 있는 유예다.
- `hidden`은 대상을 보여줄 수 없다는 뜻이다. macOS에서는 최소화·다른 Space뿐 아니라 **앞의
  창에 15 % 이상 덮인 경우**도 포함한다. Windows에서는 최소화되었거나 보이지 않는 경우뿐이고 —
  거기엔 점유 판정이 없다. overlay와 toolbar가 함께 숨는 것은 의도이지 버그가 아니다.
- `permission`은 macOS 전용이다: 실행 중에 Accessibility가 회수됐고, 게이트가 다시 올라온다.
- Windows에서 overlay 위치가 틀리면 다른 무엇보다 DIP transform을 먼저 의심할 것 —
  [geometry](geometry.ko.md#physical-pixels-points-and-dips) 참조.

이 단계가 `attached`라고 말하기 전까지는 아래 어느 것도 동작할 수 없다.

## 2. Is the script alive?

SynthV의 side panel을 열고 **Overlay Bridge**를 찾는다. 표시하는 것:

| 행 | 읽는 법 |
| --- | --- |
| `Version` | 어느 빌드가 로드됐는가 — 작업 사본이면 커밋 해시, 릴리스면 버전 |
| `Bridge` | `on` / `off`. 토글 버튼이 있다 |
| `Channels` | 디렉터리, 그리고 `seq`·`notes` 카운터와 마지막 에러 |
| `Transport` | script가 생각하는 재생 상태 |
| `Notes published` | 마지막으로 schedule을 보낼 때 나간 note 수 |
| `Loop` | 추론된 loop 경계, 또는 `not seen yet` — wrap에서만 학습된다 |
| `Last error` | `none`, 또는 throw한 tick의 메시지 |

버튼이 둘 있다: **Disable/Enable**, 그리고 note channel을 즉시 다시 발행하는
**Resend schedule** — 낡은 schedule이 문제인지 낡은 `rev`가 문제인지 가릴 때 쓸모 있다.

**panel이 아예 없다**는 것은 script가 로드되지 않았다는 뜻이다. 설치된 적이 없거나, SynthV가
시작한 뒤에 떨어졌거나 — SynthV는 scripts 디렉터리를 *시작할 때* 읽는다. **Scripts ▸ Rescan**
하거나 재시작할 것.

**`Version`이 예상한 빌드가 아닌 것**이 헷갈리는 디버깅 세션의 단일 최대 원인이다.
[Deploying a script change](#5-deploying-a-script-change) 참조.

**`seq`가 안 늘어난다**는 것은 tick loop가 죽었거나 bridge가 꺼져 있다는 뜻이다. `Last error`를
확인할 것 — 매번 throw하는 tick은 아무것도 발행하지 않아서 꺼진 bridge와 정확히 똑같아 보이고,
그렇게 packing 버그가 한동안 눈에 띄지 않았다.

## 3. Read the live state

```sh
pnpm --filter @voxpane/synthv-script dump
```

앱이 하는 방식대로 channel을 디코드한다. 아무것도 안 돌고 있으면:

```
directory: /Users/you/Library/Application Support/voxpane/bridge

session.json: ENOENT: no such file or directory, ...
state: ENOENT: ...
notes: ENOENT: ...
```

`ENOENT` 셋이 "여기에 script가 한 번이라도 publish한 적이 있는가"에 답한다 — 없다.

실제로 출력될 때 볼 것:

- **`session.json`** — `layout`이 `shared/bridgeChannels.ts`의 앱 쪽 `LAYOUT`과 일치해야 한다.
  어긋나면 앱이 (정확하게) 모든 레코드를 거부하고 있는 것이고, overlay는 다른 증상 없이 조용해진다.
  `host`도 실려 있어서, 사용자가 실제로 돌리는 editor 버전과 OS를 확인하는 가장 빠른 길이다.
- **`seq`** — `dump`를 1초 간격으로 두 번 돌린다. 안 움직이면 script가 tick하지 않는 것이다.
- **`status`**와 **`at`** — playhead가 SynthV가 보여주는 것과 맞는가?
- **`rev` / `notesSeq`** — SynthV에서 note를 편집하고 다시 dump한다. 둘 다 바뀌어야 한다.
  `rev`는 움직였는데 `notesSeq`가 그대로면 schedule 발행이 실패한 것이다.
- **`notes`** — note 수와 각 note의 `bend`. 모든 note가 `bend none`이면 engine이 그 group의
  계산된 pitch curve를 갖고 있지 않다는 뜻이고, 앱은 *합성된* contour를 그리고 있다. 지원되는
  상태이지 결함이 아니다 — 다만 `playback/pitch.ts`에서 완전히 다른 코드 경로이고, pitch 버그를
  파일의 엉뚱한 절반에서 디버깅하기 전에 알아둘 값어치가 있다.
- `[min..max] cents`로 출력되는 bend 범위는 그럴듯해야 한다. −6900 근처 값은 무성 frame이
  pitch로 읽히고 있다는 뜻이다 — [synthv](synthv.ko.md#the-computed-pitch-curve) 참조.

`dump`는 선택적으로 디렉터리 인자를 받아, 다른 곳의 channel을 읽을 수 있다.

## 4. Turn on debug mode

설정 ▸ General ▸ **Enable debug mode**. overlay 자체에 그리는 것:

- **모든 note의 rect** — 보이는 note set에 대한 current-frame prediction이고, effect와 같은
  frame transform을 거쳐 표현된다. 박스가 틀렸으면 effect는 애초에 맞을 수 없었고, 버그는
  effect가 아니라 [geometry](geometry.ko.md)에 있다.
- 울리는 note의 **매칭된 rect** — 강조 표시된다. 스크롤하면서 이걸 볼 것: note 사이를 건너뛰면
  그리기 버그가 아니라 매칭 버그다.
- **reach band** — 보이는 각 note의 effect가 세로로 얼마나 갈 수 있는지. pitch following이
  켜져 있고 *또한* 그 mode가 effect의 위치를 움직일 때만(`intensity`가 아닌 경우) 그린다.
  piano roll 가장자리를 넘어가는 band는 mask에 잘려 사라져 보일 effect다.
- **bridge channel diagnostics** — piano roll 우상단의 작은 panel에 `state`와 `notes` 각각 한 줄로
  표시한다. channel file의 filesystem `mtime` 기준 age, 마지막 size, accepted record가 현재
  draw까지 기다린 시간, 최신 read cost, accepted `seq` / `notesSeq` / `rev`를 보여준다. 각 channel
  line은 debug collection이 켜진 뒤 서로 다른 accepted record들의 accepted-to-draw `avg`, `min`,
  `max`, `p95`, `p99` 통계를 포함한다. `fail` line은 missing file, 거부된 record, `rev` mismatch를
  세고, `scroll` line은 현재 scroll timing과 scroll spike의 `avg`, `min`, `max`, `p95`, `p99`를
  보여준다. `n/a`는 그 channel의 유효 record가 아직 overlay cache에 도달하지 않았다는 뜻이다.
- **bridge timing graph** — piano roll 좌상단의 작은 graph에 최근 `state applied`, `state read`,
  `scroll applied` timing을 그린다. note timing은 text panel에만 남기고 graph에는 그리지 않는다.
  `scroll applied`는 bridge-derived viewport가 바뀐 때만 sample을 찍고, 그 state record가 overlay
  cache에 도달한 시점부터 그것을 사용하는 draw까지를 잰다. graph는 viewport가 바뀌지 않는 동안
  `scroll applied`를 `0`으로 그리므로, 실제로 새 scroll position을 적용한 frame만 spike로 보인다.
  graph의 max scale은 한번 커지면 그 spike가 visible window 밖으로 지나간 뒤에도 debug collection이
  reset될 때까지 유지된다. y-axis label은 유지된 scale 기준의 `max`, half-max, zero를 보여준다.
  다른 없는 sample은 0으로 잇지 않고 line을 끊는다.

debug mode가 켜져 있으면 scroll burst마다 overlay DevTools console에 latency report 한 줄도
찍힌다. 개발 중에는 main process terminal로도 `[voxpane latency] ...`가 전달되며, 현재
bottleneck 추정과 `native->applied`, `bridge->applied`, `applied->draw`, `viewportReadMax`
timing을 함께 보여준다. debug mode 없이 같은 report만 켜려면 overlay DevTools console에서
`localStorage.voxpaneLatencyProbe = "1"`을 설정한다.

박스는 맞는데 effect가 틀리면 ⇒ renderer. 박스가 틀리면 ⇒ 그 아래는 전부 잡음이다.

## 5. Deploying a script change

앱은 **빌드될 때** 함께 들어간 `.lua`를 설치하고, 버전 번호가 아니라 내용 해시를 비교한다.
그래서 앱의 번들 사본이 바뀌지 않았다면 앱을 다시 빌드해도 낡은 script가 살아남는다.

```sh
pnpm --filter @voxpane/synthv-script build    # typecheck → tstl → 앱 resources로 번들
pnpm --filter @voxpane/synthv-script deploy   # SynthV의 scripts 디렉터리로 바로 복사
```

그다음 SynthV에서 **Scripts ▸ Rescan**(또는 재시작). rescan은 모든 script를 다시 실행하고 이전
사본의 timer를 취소하므로, 옛 bridge가 새 것과 나란히 발행하는 대신 멈춘다. macOS에서는 앱이
설치 후 이것을 대신 해준다. Windows에서는 아직 못 한다(#78).

무엇이 실제로 로드됐는지는 side panel의 `Version`을 읽어 확인할 것 — 방금 무엇을 실행했는지
추론해서가 아니라.

> **`deploy`는 `out/`의 모든 `.lua`를 복사한다.** bridge *와* Lua smoke script 둘 다다. smoke
> script는 자기 16 ms loop로 **같은 channel에** 발행하는 두 번째 side panel section이라, 둘 다
> 로드되면 두 writer가 `state`와 `notes`를 두고 싸우고 앱은 뒤섞인 것을 본다. panel에
> *voxpane Lua smoke*가 bridge와 나란히 보이면, scripts 디렉터리에서 `voxpane-lua-smoke.lua`를
> 지우고 rescan할 것. 앱 자신의 설치기는 `overlay-bridge.lua`만 쓰므로, 이건 로컬 deploy에서만
> 생기는 위험이다.

smoke script는 Lua toolchain과 channel 계층에 대한 종단 검사로 존재한다 — bridge가 의존하는
모든 메커니즘을 건드리는 가장 작은 script라, toolchain 회귀가 bridge 안이 아니라 거기서 드러난다.
SynthV 바깥에서는 아무도 side panel을 읽을 수 없으므로, 자기 `smoke.json` 진단 channel을 쓴다.

## 6. Windows

저장소의 **`run-on-windows`** skill(`.agents/skills/run-on-windows/`)을 쓸 것. Windows에서
네이티브로 돌리는 것과 Mac에서 Parallels VM을 모는 것을 모두 다룬다. 그것을 우회해서 임기응변
하지 말 것 — 거기의 실패 방식이 특수해서 존재하는 문서다.

반복할 값어치가 있는 규칙 둘: 공유 폴더에서 절대 빌드하거나 실행하지 말 것 — 빌드 산출물은
플랫폼·ABI에 특정적이라 호스트 체크아웃을 망가뜨린다 — 그리고 물어보지 않고 VM 상태를 바꾸지
말 것.

macOS 체크아웃에서도 Windows crate는 여전히 컴파일된다:

```sh
cd packages/windows-helper && cargo check --target x86_64-pc-windows-msvc
```

`#[cfg(windows)]` 코드를 실제로 타입 체크하는 것이 그것이다. 다른 타깃에서는 crate가 비어 있게
빌드되고 아무것도 알려주지 않는다.

## 7. Symptom → technique

파일이 아니라 **technique**으로 라우팅한다: 찾고 있는 것은 이 증상을 만들어낼 수 있는
메커니즘이다. 모든 항목이 그 메커니즘이 설명된 곳으로 링크되고, 각 설명은 자기 실패 방식으로
끝난다.

| 증상 | 의심할 technique | 확인 |
| --- | --- | --- |
| SynthV는 열려 있는데 overlay 없음 | window tracking, [visibility gating](overlay.ko.md#visibility-gating) | tray 상태. 1단계 |
| overlay는 있는데 안 그려짐 | script, 또는 [layout 거부](bridge.ko.md#versioning) | side panel. `dump`. 2–3단계 |
| 그리다가 한참 뒤 멈춤 | `seq` 정지 — 세션 중간에 script가 죽음 | `Last error`. 2단계 |
| 스크롤할 때 overlay가 밀림 | [프레임 경로에 IPC 없음](overlay.ko.md#the-hot-path), `backgroundThrottling` | 뭔가 새로 main으로 넘어갔나? |
| 드래그할 때 overlay가 창을 쫓아감 | [디바운스된 조정](overlay.ko.md#native-placement-with-debounced-reconciliation), [드래그 예측](overlay.ko.md#cursor-based-drag-prediction) | Windows 전용 |
| overlay가 무관한 앱 위에 뜸 | [topmost가 아닌 소유권](overlay.ko.md#staying-above-synthv) | Windows 전용 |
| effect가 엉뚱한 시점에 터짐 | [playhead 보간](architecture.ko.md#the-frame-loop) | `dump`의 `at` vs SynthV의 playhead |
| effect가 엉뚱한 note에 붙음 | [예측-스냅 / 추적 / anchor](geometry.ko.md#matching-a-note-to-a-rectangle) | debug mode, 스크롤하면서 |
| 스크롤 중 effect가 어긋남 | [frame transform](geometry.ko.md#staying-aligned), [짝 샘플링](overlay.ko.md#sampling-paired-values-together) | 스크롤하면서 debug 박스 |
| read가 들어올 때 effect가 튐 | [좌표계 rebasing](effects.ko.md#coordinate-space-rebasing) | ~30 ms pump와 시점이 맞는가? |
| effect가 세로로 lane 하나 어긋남 | 세로 기준 | macOS: 추적 chip. Windows: `refY` |
| 스케일된 디스플레이에서 전부 어긋남 | [DIP transform](geometry.ko.md#physical-pixels-points-and-dips) | Windows 전용 |
| 편집했는데 note가 옛것 | [`rev` / `notesSeq` 페어링](bridge.ko.md#pairing-the-channels) | 편집 전후로 `dump` |
| effect가 빈 곳에서 터지거나 화면 밖으로 | pitch curve, [`NO_CURVE` padding](synthv.ko.md#the-computed-pitch-curve) | `dump`의 bend 범위 |
| onset이 밋밋하거나 glow가 안 놓임 | [합산되는 두 envelope](effects.ko.md#two-summed-envelopes) | `noteStarted`가 발생하는가? |
| note가 끝났는데 떨림이 이어짐 | [jitter는 곱해진다, 더해지지 않는다](effects.ko.md#smoothed-random-walk) | — |
| 120 Hz 디스플레이에서 effect가 두 배 | [frame-rate independence](effects.ko.md#frame-rate-independence) | 프레임 단위로 세는 것이 있는가? |
| 숨겼다 켜면 particle이 왈칵 터짐 | `dt` clamp | [frame-rate independence](effects.ko.md#frame-rate-independence) |
| particle이 날아가다 사라짐 | [pool 포화](effects.ko.md#sprite-pooling-with-a-hard-cap) | 살아 있는 sprite가 재활용되는가? |
| trail 뒤로 줄무늬가 남음 | [join rule](effects.ko.md#join-rules) — 또는 상류의 매칭 오류 | debug mode |
| 계단, 또는 긴 trail에서 프레임 드랍 | [양자화된 fade](effects.ko.md#quantized-fade) | — |
| import한 이미지가 안 나옴 | `asset://` scheme, 또는 실패한 로드 | DevTools 콘솔. 썸네일은 멀쩡한데 overlay만 안 되는가? |
| group 전환 후 옛 effect가 남음 | schedule revision 처리 | #90 |
| 한쪽 플랫폼에서만 동작 | [geometry 분기](geometry.ko.md#two-platforms-two-strategies) | — |

증상이 여기 없으면 `docs/README.ko.md`에 전체
[technique 색인](README.ko.md#technique-index)이 있다.

## 8. Before changing anything

```sh
pnpm check        # Biome lint + format
pnpm typecheck
pnpm test         # Vitest, 대상 파일 옆
```

테스트는 순수 로직만 다룬다 — bridge 디코딩, preferences, transport clock, note location,
frame 수학, DIP transform. Electron이나 native addon이나 진짜 piano roll이 필요한 것은 범위
밖이므로, **테스트가 초록이라는 것이 overlay가 정렬된다는 말은 전혀 아니다.** geometry 버그를
고쳤다면 정직한 검증은 앱을 띄우고 debug mode를 켜는 것이고, 수정이 산술이었다면 순수 함수로
빼서 그것을 테스트할 것.
