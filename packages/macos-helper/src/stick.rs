// Tracks a target app's main window in-process and emits its screen frame so the
// JS side can stick an Electron window to it.
//
// An AXObserver (or a CGWindowList poll when Accessibility isn't granted) drives
// smooth position updates; a CGWindowList pass gates visibility — the target is
// "visible" only when it's on-screen (not minimized / on another Space) and not
// significantly covered by a window in front. When it isn't visible we emit
// HIDE so the panel gets hidden instead of floating over nothing.
//
// Frames are top-left origin, global points — exactly what Electron's
// win.setBounds() expects. No child process, no pipe.

use std::cell::RefCell;
use std::ffi::c_void;
use std::ptr::NonNull;

use napi::bindgen_prelude::{Buffer, Result, Status};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use objc2_app_kit::{
    NSApplicationActivationPolicy, NSRunningApplication, NSView, NSWindowAnimationBehavior,
    NSWorkspace,
};
use objc2_application_services::{AXError, AXIsProcessTrusted, AXObserver, AXUIElement};
use objc2_core_foundation::{
    kCFRunLoopCommonModes, CFAbsoluteTimeGetCurrent, CFArray, CFDictionary, CFNumber, CFRetained,
    CFRunLoop, CFRunLoopTimer, CFString, CGRect,
};
use objc2_core_graphics::{
    kCGWindowBounds, kCGWindowLayer, kCGWindowOwnerPID, CGRectIntersection, CGRectIsNull,
    CGRectMakeWithDictionaryRepresentation, CGWindowListCopyWindowInfo, CGWindowListOption,
};

use crate::ax;
use crate::types::{JsRect, JsStatus};

type FrameFn = ThreadsafeFunction<JsRect, (), JsRect, Status, false>;
type StatusFn = ThreadsafeFunction<JsStatus, (), JsStatus, Status, false>;

/// Fraction of the target that must be covered by front windows to count as hidden.
const OCCLUSION_THRESHOLD: f64 = 0.15;

const WINDOW_NOTIFICATIONS: [&str; 5] = [
    ax::NOTIFY_MOVED,
    ax::NOTIFY_RESIZED,
    ax::NOTIFY_WINDOW_MINIATURIZED,
    ax::NOTIFY_WINDOW_DEMINIATURIZED,
    ax::NOTIFY_UI_ELEMENT_DESTROYED,
];

#[derive(Default)]
struct Stick {
    frame_fn: Option<FrameFn>,
    status_fn: Option<StatusFn>,
    observer: Option<CFRetained<AXObserver>>,
    app_el: Option<CFRetained<AXUIElement>>,
    win_el: Option<CFRetained<AXUIElement>>,
    timer: Option<CFRetained<CFRunLoopTimer>>,
    pid: i32,
    needle: String,
    trusted: bool,
    visible: bool,
    last_key: String,
    last_frame: Option<CGRect>,
}

thread_local! {
    static STICK: RefCell<Stick> = RefCell::new(Stick::default());
}

impl Stick {
    fn emit_frame(&mut self, rect: CGRect) {
        if self.last_frame == Some(rect) {
            return;
        }
        self.last_frame = Some(rect);
        if let Some(frame_fn) = &self.frame_fn {
            frame_fn.call(rect.into(), ThreadsafeFunctionCallMode::NonBlocking);
        }
    }

    fn emit_status(&mut self, state: &str, mode: Option<&str>) {
        let key = format!("{}/{}", state, mode.unwrap_or(""));
        if key == self.last_key {
            return;
        }
        self.last_key = key;
        if let Some(status_fn) = &self.status_fn {
            status_fn.call(
                JsStatus {
                    state: state.to_owned(),
                    mode: mode.map(str::to_owned),
                },
                ThreadsafeFunctionCallMode::NonBlocking,
            );
        }
    }

    /// Force the next visible frame to re-emit even if the coordinates are unchanged
    /// (e.g. after unhiding), so the renderer's window is repositioned + shown.
    fn mark_hidden(&mut self, state: &str) {
        self.visible = false;
        self.last_frame = None;
        self.emit_status(state, None);
    }

    fn copy_current_window(&self) -> Option<CFRetained<AXUIElement>> {
        ax::copy_main_window(self.app_el.as_deref()?)
    }

    /// Full visibility + position pass. Emits a frame (attached) when the target is
    /// visible, otherwise HIDE / WAIT.
    fn reevaluate(&mut self) {
        let app = if self.pid == 0 {
            None
        } else {
            NSRunningApplication::runningApplicationWithProcessIdentifier(self.pid)
        };
        let Some(app) = app else {
            self.mark_hidden("waiting");
            return;
        };
        if app.isTerminated() {
            self.mark_hidden("waiting");
            return;
        }
        if app.isHidden() {
            self.mark_hidden("hidden");
            return;
        }

        let Some(mut frame) = evaluate_visibility(self.pid) else {
            self.mark_hidden("hidden");
            return;
        };
        self.visible = true;

        // Prefer the AX frame for precision; fall back to the CGWindowList bounds.
        if self.trusted {
            if self.win_el.is_none() {
                self.win_el = self.copy_current_window();
            }
            if let Some(ax_frame) = self.win_el.as_deref().and_then(ax::ax_frame) {
                frame = ax_frame;
            }
        }
        self.emit_frame(frame);
        self.emit_status("attached", Some(if self.trusted { "ax" } else { "poll" }));
    }

    fn teardown_observer(&mut self) {
        if let Some(observer) = self.observer.take() {
            if let Some(run_loop) = CFRunLoop::main() {
                unsafe {
                    run_loop
                        .remove_source(Some(&observer.run_loop_source()), kCFRunLoopCommonModes);
                }
            }
        }
        self.win_el = None;
    }

    fn rebind_window(&mut self) {
        let Some(observer) = self.observer.clone() else {
            return;
        };
        if let Some(win_el) = self.win_el.take() {
            for notification in WINDOW_NOTIFICATIONS {
                let notification = CFString::from_static_str(notification);
                unsafe { observer.remove_notification(&win_el, &notification) };
            }
        }
        self.win_el = self.copy_current_window();
        if let Some(win_el) = &self.win_el {
            for notification in WINDOW_NOTIFICATIONS {
                let notification = CFString::from_static_str(notification);
                unsafe {
                    observer.add_notification(win_el, &notification, std::ptr::null_mut());
                }
            }
        }
    }

    fn bind_observer(&mut self) {
        self.teardown_observer();
        let Some(app_el) = self.app_el.clone() else {
            return;
        };
        let mut raw: *mut AXObserver = std::ptr::null_mut();
        let err = unsafe {
            AXObserver::create(self.pid, Some(observer_callback), NonNull::from(&mut raw))
        };
        let Some(raw) = NonNull::new(raw) else { return };
        if err != AXError::Success {
            return;
        }
        let observer = unsafe { CFRetained::from_raw(raw) };
        for notification in [
            ax::NOTIFY_FOCUSED_WINDOW_CHANGED,
            ax::NOTIFY_MAIN_WINDOW_CHANGED,
        ] {
            let notification = CFString::from_static_str(notification);
            unsafe {
                observer.add_notification(&app_el, &notification, std::ptr::null_mut());
            }
        }
        self.observer = Some(observer.clone());
        self.rebind_window();
        if let Some(run_loop) = CFRunLoop::main() {
            unsafe {
                run_loop.add_source(Some(&observer.run_loop_source()), kCFRunLoopCommonModes);
            }
        }
    }

    fn clear_target(&mut self) {
        self.teardown_observer();
        self.app_el = None;
        self.pid = 0;
        self.visible = false;
        self.last_frame = None;
    }

    fn resolve(&mut self) {
        let Some(app) = find_app(&self.needle) else {
            self.clear_target();
            self.emit_status("waiting", None);
            return;
        };
        let pid = app.processIdentifier();
        if pid != self.pid {
            self.clear_target();
            self.pid = pid;
            self.app_el = Some(unsafe { AXUIElement::new_application(pid) });
            if self.trusted {
                self.bind_observer();
            }
        }
        self.reevaluate();
    }

    fn stop(&mut self) {
        if let Some(timer) = self.timer.take() {
            timer.invalidate();
        }
        self.clear_target();
        self.last_key.clear();
        self.frame_fn = None;
        self.status_fn = None;
        self.needle.clear();
    }
}

fn find_app(needle: &str) -> Option<objc2::rc::Retained<NSRunningApplication>> {
    if needle.is_empty() {
        return None;
    }
    let workspace = NSWorkspace::sharedWorkspace();
    for app in workspace.runningApplications().iter() {
        if app.activationPolicy() != NSApplicationActivationPolicy::Regular {
            continue;
        }
        let name = app
            .localizedName()
            .map(|n| n.to_string())
            .unwrap_or_default();
        if name.to_lowercase().contains(needle) {
            return Some(app);
        }
    }
    None
}

fn dict_of(list: &CFArray, index: isize) -> Option<&CFDictionary> {
    let entry = unsafe { list.value_at_index(index) } as *const CFDictionary;
    unsafe { entry.as_ref() }
}

fn bounds_of(entry: &CFDictionary) -> CGRect {
    let bounds = unsafe { entry.value(kCGWindowBounds as *const CFString as *const c_void) };
    let mut rect = CGRect::ZERO;
    let ok = unsafe {
        CGRectMakeWithDictionaryRepresentation((bounds as *const CFDictionary).as_ref(), &mut rect)
    };
    if ok {
        rect
    } else {
        CGRect::ZERO
    }
}

fn int_of(entry: &CFDictionary, key: &CFString) -> Option<i32> {
    let value = unsafe { entry.value(key as *const CFString as *const c_void) };
    let number = unsafe { (value as *const CFNumber).as_ref() }?;
    number.as_i32()
}

fn layer_of(entry: &CFDictionary) -> i32 {
    int_of(entry, unsafe { kCGWindowLayer }).unwrap_or(-1)
}

fn pid_of(entry: &CFDictionary) -> i32 {
    int_of(entry, unsafe { kCGWindowOwnerPID }).unwrap_or(0)
}

/// Is the target on-screen and not significantly covered? Returns its CGWindowList
/// frame. On-screen windows are ordered front-to-back.
fn evaluate_visibility(target_pid: i32) -> Option<CGRect> {
    let my_pid = std::process::id() as i32;
    let options =
        CGWindowListOption::OptionOnScreenOnly | CGWindowListOption::ExcludeDesktopElements;
    let list = CGWindowListCopyWindowInfo(options, 0)?;
    let count = list.count();

    let mut target_index: Option<isize> = None;
    let mut target_bounds = CGRect::ZERO;
    let mut best_area = 0.0;
    for i in 0..count {
        let Some(entry) = dict_of(&list, i) else {
            continue;
        };
        if pid_of(entry) != target_pid || layer_of(entry) != 0 {
            continue;
        }
        let rect = bounds_of(entry);
        let area = rect.size.width * rect.size.height;
        if area > best_area {
            best_area = area;
            target_bounds = rect;
            target_index = Some(i);
        }
    }
    // minimized / another Space / off-screen
    let target_index = target_index?;

    let total = target_bounds.size.width * target_bounds.size.height;
    let mut covered = 0.0;
    for i in 0..target_index {
        // windows in front of the target
        let Some(entry) = dict_of(&list, i) else {
            continue;
        };
        let pid = pid_of(entry);
        if pid == target_pid || pid == my_pid || layer_of(entry) != 0 {
            continue; // skip the target's own windows and our panel
        }
        let intersection = CGRectIntersection(bounds_of(entry), target_bounds);
        if !CGRectIsNull(intersection) {
            covered += intersection.size.width * intersection.size.height;
        }
    }

    (total <= 0.0 || (covered / total) <= OCCLUSION_THRESHOLD).then_some(target_bounds)
}

unsafe extern "C-unwind" fn observer_callback(
    _observer: NonNull<AXObserver>,
    element: NonNull<AXUIElement>,
    notification: NonNull<CFString>,
    _refcon: *mut c_void,
) {
    let notification = unsafe { notification.as_ref() }.to_string();
    STICK.with_borrow_mut(|stick| match notification.as_str() {
        ax::NOTIFY_WINDOW_MINIATURIZED => stick.mark_hidden("hidden"),
        ax::NOTIFY_WINDOW_DEMINIATURIZED => stick.reevaluate(),
        ax::NOTIFY_UI_ELEMENT_DESTROYED
        | ax::NOTIFY_FOCUSED_WINDOW_CHANGED
        | ax::NOTIFY_MAIN_WINDOW_CHANGED => {
            stick.rebind_window();
            stick.reevaluate();
        }
        // moved / resized — only follow while the target is visible (occlusion is
        // gated by the timer's reevaluate()).
        _ => {
            if !stick.visible {
                return;
            }
            if let Some(rect) = ax::ax_frame(unsafe { element.as_ref() }) {
                stick.emit_frame(rect);
                stick.emit_status("attached", Some("ax"));
            }
        }
    });
}

unsafe extern "C-unwind" fn timer_callback(_timer: *mut CFRunLoopTimer, _info: *mut c_void) {
    STICK.with_borrow_mut(|stick| {
        if stick.pid == 0 {
            stick.resolve();
            return;
        }
        let app = NSRunningApplication::runningApplicationWithProcessIdentifier(stick.pid);
        match app {
            Some(app) if !app.isTerminated() => {
                stick.reevaluate(); // occlusion + visibility pass (and position resync)
            }
            _ => {
                stick.clear_target();
                stick.emit_status("waiting", None);
            }
        }
    });
}

#[napi]
pub fn start(target: String, on_frame: FrameFn, on_status: StatusFn) -> Result<()> {
    STICK.with_borrow_mut(|stick| {
        stick.stop();
        stick.needle = target.to_lowercase();
        stick.frame_fn = Some(on_frame);
        stick.status_fn = Some(on_status);

        // Reported, never prompted for: asking is the onboarding gate's job, and a
        // second system prompt fired from here would arrive with no explanation.
        stick.trusted = unsafe { AXIsProcessTrusted() };
        if !stick.trusted {
            stick.emit_status("permission", None);
        }

        stick.resolve();

        // AX mode: 10Hz occlusion/visibility check (AX events drive smooth position).
        // Poll mode: 60Hz drives everything.
        let interval = if stick.trusted { 0.1 } else { 1.0 / 60.0 };
        let timer = unsafe {
            CFRunLoopTimer::new(
                None,
                CFAbsoluteTimeGetCurrent() + interval,
                interval,
                0,
                0,
                Some(timer_callback),
                std::ptr::null_mut(),
            )
        };
        if let (Some(timer), Some(run_loop)) = (timer, CFRunLoop::main()) {
            unsafe { run_loop.add_timer(Some(&timer), kCFRunLoopCommonModes) };
            stick.timer = Some(timer);
        }
    });
    Ok(())
}

#[napi]
pub fn stop() {
    STICK.with_borrow_mut(Stick::stop);
}

/// Turn off AppKit's automatic window animations (the fade on show/hide/order)
/// for the given window, so the panel appears and disappears instantly.
#[napi]
pub fn disable_animations(view: Buffer) -> Result<()> {
    let bytes: &[u8] = view.as_ref();
    if bytes.len() < std::mem::size_of::<*mut c_void>() {
        return Err(napi::Error::from_reason(
            "disableAnimations(viewHandle) requires the Buffer from getNativeWindowHandle()",
        ));
    }
    // Electron hands out the NSView pointer as the Buffer's raw contents.
    let view = unsafe { *(bytes.as_ptr() as *const *const NSView) };
    let Some(view) = (unsafe { view.as_ref() }) else {
        return Ok(());
    };
    if let Some(window) = view.window() {
        window.setAnimationBehavior(NSWindowAnimationBehavior::None);
    }
    Ok(())
}
