# Synthesizer V

> 원문: [synthv.md](synthv.md). English가 source of truth다.

bridge는 Synthesizer V Studio 2 안의 Lua side-panel script다. 하나의 선택된 group을 따라 host API에서
playback, note, pitch, view mapping을 읽고 [bridge.md](bridge.md)의 app-owned pipe transport로 publish한다.

## One group

script는 group 하나만 publish한다. note는 SynthV의 `blick`, time은 second, pitch는 semitone과 cent를
쓴다. 앱은 이 데이터와 native canvas anchor로 screen rect을 재구성한다. Lua는 자기 window position을
알지 못한다.

## Host constraints

SynthV Lua에는 `io`, `os`가 있지만 socket, native module loading, `popen`, portable directory creation은
없다. scheduler도 `SV.setTimeout`뿐이다. Named pipe는 `io.open`으로만 동작하며 script는 channel pipe를
읽지 않는다. 128-byte regular `pipe-session` record를 읽고 `io.open(path, "wb")`로 세 write-only endpoint를
연다.

각 endpoint handle은 `setvbuf("no")`로 unbuffered가 되고 `write`, `close`에만 쓴다. Pipe write는
synchronous다. app reader가 block되면 SynthV UI thread에 backpressure가 걸리며 큰 `notes` snapshot이 가장
위험한 write다. side panel의 **Resend schedule** button은 이 작업의 intentional manual gate다.

## Pipe client

Lua는 `pipe-session`을 240 ms interval로 retry한다. fresh, checksum-valid VPR1 record만 받고 app session의
endpoint name을 유도한 다음 세 endpoint를 모두 연다. `EPIPE`, write/open failure, advertised session 변경이면
모든 endpoint를 닫는다. `wb` mode는 기대한 endpoint가 없을 때 ordinary file을 만들 수 있다. 앱은 advertise
전에 reader를 만들고 teardown 전에 rendezvous를 withdraw해서 normal case를 막는다. stale regular file,
symlink는 의도적으로 지우지 않으며 validation과 open 사이의 force-kill race도 protocol로 제거할 수 없다.

## Publication

script는 4 ms tick으로 돈다. 새 app connection에서 새로운 `scriptSession`을 만들고 `seq`, `scrollSeq`,
`notesSeq`를 reset한 뒤 session frame을 보낸다. 그다음 automatic exact recovery snapshot, 즉 full notes,
current scroll, current state를 publish한다. 이는 app이 예전 데이터를 보관했다고 가정하는 optimization이
아니라 reconnect마다 수행된다.

그 뒤 `state`는 playhead, transport status, `rev`, `scrollSeq`, `notesSeq`를 매 tick publish한다. `scroll`은
여섯 view value가 바뀔 때만 publish한다. `notes`는 initial recovery, user request, 필요할 때 playback start,
detected edit에 publish한다. 앱은 세 stream을 어떤 순서로든 받을 수 있으므로 sequence와 revision relation이
일치한 뒤에만 composed snapshot을 accept한다.

session frame은 protocol/layout, `appSession`, `scriptSession`, script version, host information을 담는다.
`appSession`은 app rendezvous에서 오고, `scriptSession`은 Lua publisher가 reconnect할 때 바뀐다. 그 뒤
state, scroll, notes가 regular data-file rescan 없이 완전한 current app view를 recover한다.

## Notes and pitch

`getComputedPitchForGroup`은 group의 rendered pitch buffer를 MIDI note number로 돌려준다. 없을 수 있고
unvoiced frame은 문서의 `null` 대신 관측상 `0`이다. publisher는 unavailable padded sample에 `NO_CURVE`를
쓰고 renderer는 synthesized fallback contour를 쓸 수 있다. 이는 protocol fault가 아니라 측정된 host behavior다.

## View transform

`getTimePxPerUnit`, `getValuePxPerUnit`, `getTimeViewRange`, `getValueViewRange`가 `scroll` payload를 이룬다.
transform은 canvas-local이다. canvas의 screen position을 말하지 않으므로 앱이 macOS Accessibility 또는
Windows UI Automation과 결합한다. `viewTop`은 value range의 두 번째 edge이고 `viewBottom`은 첫 번째 edge다.

## Transport and looping

`SV.getPlayback()`은 `stopped`, `playing`, `looping`과 second 단위 playhead를 준다. loop bounds는 looping
중 backward playhead jump로 infer한다. 이는 smoothing hint일 뿐이고 앱은 received state로 re-anchor한다.

## Versions

script는 `minEditorVersion: 131330`을 선언한다. side panel은 script version, connection state, app/script
session, sequence counter, note count, last failure를 보인다. 앱이 Lua log를 볼 수 없을 때 host에서 보는
authoritative view다.
