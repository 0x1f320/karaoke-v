# Synthesizer V Studio 2 (한국어)

> 원문: **[synthv.md](synthv.md)**. 영어판이 원본이다.

host application. voxpane은 이것의 piano roll 위에 그리고 script를 통해 데이터를 읽는다.
프로젝트를 편집하지는 않는다.

아래는 전부 코드가 전제하면서 다시 말하지 않는 것들이다. 문서가 아니라 측정에서 나온 주장은
그렇다고 표시해 두었다 — 뭔가 아귀가 안 맞기 시작하면 다시 확인해야 할 것이 그것들이다.

## What we read out of it

SynthV의 객체 모델 중 voxpane이 닿는 부분까지:

```
Project
  └─ TimeAxis              blick ⇄ second (tempo가 여기 산다)
  └─ Track
       └─ NoteGroupReference     track 안에서의 time offset을 가짐
            └─ NoteGroup         note들 자체
                 └─ Note         onset, end, pitch, lyrics
```

bridge는 **group 하나만 따라간다: main editor의 current group**
(`SV.getMainEditor().getCurrentGroup()`). track이 아니고 project도 아니다. editor에서 group을
바꾸면 앱이 보고 있던 모든 것이 바뀐다 — group 전환이 아직 날아다니는 effect를 지워야 하는
이유다(#90).

note의 onset과 end는 group 기준이고, reference의 `getTimeOffset()`이 그것을 track 절대값으로
만든다. `bridge/model.ts`가 수집 시점에 한 번 더하므로, 그 아래는 전부 track 좌표다.

## Units

넷이고, 서로 바꿔 쓸 수 없다.

**Blick** — SynthV의 정수 시간 단위. 4분음표 하나가 `SV.QUARTER` blick이다. blick은
*픽셀에 선형*이다: piano roll의 x축은 tempo가 무엇을 하든 `blick × perBlick`이다. note
위치를 second가 아니라 blick으로 계산하는 이유다.

**Second** — `TimeAxis.getSecondsFromBlick(blick)`. tempo에 의존하므로 픽셀에 선형이 *아니다*.
playhead가 보고되는 단위이자 effect가 발사되는 기준이다.

wire 위의 모든 note가 **둘 다** 나른다(`onB`/`offB`와 `onS`/`offS`). 서로 다른 질문에
답하기 때문이다: second는 *언제*를, blick은 *어디*를 말한다. 앱에서 변환하려면 tempo map을
실어 보내야 하는데, 그건 편집으로 바뀐다.

**Semitone** — `note.getPitch()`는 MIDI note number다. 세로축은 `semitone × perSemitone`이고,
note의 lane은 정확히 1 semitone 높이다. renderer에서 하중을 받는 사실이다: semitone 단위의
pitch offset이 rect 높이로 스케일되므로 별도의 매핑이 필요 없다.

**Cent** — pitch curve는 note 자신의 pitch로부터의 cent 값으로, `int16`으로 이동한다:

```math
\text{cents} = \left\lfloor (\text{sample} - \text{pitch}) \cdot 100 + 0.5 \right\rfloor
```

절대 pitch가 아니라 cent인 덕분에 값이 작게 유지되고, 어느 note에 속하는지 몰라도 그 note의
curve가 의미를 갖는다. 100 cent가 1 semitone이고, 그게 1 lane이고, 그게 rect 하나의 높이다 —
cent 단위 offset이 자기 매핑 없이 화면까지 도달하게 만드는 사슬이다.

## The Lua scripting host

script는 설치당 디렉터리 하나에 평범한 `.lua` 파일로 산다:

| OS | 디렉터리 |
| --- | --- |
| macOS | `~/Library/Application Support/Dreamtonics/Synthesizer V Studio 2/scripts` |
| Windows | `%USERPROFILE%\Documents\Dreamtonics\Synthesizer V Studio 2\scripts`, 또는 `%APPDATA%\Dreamtonics\Synthesizer V Studio 2\scripts` |

`shared/synthvScript.ts`가 그 목록이며 선호 순서대로다. `SYNTHV_SCRIPTS_DIR`가 그것을
override하고, 앱과 저장소의 deploy script 양쪽에 적용된다.

**SynthV는 시작할 때 그 디렉터리를 읽는다.** 그 뒤에 떨어진 파일은 재시작하거나
**Scripts ▸ Rescan** 하기 전까지 보이지 않는다. 문서화된 것이 없어 측정한 결과: rescan은
모든 script 파일을 다시 실행하고 *또한* 이전 사본이 예약한 timer를 취소한다 — 그래서 옛
bridge가 새 것과 나란히 도는 대신 발행을 멈춘다. macOS는 메뉴를 화면에 열지도 포커스를
가져가지도 않고 Accessibility API로 그 항목을 누를 수 있다
(`packages/macos-helper/src/scripts.rs`). Windows에는 아직 대응물이 없다(#78).

### Writing for it

script는 TypeScript로 쓰고 `typescript-to-lua`로 컴파일한다. 그건 편의이지 추상화가 아니다 —
출력은 Lua 5.4이고 그렇게 동작한다:

- `&`, `^`, `>>>`는 Lua의 **64비트 정수** 연산자다. JavaScript의 32비트가 아니다.
- `/`는 **항상** float를 만든다. index나 blick 수를 원하는 API에 넘기면
  *"number has no integer representation"*으로 실패한다. `math.floor`를 쓸 것.
- API는 **1부터 센다**. 0이면 에러다. 모든 index는 `svIndex()`를 거치고, 그 branded 반환
  타입 덕분에 날것의 loop 카운터는 API 메서드에 닿을 수 없다.
- `string.find`는 값을 둘 반환한다. 호출 자체를 `undefined`와 비교하면 절대 nil이 아닌 테이블
  비교로 컴파일된다 — `bridge/paths.ts`의 플랫폼 판별을 볼 것. 거기서 물렸다.

### What the host does not give you

이 부재들이 bridge 설계 전체를 결정했다:

- **`mkdir`이 없다.** 대안은 `os.execute`, 즉 폴더 하나 만들자고 DAW 안에서 shell을 띄우는
  것이다. 그래서 **bridge 디렉터리는 앱이 만들고**, script는 그것이 생기기 전까지 그냥 열기에
  실패한다.
- **socket도 thread도 없다.**
- **`SV.setTimeout` 외에 scheduler가 없다.** bridge는 `finally`에서 자기를 다시 예약하는
  `setTimeout` loop다 — 그렇게 하지 않으면 tick 어딘가의 throw 하나가 세션 내내 loop를
  끝내버리고, 그동안 side panel은 마지막 상태를 계속 보여준다.
- **SynthV 바깥의 누구도 볼 수 있는 로그가 없다.** side panel이 유일한 출력 표면이고, panel이
  `Last error`를 보고하는 이유이자 smoke script가 자기 진단 channel을 발행하는 이유다.

### The side panel

bridge는 `SidePanelSection`이다. `getClientInfo()`가 선언하고
`getSidePanelSectionState()`가 그린다. script version, channel 디렉터리, sequence 번호,
transport 상태, note 수, 마지막 에러를 보여준다 — 디버깅할 때 가장 먼저 볼 곳이다.

`SV.refreshSidePanel()`은 **widget을 다시 만든다.** 그래서 refresh가 일어나는 동안 눌린 버튼은
callback에 도달하지 못한다. panel을 상태 변화에만 refresh하고 절대 timer로는 하지 않는 이유다.

## The computed pitch curve

`SV.getComputedPitchForGroup(ref, startBlick, intervalBlicks, frames)`는 engine이 렌더한
pitch를 group 전체에 대해 buffer 하나로, MIDI note number 단위로 반환한다. voxpane은 note마다가
아니라 schedule당 한 번 샘플링한다 — note별로 물으면 같은 데이터에 수백 번 호출이 든다.

이것에 대해 네 가지가 문서가 아니라 측정에서 나왔고, 각각이 눈에 보이는 버그를 만들었다:

1. **자주 없다.** 결과가 비어 있다는 것은 engine이 그 group의 pitch 계산을 아직 끝내지
   않았다는 뜻이고, 실제 프로젝트는 그 상태에 오래 머문다. 앱은 아무것도 안 보여주는 대신
   **합성된 contour**(`playback/pitch.ts`)로 폴백한다 — 그리고 호출자는 어느 쪽을 받았는지
   알 수 없고, 알 필요도 없어야 한다.
2. **무성 frame이 `null`이 아니라 `0`으로 온다.** 문서는 null이라고 한다. 액면대로 받으면
   0은 MIDI 0이고, 그건 약 −69 semitone offset이라 effect를 화면 밖으로 날려버린다.
   `VOICED_FLOOR`가 있는 이유다.
3. **curve는 note의 양쪽 끝을 넘어 이어진다** — engine은 note가 시작하기 *전에* 미끄러져
   들어가고 끝난 *뒤에* 놓아주며, 그 두 구간이 선 전체에서 가장 가파르다. note 자신의 구간만
   샘플링하면 그게 잘려나간다. 그래서 모든 note가 양쪽에 `BEND_PAD`(8) 샘플을 싣고,
   앱은 그 상수를 mirror한다.
4. **padding에는 "여기엔 없음" 값이 따로 필요하다.** note *내부*의 무성 샘플은 이전 offset을
   유지한다 — 자음이 effect를 뒤로 홱 당기지 않도록. 그런데 목소리가 시작되기 전의 padding에는
   유지할 이전 offset이 없고, 0을 유지하면 "note 자기 pitch 위"로 읽혀서 note 앞의 빈 공간에서
   effect가 터진다. `NO_CURVE`(`int16` 최솟값)가 그것을 표시한다.

## The view transform

`SV.getMainEditor().getNavigation()`이 주는 것:

| 호출 | 의미 |
| --- | --- |
| `getTimePxPerUnit()` | blick당 픽셀 — 가로 zoom |
| `getValuePxPerUnit()` | semitone당 픽셀 — lane 높이 |
| `getTimeViewRange()` | 보이는 `[leftBlick, rightBlick]` |
| `getValueViewRange()` | 보이는 `[bottomValue, topValue]` |

전부 **canvas-local**이다. canvas가 화면 어디 있는지는 아무것도 말하지 않고, 그 공백이 바로
native helper가 메우는 것이다.

각 range의 가까운 쪽만이 아니라 **양쪽 끝**을 다 publish하는데, Windows가 그 range들이 함의하는
픽셀 크기로 piano roll element를 식별하기 때문이다 —
[geometry](geometry.ko.md#two-platforms-two-strategies) 참조.

부호 규약에 주의: `getValueViewRange()`는 bottom을 먼저 반환하고, state record는
`viewTop` = `range[1]`, `viewBottom` = `range[0]`으로 저장한다.

측정된 것 하나 더: **`v2y`는 lane을 값 위에서 시작시키는 게 아니라 값에 중심을 맞춘다.**
그래서 note의 위쪽 모서리는 자기 pitch보다 반 semitone 위다. `pianoRollGeometry.ts`가 양쪽
플랫폼에서 그 절반을 명시적으로 뺀다.

## Transport and looping

`SV.getPlayback()`이 `getStatus()`(`stopped` / `playing` / `looping`)와 초 단위
`getPlayhead()`를 준다.

**loop 경계는 노출되지 않는다.** script가 *추론*한다: status가 `looping`인 동안 playhead가
뒤로 뛰면 그것이 wrap이고, 그 도약의 양 끝이 경계가 된다. 그래서 첫 wrap이 일어나기 전까지는
알 수 없고, **매끄럽게 만드는 힌트일 뿐이다** — 앱은 프레임마다 playhead를 읽으므로 다음 state
record에서 어차피 다시 anchor를 잡는다.

## Versions

bridge는 `minEditorVersion: 131330`을 선언한다. `SV.getHostInfo()`가 돌고 있는 editor의 버전과
OS 종류를 보고하고, script는 시작 시 둘 다 `session.json`에 쓴다 — 사용자가 실제로 무엇을 돌리고
있는지 확인하는 가장 빠른 길이다.
