// Supplies the one thing the bridge script cannot: where the piano roll actually
// is on screen. The script's t2x/v2y are canvas-local, so the overlay needs the
// canvas's screen rectangle to place anything, and SynthV draws the whole editor
// into a single JUCE HWND — there is no child window to measure.
//
// JUCE's accessibility layer exposes a flat UIA tree (~140 elements, all direct
// children of the window) with screen-coordinate bounding rectangles. The canvas
// is identified by agreement with the bridge, not by guessing at the layout: the
// visible time and value ranges times their px-per-unit give the canvas's exact
// pixel size, so we look for the element with those dimensions. That check is
// self-verifying and survives SynthV rearranging its panels.

use std::cell::RefCell;

use windows::Win32::Foundation::{HWND, RPC_E_CHANGED_MODE, S_FALSE, S_OK};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, TreeScope_Children,
};
use windows::Win32::UI::WindowsAndMessaging::IsWindow;

use crate::types::{JsCanvas, JsElement, JsRect};
use crate::win::{self, DEFAULT_TARGET};

const TOLERANCE: f64 = 2.0;

#[derive(Default)]
struct Uia {
    automation: Option<IUIAutomation>,
    canvas: Option<IUIAutomationElement>,
    window: Option<HWND>,
    com_ready: bool,
}

thread_local! {
    static UIA: RefCell<Uia> = RefCell::new(Uia::default());
}

impl Uia {
    fn ensure_com(&mut self) -> bool {
        if self.com_ready {
            return true;
        }
        let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        // The host may already have initialised COM on this thread with either
        // model; both outcomes are fine, we just must not uninitialise what we did
        // not own.
        self.com_ready = hr == S_OK || hr == S_FALSE || hr == RPC_E_CHANGED_MODE;
        self.com_ready
    }

    fn automation(&mut self) -> Option<IUIAutomation> {
        if let Some(automation) = &self.automation {
            return Some(automation.clone());
        }
        if !self.ensure_com() {
            return None;
        }
        let automation: IUIAutomation =
            unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) }.ok()?;
        self.automation = Some(automation.clone());
        Some(automation)
    }
}

fn needle_of(target: Option<String>) -> String {
    target
        .map(|t| t.to_lowercase())
        .unwrap_or_else(|| DEFAULT_TARGET.to_owned())
}

/// Every direct UIA child of the SynthV window, with the window it was found in.
fn children_of(needle: &str) -> Option<(HWND, Vec<IUIAutomationElement>)> {
    let automation = UIA.with_borrow_mut(Uia::automation)?;
    let hwnd = win::find_window_for_process(needle)?;
    let root = unsafe { automation.ElementFromHandle(hwnd) }.ok()?;
    let condition = unsafe { automation.CreateTrueCondition() }.ok()?;
    let children = unsafe { root.FindAll(TreeScope_Children, &condition) }.ok()?;
    let length = unsafe { children.Length() }.ok()?;
    let mut out = Vec::with_capacity(length.max(0) as usize);
    for index in 0..length {
        if let Ok(element) = unsafe { children.GetElement(index) } {
            out.push(element);
        }
    }
    Some((hwnd, out))
}

#[napi]
pub fn find_canvas(width: f64, height: f64, target: Option<String>) -> Option<JsCanvas> {
    let (hwnd, children) = children_of(&needle_of(target))?;
    let elements = children.len() as u32;

    let mut best: Option<(f64, JsRect, IUIAutomationElement)> = None;
    for element in children {
        let Ok(rect) = (unsafe { element.CurrentBoundingRectangle() }) else {
            continue;
        };
        let w = (rect.right - rect.left) as f64;
        let h = (rect.bottom - rect.top) as f64;
        let error = (w - width).abs() + (h - height).abs();
        if (w - width).abs() > TOLERANCE || (h - height).abs() > TOLERANCE {
            continue;
        }
        if best
            .as_ref()
            .is_none_or(|(previous, _, _)| error < *previous)
        {
            best = Some((error, rect.into(), element));
        }
    }

    let (_, rect, element) = best?;
    UIA.with_borrow_mut(|uia| {
        uia.canvas = Some(element);
        uia.window = Some(hwnd);
    });
    Some(JsCanvas {
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        // A HWND does not survive a round trip through a JS number on 64-bit.
        hwnd: (hwnd.0 as usize).to_string(),
        elements,
        origin: win::frame_of(hwnd).map(JsRect::from),
    })
}

/// The window origin is what the canvas rectangle is anchored to, and reading it
/// costs a DWM call rather than a cross-process UI Automation round trip. Deriving
/// the canvas from it every frame is both cheaper and — because the two numbers
/// come from the same instant — free of the drift that made the drawing wobble
/// while the window moved.
#[napi]
pub fn get_target_origin() -> Option<JsRect> {
    UIA.with_borrow_mut(|uia| {
        let window = uia.window?;
        if !unsafe { IsWindow(Some(window)) }.as_bool() {
            uia.window = None;
            return None;
        }
        win::frame_of(window).map(JsRect::from)
    })
}

#[napi]
pub fn get_canvas_rect() -> Option<JsRect> {
    UIA.with_borrow_mut(|uia| {
        let canvas = uia.canvas.as_ref()?;
        // The cached element going stale (layout rebuild, project switch) or
        // collapsing to nothing both mean the caller must run findCanvas again
        // rather than keep a dead rectangle.
        let rect = match unsafe { canvas.CurrentBoundingRectangle() } {
            Ok(rect) if rect.right > rect.left && rect.bottom > rect.top => rect,
            _ => {
                uia.canvas = None;
                return None;
            }
        };
        Some(JsRect::from(rect))
    })
}

/// Debug aid: every UI Automation child of the SynthV window with its rect.
#[napi]
pub fn list_elements(target: Option<String>) -> Option<Vec<JsElement>> {
    let (_, children) = children_of(&needle_of(target))?;
    Some(
        children
            .into_iter()
            .map(|element| {
                let rect = unsafe { element.CurrentBoundingRectangle() }.unwrap_or_default();
                let control_type = unsafe { element.CurrentControlType() }
                    .map(|t| t.0)
                    .unwrap_or_default();
                let rect = JsRect::from(rect);
                JsElement {
                    x: rect.x,
                    y: rect.y,
                    w: rect.w,
                    h: rect.h,
                    control_type,
                }
            })
            .collect(),
    )
}
