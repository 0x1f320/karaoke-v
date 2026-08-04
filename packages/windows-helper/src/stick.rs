// Follows the SynthV window so the overlay can sit on top of it.
//
// The WinEvent hook is installed with WINEVENT_OUTOFCONTEXT, which means Windows
// delivers the callbacks through the installing thread's message queue. That
// thread must therefore be Electron's main thread — it is the only one pumping
// messages — so start() has to be called from the main process, never a worker.
//
// Frames are reported in physical pixels because that is what Win32 deals in.
// Converting to the DIPs that setBounds wants needs the window's display scale,
// which Electron knows and this addon does not; the JS layer does that step.

use std::cell::RefCell;

use napi::bindgen_prelude::{Buffer, Result, Status};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};
use windows::Win32::System::SystemInformation::GetTickCount64;
use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetForegroundWindow, IsIconic, IsWindow, IsWindowVisible, KillTimer, SetTimer,
    SetWindowLongPtrW, SetWindowPos, EVENT_OBJECT_CREATE, EVENT_OBJECT_DESTROY, EVENT_OBJECT_HIDE,
    EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_SHOW, EVENT_SYSTEM_MOVESIZEEND,
    EVENT_SYSTEM_MOVESIZESTART, GWLP_HWNDPARENT, OBJID_WINDOW, SWP_NOACTIVATE, SWP_NOREDRAW,
    SWP_NOZORDER, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
};

use crate::types::{JsRect, JsStatus, JsTargetFrame};
use crate::win::{self, DEFAULT_TARGET};

type FrameFn = ThreadsafeFunction<JsRect, (), JsRect, Status, false>;
type StatusFn = ThreadsafeFunction<JsStatus, (), JsStatus, Status, false>;

/// Prediction is abandoned past this much disagreement — an edge snap, say.
const RESYNC_PX: f64 = 8.0;

/// How often the drag prediction repositions the overlay, in ms.
const DRAG_TICK_MS: u32 = 8;

/// How often to look for a target that is not running yet, in ms.
const RETRY_TICK_MS: u32 = 1000;

#[derive(Clone, Copy, Default, PartialEq)]
struct Frame {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

impl From<RECT> for Frame {
    fn from(rect: RECT) -> Self {
        Frame {
            x: rect.left as f64,
            y: rect.top as f64,
            w: (rect.right - rect.left) as f64,
            h: (rect.bottom - rect.top) as f64,
        }
    }
}

impl From<Frame> for JsRect {
    fn from(frame: Frame) -> Self {
        JsRect {
            x: frame.x,
            y: frame.y,
            w: frame.w,
            h: frame.h,
        }
    }
}

#[derive(Default)]
struct Stick {
    frame_fn: Option<FrameFn>,
    status_fn: Option<StatusFn>,
    hook: Option<HWINEVENTHOOK>,
    move_hook: Option<HWINEVENTHOOK>,
    target: Option<HWND>,
    follower: Option<HWND>,
    needle: String,
    retry_timer: usize,
    drag_timer: usize,
    // Dragging is the one case where the target's next position is knowable in
    // advance: while the user holds the title bar the window tracks the cursor
    // rigidly, so its origin is the origin it had when the drag began plus however
    // far the cursor has moved. Predicting from that is what lets the overlay move
    // with SynthV instead of one composition frame behind it — the move
    // notification only ever arrives after SynthV has already painted itself
    // somewhere new.
    dragging: bool,
    drag_origin: Frame,
    drag_cursor: POINT,
}

thread_local! {
    static STICK: RefCell<Stick> = RefCell::new(Stick::default());
}

fn cursor_pos() -> Option<POINT> {
    let mut point = POINT::default();
    unsafe { GetCursorPos(&mut point) }.ok().map(|()| point)
}

fn frame_of(hwnd: HWND) -> Option<Frame> {
    let frame = Frame::from(win::frame_of(hwnd)?);
    (frame.w > 0.0 && frame.h > 0.0).then_some(frame)
}

// Making the overlay an *owned* window is what glues it to SynthV's z-order:
// Windows keeps it directly above its owner, minimises and restores it alongside,
// and — unlike a global topmost window — lets anything stacked above SynthV cover
// it too. Ownership across processes is not something Microsoft documents, so
// this stays best-effort.
//
// Making the overlay a real WS_CHILD of SynthV was tried twice and is a dead end,
// not a tuning problem: a parent with WS_CLIPCHILDREN — which JUCE sets — excludes
// the area its children cover from its own painting. An overlay that covers the
// whole client area therefore stops SynthV repainting itself entirely. Clearing
// that style on someone else's window only trades the freeze for the parent
// painting over us. Ownership plus a chase is the most Windows allows here.
fn set_owner(follower: Option<HWND>, owner: Option<HWND>) {
    let Some(follower) = follower else { return };
    if !unsafe { IsWindow(Some(follower)) }.as_bool() {
        return;
    }
    let owner = owner.map(|o| o.0 as isize).unwrap_or(0);
    unsafe { SetWindowLongPtrW(follower, GWLP_HWNDPARENT, owner) };
}

impl Stick {
    fn emit_frame(&self, frame: Frame) {
        if let Some(frame_fn) = &self.frame_fn {
            frame_fn.call(frame.into(), ThreadsafeFunctionCallMode::NonBlocking);
        }
    }

    fn emit_status(&self, state: &str) {
        if let Some(status_fn) = &self.status_fn {
            status_fn.call(
                JsStatus {
                    state: state.to_owned(),
                },
                ThreadsafeFunctionCallMode::NonBlocking,
            );
        }
    }

    // Repositioning here rather than back in JavaScript is the other half: the hook
    // runs on the same thread the window lives on, so the move lands in the same
    // message batch as SynthV's own, instead of a frame later via IPC and setBounds.
    fn place_follower(&self, frame: Frame) {
        let Some(follower) = self.follower else {
            return;
        };
        if !unsafe { IsWindow(Some(follower)) }.as_bool() {
            return;
        }
        let _ = unsafe {
            SetWindowPos(
                follower,
                None,
                frame.x as i32,
                frame.y as i32,
                frame.w as i32,
                frame.h as i32,
                SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOREDRAW,
            )
        };
    }

    fn stop_drag(&mut self) {
        if self.drag_timer != 0 {
            let _ = unsafe { KillTimer(None, self.drag_timer) };
            self.drag_timer = 0;
        }
        self.dragging = false;
    }

    /// The target is normally found after follow() has already handed us the
    /// window, so attaching has to happen wherever the target first appears, not
    /// only there.
    fn attach_follower(&self) {
        if self.follower.is_some() && self.target.is_some() {
            set_owner(self.follower, self.target);
        }
    }

    fn report_current(&mut self) {
        let Some(target) = self.target else {
            self.emit_status("waiting");
            return;
        };
        if !unsafe { IsWindow(Some(target)) }.as_bool() {
            self.target = None;
            self.emit_status("waiting");
            return;
        }
        if !unsafe { IsWindowVisible(target) }.as_bool() || unsafe { IsIconic(target) }.as_bool() {
            self.emit_status("hidden");
            return;
        }
        let Some(frame) = frame_of(target) else {
            return;
        };

        if self.dragging {
            // A resize is not predictable from the cursor, and neither is a window
            // the system snapped to an edge; in both cases the reported frame is the
            // truth and prediction either re-baselines against it or gives up.
            if frame.w != self.drag_origin.w || frame.h != self.drag_origin.h {
                self.stop_drag();
            } else if let Some(cursor) = cursor_pos() {
                let drift_x =
                    frame.x - (self.drag_origin.x + (cursor.x - self.drag_cursor.x) as f64);
                let drift_y =
                    frame.y - (self.drag_origin.y + (cursor.y - self.drag_cursor.y) as f64);
                if drift_x * drift_x + drift_y * drift_y > RESYNC_PX * RESYNC_PX {
                    self.drag_origin = frame;
                    self.drag_cursor = cursor;
                }
            }
        }

        self.place_follower(frame);
        self.emit_status("attached");
        self.emit_frame(frame);
    }
}

unsafe extern "system" fn on_drag_timer(_hwnd: HWND, _msg: u32, _id: usize, _time: u32) {
    STICK.with_borrow(|stick| {
        if !stick.dragging || stick.target.is_none() {
            return;
        }
        let Some(cursor) = cursor_pos() else { return };
        let mut predicted = stick.drag_origin;
        predicted.x += (cursor.x - stick.drag_cursor.x) as f64;
        predicted.y += (cursor.y - stick.drag_cursor.y) as f64;
        stick.place_follower(predicted);
    });
}

// The hook only reports windows that already exist, so a target that is not
// running yet would never be picked up; this ticks until one appears.
unsafe extern "system" fn on_retry_timer(_hwnd: HWND, _msg: u32, _id: usize, _time: u32) {
    STICK.with_borrow_mut(|stick| {
        if stick
            .target
            .is_some_and(|target| unsafe { IsWindow(Some(target)) }.as_bool())
        {
            return;
        }
        stick.target = win::find_window_for_process(&stick.needle);
        if stick.target.is_some() {
            stick.attach_follower();
            stick.report_current();
        }
    });
}

unsafe extern "system" fn on_move_size_event(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    id_object: i32,
    _id_child: i32,
    _thread: u32,
    _time: u32,
) {
    STICK.with_borrow_mut(|stick| {
        if id_object != OBJID_WINDOW.0 || Some(hwnd) != stick.target {
            return;
        }
        if event == EVENT_SYSTEM_MOVESIZESTART {
            if let (Some(origin), Some(cursor)) = (frame_of(hwnd), cursor_pos()) {
                stick.drag_origin = origin;
                stick.drag_cursor = cursor;
                stick.dragging = true;
                if stick.drag_timer == 0 {
                    stick.drag_timer =
                        unsafe { SetTimer(None, 0, DRAG_TICK_MS, Some(on_drag_timer)) };
                }
            }
            return;
        }
        stick.stop_drag();
        stick.report_current();
    });
}

unsafe extern "system" fn on_win_event(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    id_object: i32,
    _id_child: i32,
    _thread: u32,
    _time: u32,
) {
    STICK.with_borrow_mut(|stick| {
        if id_object != OBJID_WINDOW.0 {
            return;
        }
        if stick.target.is_none() {
            if event == EVENT_OBJECT_SHOW || event == EVENT_OBJECT_CREATE {
                stick.target = win::find_window_for_process(&stick.needle);
                stick.report_current();
            }
            return;
        }
        if Some(hwnd) != stick.target {
            return;
        }
        match event {
            EVENT_OBJECT_DESTROY => {
                stick.stop_drag();
                set_owner(stick.follower, None);
                stick.target = None;
                stick.emit_status("waiting");
            }
            EVENT_OBJECT_HIDE => stick.emit_status("hidden"),
            EVENT_OBJECT_SHOW | EVENT_OBJECT_LOCATIONCHANGE => stick.report_current(),
            _ => {}
        }
    });
}

#[napi]
pub fn start(target: String, on_frame: FrameFn, on_status: StatusFn) -> Result<()> {
    STICK.with_borrow_mut(|stick| {
        stick.needle = target.to_lowercase();
        stick.frame_fn = Some(on_frame);
        stick.status_fn = Some(on_status);

        let hook = unsafe {
            SetWinEventHook(
                EVENT_OBJECT_CREATE,
                EVENT_OBJECT_LOCATIONCHANGE,
                None,
                Some(on_win_event),
                0,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            )
        };
        if hook.is_invalid() {
            stick.emit_status("unsupported");
            return;
        }
        stick.hook = Some(hook);

        let move_hook = unsafe {
            SetWinEventHook(
                EVENT_SYSTEM_MOVESIZESTART,
                EVENT_SYSTEM_MOVESIZEEND,
                None,
                Some(on_move_size_event),
                0,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            )
        };
        if !move_hook.is_invalid() {
            stick.move_hook = Some(move_hook);
        }

        stick.retry_timer = unsafe { SetTimer(None, 0, RETRY_TICK_MS, Some(on_retry_timer)) };
        stick.target = win::find_window_for_process(&stick.needle);
        stick.attach_follower();
        stick.report_current();
    });
    Ok(())
}

#[napi]
pub fn stop() {
    STICK.with_borrow_mut(|stick| {
        if stick.retry_timer != 0 {
            let _ = unsafe { KillTimer(None, stick.retry_timer) };
            stick.retry_timer = 0;
        }
        stick.stop_drag();
        if let Some(hook) = stick.move_hook.take() {
            let _ = unsafe { UnhookWinEvent(hook) };
        }
        if let Some(hook) = stick.hook.take() {
            let _ = unsafe { UnhookWinEvent(hook) };
        }
        set_owner(stick.follower, None);
        stick.follower = None;
        stick.target = None;
        stick.frame_fn = None;
        stick.status_fn = None;
    });
}

fn hwnd_from_buffer(handle: &Buffer) -> Option<HWND> {
    let bytes: &[u8] = handle.as_ref();
    if bytes.len() < std::mem::size_of::<HWND>() {
        return None;
    }
    Some(unsafe { *(bytes.as_ptr() as *const HWND) })
}

#[napi]
pub fn follow(handle: Buffer) -> Result<()> {
    let Some(follower) = hwnd_from_buffer(&handle) else {
        return Err(napi::Error::from_reason(
            "follow(handle) requires the Buffer from getNativeWindowHandle()",
        ));
    };
    STICK.with_borrow_mut(|stick| {
        stick.follower = Some(follower);
        if let Some(target) = stick.target {
            set_owner(stick.follower, stick.target);
            if let Some(frame) = frame_of(target) {
                stick.place_follower(frame);
            }
        }
    });
    Ok(())
}

#[napi]
pub fn unfollow() {
    STICK.with_borrow_mut(|stick| {
        set_owner(stick.follower, None);
        stick.follower = None;
    });
}

/// One-shot read of the target window's frame, physical pixels.
#[napi]
pub fn get_target_frame(target: Option<String>) -> Option<JsTargetFrame> {
    STICK.with_borrow(|stick| {
        let needle = match target {
            Some(target) => target.to_lowercase(),
            None if !stick.needle.is_empty() => stick.needle.clone(),
            None => DEFAULT_TARGET.to_owned(),
        };
        let hwnd = match stick.target {
            Some(target) if unsafe { IsWindow(Some(target)) }.as_bool() => target,
            _ => win::find_window_for_process(&needle)?,
        };
        let frame = frame_of(hwnd)?;
        Some(JsTargetFrame {
            x: frame.x,
            y: frame.y,
            w: frame.w,
            h: frame.h,
            visible: unsafe { IsWindowVisible(hwnd) }.as_bool()
                && !unsafe { IsIconic(hwnd) }.as_bool(),
            foreground: unsafe { GetForegroundWindow() } == hwnd,
        })
    })
}

/// Kept so the two helpers present the same surface; Windows has no equivalent of
/// AppKit's implicit window animations to switch off.
#[napi]
pub fn disable_animations(_view: Option<Buffer>) {}

#[napi]
pub fn monotonic_now() -> f64 {
    let mut frequency = 0i64;
    let mut counter = 0i64;
    unsafe {
        let _ = QueryPerformanceFrequency(&mut frequency);
        let _ = QueryPerformanceCounter(&mut counter);
    }
    if frequency > 0 {
        counter as f64 * 1000.0 / frequency as f64
    } else {
        (unsafe { GetTickCount64() }) as f64
    }
}
