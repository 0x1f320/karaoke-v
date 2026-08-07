# Bridge and Canvas Read Path Design

## Context

SynthV bridge는 이미 4 ms마다 piano roll의 전체 scroll 및 zoom transform을 발행한다.
그런데 renderer는 frame loop, viewport manager, note pump에서 같은 `state` record를 각각
읽는다. Viewport manager도 macOS Accessibility를 8 ms마다 polling하며, 실제로는 piano-roll
canvas rectangle만 사용하면서 버려지는 content 및 reference-note frame까지 읽는다.

따라서 현재 경로에는 피할 수 있는 비용이 두 가지 있다. Renderer main thread에서 동기 AX
IPC를 수행하고, 하나의 render frame을 위해 서로 다른 시점의 bridge snapshot 여러 개를
만든다.

## Goals

- Bridge `state` record를 render frame마다 정확히 한 번 읽는다.
- `notesSeq`가 변경될 때만 `notes` record를 읽는다.
- Bridge view transform을 piano-roll scroll 및 zoom의 유일한 source로 사용한다.
- macOS AX는 canvas rectangle의 발견과 검증에만 사용한다.
- 평상시 canvas를 250 ms마다 갱신하면서 window drag alignment를 유지한다.
- Renderer main thread에서 동기 AX 작업을 제거한다.
- 기존 torn-record, stale-cache 및 target disappearance 동작을 보존한다.

## Non-goals

- SynthV script의 4 ms 발행 주기 변경.
- File channel을 socket, watcher 또는 shared memory로 교체.
- Note effect 또는 시각적 동작 변경.
- macOS Accessibility permission 요구 사항 제거.

## Considered Approaches

### 1. Change only the viewport interval

현재 interval을 8 ms에서 250 ms로 높이는 방법은 작지만, 중복 state read, 사용되지 않는 AX
attribute, window drag 중 stale해지는 global canvas rectangle을 그대로 둔다. 부하는 줄지만
ownership은 바로잡지 못한다.

### 2. Push every target-window frame through Electron IPC

Main process는 이미 target-window 이동을 관찰하므로 모든 frame을 renderer에 전달할 수 있다.
하지만 이 방식은 geometry hot path에 main-process IPC를 다시 넣고 기존 native-follow 설계와
충돌한다.

### 3. Consolidate state and cache a window-local canvas

이 방식을 선택한다. Renderer는 rAF 시점에 state를 한 번 읽는다. 느린 async canvas manager는
canvas를 target-window-local coordinate로 저장하므로 native helper가 overlay를 SynthV와 함께
움직이는 동안에도 canvas가 정확하다. AX는 전체 window translation이 아니라 내부 piano-roll
layout이 변경될 때만 필요하다.

## Architecture

### Frame snapshot

rAF callback만 `bridge.readState()`를 소유한다. 읽은 state와 최신 canvas snapshot을 transport에
전달한다. Transport는 더 이상 state channel을 직접 열지 않는다.

동일한 state object가 transport status, playhead anchoring, viewport 구성 및 note geometry를
구동한다. 따라서 한 frame에서 서로 다른 `seq`의 transport와 mapping을 섞지 않는다.

새 state record 사이의 playhead는 기존처럼 local clock으로 보간한다. Record가 없거나 변경되지
않으면 기존 500 ms silence 동작을 유지한다.

### Schedule ownership

Transport가 decoded schedule의 owner로 남는다. Frame state의 `notesSeq`가 달라지면 notes channel을
한 번 읽는다. Torn record는 accepted generation을 변경하지 않으므로 다음 frame에서 재시도한다.

독립 note pump는 제거한다. Cached `PianoRoll` base는 accepted schedule generation 또는 canvas
layout이 바뀔 때만 다시 만든다. Scroll과 zoom에서는 다시 만들지 않고 기존 frame rebasing이
cached rectangle에 live bridge transform을 적용한다.

### Canvas manager

Viewport manager는 canvas manager로 바뀌며 bridge state를 읽지 않는다. 즉시 async read를 한 번
시작하고, 각 완료 후 250 ms를 기다린 다음 다음 read를 시작한다. Read는 겹치지 않는다. Layout
transition과 경합한 read가 실패해도 마지막 valid canvas를 계속 사용한다.

macOS native 결과는 target window 기준으로 표현한다. SynthV가 이동해도 이 rectangle은 바뀌지
않고, 기존 native window follower가 overlay를 같은 거리만큼 이동한다. Resize 또는 내부 panel
변경은 다음 250 ms read에 반영된다.

Windows에서는 기존 UI Automation canvas discovery와 함께 읽은 window origin을 canvas snapshot의
source로 유지한다. 이 설계는 Windows 동작을 변경하지 않는다.

### macOS AX boundary

macOS helper에 async canvas-only read를 추가한다. Steady-state cache는 target window와 piano-roll의
horizontal 및 vertical scrollbar를 보관한다. Worker는 이들의 frame을 읽어 canvas rectangle을
계산하고 target-window-local coordinate를 반환한다.

Content group이나 reference note는 읽지 않는다. 이 element들은 과거 AX 기반 geometry path에서
scroll을 나타냈지만 현재 scroll은 bridge의 `getNavigation()`에서 온다.

Cache miss 또는 stale element에서는 기존 async full piano-roll walk를 수행한다. 이 walk는 canvas,
top inset 및 cache element를 다시 찾기 위해 group과 note-shaped chip을 계속 조사할 수 있지만
steady-state path는 아니다.

## Data Flow

```text
SynthV script, every 4 ms
  -> state file: transport + view transform + notesSeq

Renderer, every rAF
  -> state 한 번 읽기
  -> notesSeq 변경 시에만 notes 읽기
  -> state와 최신 local canvas 결합
  -> transport, viewport 및 effect 갱신

Canvas manager, every 250 ms
  -> async native canvas-only read
  -> 최신 valid local canvas 유지
  -> cache miss에서만 full async AX walk
```

## Error Handling

- Torn 또는 읽을 수 없는 state record는 해당 frame을 건너뛰고 이전 transport anchor를 보존한다.
- Torn notes record는 accepted `notesSeq`를 올리지 않고 다음 frame에서 재시도한다.
- Canvas refresh 실패 시 target이 attached 상태인 동안 마지막 valid canvas를 유지한다.
- Stale macOS AX cache는 지우고 기존 full async walk를 통해 복구한다.
- Target visibility와 disappearance는 계속 main-process tracking loop가 소유한다.

## Testing

- Transport test에서 외부에서 전달한 state가 추가 read 없이 사용되는지 검증한다.
- Transport test에서 accepted `notesSeq`당 schedule read가 한 번인지, torn read가 재시도되는지 검증한다.
- Canvas-manager test에서 즉시 첫 read, 250 ms steady cadence, non-overlap, 마지막 valid result 보존을 검증한다.
- Pure geometry test에서 target-window translation이 local canvas를 변경하지 않는지 검증한다.
- 기존 frame, note-location, bridge decoder 및 transport suite를 모두 통과시킨다.
- macOS runtime sample에서 renderer main thread에 동기 `get_viewport` AX stack이 없고 steady-state
  canvas read가 약 4 Hz인지 확인한다.

## Documentation

구현 시 `architecture`, `bridge`, `geometry`의 English source와 Korean translation을 함께 갱신하여
clock diagram, AX ownership 및 schedule-read 보장이 새 경로와 일치하도록 한다.

