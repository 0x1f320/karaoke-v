# Debugging

> 원문: [debugging.md](debugging.md). English가 source of truth다.

overlay가 실패하면 app/window tracking, Lua publication, pipe reception, snapshot composition, native
geometry, rendering 중 어느 owner가 응답을 멈췄는지 확인한다. channel endpoint를 열어 검사하지 말 것.
FIFO나 Named Pipe를 열면 transport 자체가 바뀐다.

## Running it

```sh
pnpm install
pnpm dev
```

main process는 terminal에, overlay DevTools는 renderer output에 쓴다. Lua에는 외부에서 읽을 수 있는 log가
없으므로 side panel과 non-consuming inspector가 운영상 source of truth다.

## App and overlay

tray status는 app이 attached, waiting, hidden인지 또는 Accessibility permission에 막혔는지 보인다. SynthV가
attach되기 전에는 bridge 어떤 것도 도움이 되지 않는다. 이후 overlay debug mode로 bad geometry와 bad
effect를 분리한다. debug note rect가 틀리면 schedule/scroll/native anchor path부터 고친다.

## Script side panel

SynthV의 **Overlay Bridge** side panel을 연다. loaded version, bridge on/off, connection과 app session,
현재 sequence counter, transport state, note count, inferred loop bound, last error를 보여준다.
`rendezvous unavailable`은 앱이 endpoint를 advertise하지 않았다는 뜻이다. endpoint open/write failure 또는
`EPIPE`는 Lua가 endpoint set을 닫고 다른 app session 또는 newer heartbeat를 기다린다는 뜻이다. 첫
connection도 같은 session의 heartbeat 전진을 기다리므로 이후 240 ms validation이 다음 heartbeat second를
볼 때까지 `disconnected`가 보일 수 있다. app이 connected인데 sequence가 늘지 않으면 Lua tick이 멈췄거나
표시된 last error를 확인한다.

**Resend schedule**은 full schedule을 의도적으로 요청한다. clean client reconnect에서도 script가 exact
notes/scroll/state snapshot을 자동으로 보낸다.

## Pipe-session inspector

```sh
pnpm --filter @voxpane/synthv-script run dump
pnpm --filter @voxpane/synthv-script run dump -- /path/to/bridge
```

`dump`는 먼저 `pipe-session`을 `lstat`한다. `ENOENT`는 unavailable이고 symlink 또는 non-regular node는
malformed이며 읽지 않는다. 그다음 정확한 128-byte VPR1 record와 checksum을 decode하고 app session,
heartbeat age, freshness, 세 derived endpoint name을 출력한다. 앱은 regular record를 truncate 없이 열고
opened handle과 path가 같은 regular file을 가리키는지
검증한 뒤 positioned 128-byte write를 수행하고 나서 truncate한다. absent record는 exclusively create하며
recovery는 file을 unlink한 뒤 recreate할 수 있다. 따라서 regular-or-absent gate는 recovery `ENOENT`를
unavailable로, short 또는 invalid record를 malformed로 처리한다. macOS에서 `dump`는 endpoint에 `lstat`만
써서 `fifo`, `missing`, `non-fifo`, `symlink`로 보고하며 열지 않는다. Windows에서는 derived Named Pipe
name을 출력하고 connect probe를 하지 않는다.

| Output | Meaning | Exit |
| --- | --- | --- |
| `pipe-session: unavailable` | app stopped, not yet started, 또는 rendezvous withdrawn | 0 |
| `pipe-session: fresh` | current app session이 advertise됨 | 0 |
| `pipe-session: stale` | app stop/crash 뒤 checksum-valid session이 남음 | 0 |
| `pipe-session: malformed (...)` | symlink/non-regular node, bad shape/checksum, future heartbeat, 또는 decode할 수 없는 existing record | nonzero |

`dump`를 live playhead, note, bend, scroll, per-channel ordering에 쓰지 않는다. 이는 strictly
non-consuming pipe-session inspector다. endpoint observation은 ownership을 diagnose하지만 connected Lua
writer를 보증하지는 않는다.

## macOS guardian

```sh
pgrep -fl voxpane-bridge-guardian
```

현재 advertise된 macOS session에는 daemonized guardian 하나가 있다. safety read descriptor와 connected
worker control socket만 소유하며 worker가 살아 있는 동안 channel data를 consume하지 않는다. parent PID는
더는 Electron PID가 아니어야 하며, 그래야 `pnpm dev` shutdown의 signaled descendant tree에 포함되지 않는다.
normal stop 뒤에는 Lua가 old writer를 닫는 동안 잠깐 남을 수 있다. Electron `SIGKILL` 뒤에는 matching
`pipe-session`을 withdraw하고 해당
writer가 EOF에 도달할 때까지 남는다. 앱이 살아 있는 동안 guardian이 exit하면 endpoint failure로 보고되어
fresh receiver session을 만든다. app crash recovery를 test할 때 guardian을 따로 kill하지 말고, drain 여부를
inspect하려고 FIFO를 열지 않는다.

## Debug mode

Settings > General > **Enable debug mode**는 note rect, selected note, reach band, bridge diagnostics를
그린다. diagnostic panel은 connection state, current app session, receipt/applied clock, recovery,
malformed frame, endpoint failure, disconnect, invalid/sequence/revision mismatch observation을 보인다.

timing graph는 accepted state와 viewport application을 drawing과 비교한다. gap은 zero-duration read가 아니라
accepted sample 부재다. renderer latency report는 overlay DevTools에, development에서는 main terminal에도
나온다.

## Deployment and rescan

```sh
pnpm --filter @voxpane/synthv-script build
pnpm --filter @voxpane/synthv-script run deploy
```

deploy 뒤 SynthV에서 **Scripts > Rescan** 또는 restart한다. Rescan은 old script timer를 교체한다. filesystem
timestamp가 아니라 side panel version으로 loaded build를 확인한다. app installer는 `overlay-bridge.lua`를
deploy한다. local `deploy`는 smoke script도 복사하므로 real bridge를 시험할 때는 rescan 전에
`voxpane-lua-smoke.lua`를 지운다. 동시에 publish하면 같은 app-owned endpoint를 두 publisher가 다툰다.

## Windows

native Windows checkout 또는 Parallels VM에는 repository의 `run-on-windows` skill을 쓴다. Windows는 Node
Named Pipe server를 쓴다. 제거된 PowerShell helper를 되살리거나 two-second startup delay를 가정하지 않는다.
macOS에서는 다음으로 Windows helper code를 typecheck한다.

```sh
cd packages/windows-helper && cargo check --target x86_64-pc-windows-msvc
```

## Symptom to technique

| Symptom | First check |
| --- | --- |
| App stopped | `dump`의 `pipe-session: unavailable`은 정상 |
| crash 뒤 stale app state | `dump`의 `stale`; app restart 후 side panel 확인 |
| app crash 뒤 SynthV가 멈춤 | kill 전에 session guardian이 있었고 뒤에 `pipe-session`이 unavailable이 되는지 확인 |
| overlay가 전혀 안 그림 | tray attachment, side-panel connection/error, debug rect 순서로 확인 |
| pipe가 반복 recover | diagnostic recovery, malformed frame, endpoint failure, disconnect 확인 |
| new state가 무시됨 | diagnostic invalid, `scrollSeq`, `notesSeq`, `rev` mismatch observation 확인 |
| scroll 때 effect가 밀림 | debug rect와 [architecture.md](architecture.md#geometry-path)의 generation candidate matcher 확인 |
| script change가 안 보임 | rebuild, deploy, **Scripts > Rescan**, side-panel version 순서로 확인 |
| macOS endpoint가 FIFO가 아님 | `dump` endpoint type; 직접 열거나 remove하지 말 것 |
| Windows endpoint가 unavailable처럼 보임 | `dump` derived name; client connect 대신 app/side panel 확인 |

## Before changing anything

```sh
pnpm check
pnpm typecheck
pnpm test
```

pure test는 codec, framed parser, session gate, runtime composition, endpoint lifecycle을 다룬다. real piano-roll
alignment까지 증명하지는 않으므로 geometry는 running app과 debug mode로 검증한다.
