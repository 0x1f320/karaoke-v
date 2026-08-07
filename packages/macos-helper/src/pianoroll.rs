// Finds SynthV's piano-roll geometry via the Accessibility API for the overlay.
//
// getPianoRoll()/getPianoRollAsync() still expose the full AX walk (~50ms) and
// return the visible canvas rect, content group metrics, and visible note rects
// in global screen points. The overlay uses that walk only to seed cached
// elements when needed; note recognition is computed from the bridge schedule
// and view transform in the preload.
//
// The canvas rect comes from the note area's scrollbar pair, less the group
// banner strip those bars enclose above the lanes (see compute); the content
// group (for scroll/zoom) is the widest group aligned to the canvas' top-left.

use std::cell::RefCell;
use std::ptr::NonNull;

use napi::bindgen_prelude::{AsyncTask, Env, Result, Task};
use objc2_app_kit::{NSApplicationActivationPolicy, NSWorkspace};
use objc2_application_services::{AXCopyMultipleAttributeOptions, AXError, AXUIElement};
use objc2_core_foundation::{CFArray, CFRetained, CFString, CFType, CGPoint, CGRect, CGSize};

use crate::ax::{self, SendElement};
use crate::types::{JsPianoRoll, JsRect, JsViewport};

/// Slack for matching a scrollbar pair to the same box: bars sit a few px outside
/// the content they bound, and the two need not end at exactly the same pixel.
const BAR_SLACK: f64 = 16.0;

/// One piano-roll lane. Chips are a fixed 24px tall (a note's lyric chip and the
/// phoneme chip above it); 28 leaves room for the pair-matching slack.
const LANE: f64 = 28.0;

const DEFAULT_TARGET: &str = "synthesizer";

/// A candidate element and its frame at walk time.
type Candidate = (CGRect, SendElement);

/// Accumulator during the tree walk. Scrollbars are collected rather than picked
/// here: which vertical bar belongs to the note area can only be decided once the
/// horizontal one is known, and that is not settled until the walk is over.
#[derive(Default)]
struct Walked {
    hbars: Vec<Candidate>,
    vbars: Vec<Candidate>,
    groups: Vec<Candidate>,
    notes: Vec<Candidate>,
}

/// Computed result (screen points) + geometry elements for the viewport cache.
pub struct PianoRollResult {
    window_el: SendElement,
    canvas: CGRect,
    /// How far the note lanes start below the scrollbar box (the group banner strip).
    top_inset: f64,
    content_x: f64,
    content_w: f64,
    /// Vertical reference: one note chip's element + its y at read time. Nothing
    /// scalar in SynthV's AX tree tracks vertical scroll (the scrollbar value is
    /// dead, no thumb child, no moving group) — but chip frames do move, so one
    /// cached chip read per frame gives the vertical scroll delta directly.
    ref_el: Option<SendElement>,
    ref_y: f64,
    /// False when the chips moved vertically during this read: their y values are
    /// then mutually skewed (no per-chip y reference exists) — discard the read.
    y_stable: bool,
    /// False when horizontal scroll or zoom moved during this read: chip x values
    /// and widths are then mutually skewed — discard the read.
    x_stable: bool,
    notes: Vec<CGRect>,
    content_el: Option<SendElement>,
    hbar_el: SendElement,
    vbar_el: SendElement,
}

/// Cached elements from the last full read, so getViewport reads cheaply.
#[derive(Default)]
struct Cache {
    window: Option<SendElement>,
    content: Option<SendElement>,
    hbar: Option<SendElement>,
    vbar: Option<SendElement>,
    /// Vertical reference chip, from the last stable read.
    reference: Option<SendElement>,
    /// Banner inset from the last full read. Scalar rather than an element to
    /// re-read: it only changes when the window layout does, and the notes pump
    /// refreshes it.
    top_inset: f64,
}

struct ViewportRead {
    content: Option<SendElement>,
    hbar: SendElement,
    vbar: SendElement,
    reference: Option<SendElement>,
    top_inset: f64,
}

struct CanvasRead {
    window: SendElement,
    hbar: SendElement,
    vbar: SendElement,
    top_inset: f64,
}

thread_local! {
    static CACHE: RefCell<Cache> = RefCell::new(Cache::default());
}

#[derive(PartialEq)]
enum Role {
    Group,
    ScrollBar,
    Other,
}

/// role + frame + children of a node. Reads all four AX attributes in ONE IPC
/// round-trip via AXUIElementCopyMultipleAttributeValues (vs 4 separate calls).
fn read_node(el: &AXUIElement) -> Option<(Role, Option<CGRect>, CFRetained<CFArray>)> {
    let mut values: *const CFArray = std::ptr::null();
    let err = unsafe {
        el.copy_multiple_attribute_values(
            &ax::names().node_attrs,
            AXCopyMultipleAttributeOptions::empty(),
            NonNull::from(&mut values),
        )
    };
    if err != AXError::Success {
        return None;
    }
    let values = unsafe { CFRetained::from_raw(NonNull::new(values.cast_mut())?) };
    if values.count() < 4 {
        return None;
    }
    let at = |index: isize| -> Option<&CFType> {
        unsafe { (values.value_at_index(index) as *const CFType).as_ref() }
    };
    let names = ax::names();
    let role = match at(0).and_then(|v| v.downcast_ref::<CFString>()) {
        Some(role) if role == &*names.role_group => Role::Group,
        Some(role) if role == &*names.role_scroll_bar => Role::ScrollBar,
        _ => Role::Other,
    };
    let point = at(1).and_then(ax::ax_point);
    let size = at(2).and_then(ax::ax_size);
    let frame = point.zip(size).map(|(p, s)| CGRect::new(p, s));
    // The values array is handed back rather than the children it holds: the
    // children borrow from it, so keeping it alive saves a CFRetain/CFRelease per
    // node, and the walk visits thousands of them.
    Some((role, frame, values))
}

fn walk(el: &AXUIElement, depth: u32, out: &mut Walked) {
    if depth > 30 {
        return;
    }
    let Some((role, frame, values)) = read_node(el) else {
        return;
    };
    if let Some(frame) = frame {
        let retain = || SendElement(unsafe { CFRetained::retain(NonNull::from(el)) });
        // Every scrollbar is a candidate; compute pairs them into the note area's.
        if role == Role::ScrollBar {
            let bars = if frame.size.width > frame.size.height {
                &mut out.hbars
            } else {
                &mut out.vbars
            };
            bars.push((frame, retain()));
        }
        // Content-group candidates: large groups (span the note area).
        if role == Role::Group && frame.size.width >= 400.0 && frame.size.height >= 400.0 {
            out.groups.push((frame, retain()));
        }
        // Note-shaped groups (one lane tall). Collect loosely; filter to the canvas
        // below. Deliberately NO position test here: the canvas rect isn't known
        // until the walk is over, so any absolute cutoff (this once read
        // `f.origin.y > 400`, meant to skip toolbar-sized groups) is a guess about
        // where the window sits on screen. With the window high on the display the
        // canvas' top lanes fall above such a cutoff and their chips are dropped
        // before the canvas filter ever sees them — notes at the top of the piano
        // roll read as undetected. Off-canvas candidates are rejected below.
        if role == Role::Group
            && frame.size.height >= 20.0
            && frame.size.height <= 28.0
            && frame.size.width >= 4.0
        {
            out.notes.push((frame, retain()));
        }
    }
    let children = unsafe { (values.value_at_index(3) as *const CFType).as_ref() }
        .and_then(|v| v.downcast_ref::<CFArray>());
    let Some(children) = children else { return };
    for index in 0..children.count() {
        let child = unsafe { children.value_at_index(index) } as *const AXUIElement;
        if let Some(child) = unsafe { child.as_ref() } {
            walk(child, depth + 1, out);
        }
    }
}

/// Walk the app (by pid) and compute the piano-roll geometry. AX/CoreGraphics only
/// — safe to call off the main thread. Never touches the module cache.
fn compute(pid: i32) -> Option<PianoRollResult> {
    let app = unsafe { AXUIElement::new_application(pid) };
    let window = ax::copy_main_window(&app)?;
    let mut walked = Walked::default();
    walk(&window, 0, &mut walked);

    // The note area's scrollbar pair. The widest horizontal bar is reliably its
    // own — nothing else in the window spans the note area. "Tallest vertical" is
    // NOT: SynthV's side panels carry taller bars than the note area's (measured
    // on 2 Pro: a 1320px panel bar against the note area's 966px). Picking by
    // height alone chose a bar sitting LEFT of the canvas, so cw came out negative
    // and every note and content-group candidate was silently filtered away —
    // notes read as undetected while the walk was in fact finding them.
    //
    // So pick the vertical bar that PAIRS with the horizontal one: within its
    // x-span, and not reaching below it. That is the bar bounding the same box.
    let hpick = walked
        .hbars
        .iter()
        .max_by(|a, b| a.0.size.width.total_cmp(&b.0.size.width))?;
    let hbar = hpick.0;
    let vpick = walked
        .vbars
        .iter()
        .filter(|(vb, _)| {
            vb.origin.x > hbar.origin.x + BAR_SLACK // left of the canvas
                && vb.origin.x <= hbar.origin.x + hbar.size.width + BAR_SLACK // right of it
                && vb.origin.y + vb.size.height <= hbar.origin.y + BAR_SLACK // runs past its bottom
        })
        .max_by(|a, b| a.0.size.height.total_cmp(&b.0.size.height))?;
    let vbar = vpick.0;
    let hbar_el = hpick.1.clone();
    let vbar_el = vpick.1.clone();

    let cx = hbar.origin.x;
    let cy_raw = vbar.origin.y;
    let cw = vbar.origin.x - cx;
    let chh_raw = hbar.origin.y - cy_raw;

    // The scrollbar box starts ABOVE the note lanes: SynthV draws the group banner
    // ("Unnamed Track", a ~20px strip) inside it, and the lanes, the piano keyboard
    // and the note fills all begin below that strip (measured: bars at y=280, lanes
    // at y=300). Clipping the overlay to the scrollbar box therefore lets effects
    // spill over the banner. The strip's own AXGroup sits at the canvas' top-left
    // and is narrower than the canvas, so its height gives the inset directly —
    // read it rather than hardcoding 20, and fall back to no inset when no such
    // group exists.
    let mut top_inset: f64 = 0.0;
    for (frame, _) in &walked.notes {
        if frame.size.height >= 24.0 || frame.size.width >= cw {
            continue; // a chip, or full width
        }
        if (frame.origin.x - cx).abs() > 2.0 || (frame.origin.y - cy_raw).abs() > 2.0 {
            continue;
        }
        top_inset = top_inset.max(frame.origin.y + frame.size.height - cy_raw);
    }
    // Vertical confinement of the content group is tested against the scrollbar
    // box, which is what the group is laid out in — the inset only trims what the
    // overlay may paint on.
    let cy = cy_raw + top_inset;
    let chh = chh_raw - top_inset;

    // Content group = the widest group confined to the canvas region vertically and
    // overlapping it horizontally. Vertical confinement is what excludes the
    // full-window group, so it can't win by width when zoomed out.
    //
    // Horizontal position is deliberately NOT constrained. The content group's left
    // edge is where the content begins, which only coincides with the canvas' left
    // edge when the note group starts at the very beginning of the view. Requiring
    // that (it once read `gf.origin.x <= cx + 8`) dropped every candidate whenever
    // the group sat mid-viewport, leaving getViewport with nothing to read — and a
    // null viewport means the overlay draws nothing at all, so the notes looked
    // undetected even though the walk had found them.
    let mut content = CGRect::new(
        CGPoint::new(cx, cy_raw),
        CGSize::new(cw, chh_raw), // fallback: no scroll info
    );
    let mut content_el: Option<&SendElement> = None;
    let mut best = -1.0;
    for (frame, el) in &walked.groups {
        if frame.origin.x < cx + cw - 8.0
            && frame.origin.x + frame.size.width > cx + 8.0
            && frame.origin.y >= cy_raw - 8.0
            && frame.origin.y + frame.size.height <= cy_raw + chh_raw + 8.0
            && frame.size.width > best
        {
            best = frame.size.width;
            content = *frame;
            content_el = Some(el);
        }
    }

    // Chip candidates in the canvas' vertical band (walk-time frames). The x filter
    // and pair-matching wait until after normalization below: mid-scroll, walk-time
    // x coordinates are skewed and can't be compared.
    //
    // Chips are kept when they INTERSECT the band, not when their top sits inside
    // it: the topmost visible lane is usually half-scrolled, so its chip starts a
    // few px above the canvas — a top-edge test dropped exactly those notes.
    //
    // The band is also grown by one lane at both edges so pair-dedup sees a
    // partner that fell just outside it. Without that, a note straddling the
    // bottom edge keeps its phoneme chip (its lyric twin is out of the band) and
    // draws a box on the label. Chips outside the canvas proper are dropped from
    // the output below, after they have done their job as partners.
    let banded: Vec<&Candidate> = walked
        .notes
        .iter()
        .filter(|(n, _)| {
            n.size.height >= 22.0
                && n.origin.y + n.size.height > cy - LANE
                && n.origin.y < cy + chh + LANE
        })
        .collect();

    // Skew-free frames. The walk samples each element at a different instant, so a
    // read taken mid-scroll disagrees across chips by v*dt px — enough to break the
    // 2px pair-matching below (leaving phoneme chips behind) and to bake x errors
    // into the output. Re-read every chip back-to-back with the content group and
    // normalize into one reference content frame (x_ref); adjacent reads are ~100us
    // apart, so the residual skew is sub-pixel at any scroll speed.
    let mut x_ref = content.origin.x;
    let mut content_w = content.size.width;
    let mut chips: Vec<(CGRect, &SendElement)> = Vec::new();
    let mut x_stable = true;
    if let Some(content_el) = content_el {
        if let Some(frame) = ax::ax_frame(content_el.get()) {
            x_ref = frame.origin.x;
            content_w = frame.size.width;
        }
        for (_, el) in &banded {
            let Some(mut frame) = ax::ax_frame(el.get()) else {
                continue;
            };
            let current = ax::ax_frame(content_el.get())
                .map(|c| c.origin.x)
                .unwrap_or(x_ref);
            frame.origin.x += x_ref - current; // normalize into the x_ref content frame
            chips.push((frame, el));
        }
        if let Some(after) = ax::ax_frame(content_el.get()) {
            if (after.origin.x - x_ref).abs() > 0.5 || (after.size.width - content_w).abs() > 0.5 {
                x_stable = false;
            }
        }
    } else {
        chips = banded.iter().map(|(frame, el)| (*frame, el)).collect();
    }

    // Visible chips: x-intersect the canvas, in consistent (normalized) coords.
    let visible: Vec<(CGRect, &SendElement)> = chips
        .iter()
        .filter(|(c, _)| c.origin.x + c.size.width > cx && c.origin.x < cx + cw)
        .map(|(c, el)| (*c, *el))
        .collect();

    // Each note exposes two stacked 24px chips: the phoneme label above and the
    // lyric chip on the note itself (verified by screen capture). Pair matching is
    // by X-OVERLAP + one lane down, not exact x: notes on a track are sequential
    // in time so real notes' x ranges never overlap — only a pair's chips do —
    // and overlap survives the few-px divergence SynthV's label relayout causes
    // mid-scrub (exact-x matching missed those, leaving phantom phoneme boxes).
    // Keep the lyric chip = the one with no overlapping twin directly below it.
    let mut notes: Vec<CGRect> = Vec::new();
    let mut ref_el: Option<SendElement> = None;
    let mut ref_y = 0.0;
    for (n, el) in &visible {
        let twin_below = visible.iter().any(|(o, _)| {
            let overlap = (n.origin.x + n.size.width).min(o.origin.x + o.size.width)
                - n.origin.x.max(o.origin.x);
            overlap > 2.0
                && (o.size.width - n.size.width).abs() < 2.0
                && (o.origin.y - (n.origin.y + n.size.height)).abs() < 4.0
        });
        if twin_below {
            continue;
        }
        // Drop the out-of-canvas partners the band was widened for; they exist
        // only so the dedup above can see them.
        if n.origin.y + n.size.height <= cy || n.origin.y >= cy + chh {
            continue;
        }
        if ref_el.is_none() {
            ref_el = Some((*el).clone());
            ref_y = n.origin.y;
        }
        notes.push(*n);
    }

    // Stability check: re-read the reference chip after all chip reads. If it moved,
    // vertical scroll was in motion during this read and the per-chip y values are
    // mutually skewed — flag the read so callers discard it.
    let mut y_stable = true;
    if let Some(reference) = &ref_el {
        if let Some(frame) = ax::ax_frame(reference.get()) {
            if (frame.origin.y - ref_y).abs() > 0.5 {
                y_stable = false;
            }
        }
    }

    Some(PianoRollResult {
        window_el: SendElement(window),
        canvas: CGRect::new(CGPoint::new(cx, cy), CGSize::new(cw, chh)),
        top_inset,
        content_x: x_ref,
        content_w,
        ref_el,
        ref_y,
        y_stable,
        x_stable,
        notes,
        content_el: content_el.cloned(),
        hbar_el,
        vbar_el,
    })
}

fn build(result: &PianoRollResult) -> JsPianoRoll {
    JsPianoRoll {
        canvas: result.canvas.into(),
        content_x: result.content_x,
        content_w: result.content_w,
        ref_y: result.ref_y,
        y_stable: result.y_stable,
        x_stable: result.x_stable,
        notes: result.notes.iter().map(|n| JsRect::from(*n)).collect(),
    }
}

/// Move the result's geometry elements into the module cache (main thread only).
/// The vertical reference chip is only adopted from stable reads: an unstable
/// read is discarded by the caller, and swapping the reference underneath the
/// caller's last accepted read would make ref_y deltas compare different chips.
fn adopt(result: PianoRollResult) {
    CACHE.with_borrow_mut(|cache| {
        let stable = result.x_stable && result.y_stable;
        let reference = if stable {
            result.ref_el
        } else {
            cache.reference.take()
        };
        *cache = Cache {
            window: Some(result.window_el),
            content: result.content_el,
            hbar: Some(result.hbar_el),
            vbar: Some(result.vbar_el),
            reference,
            top_inset: result.top_inset,
        };
    });
}

fn find_synth_pid(needle: &str) -> Option<i32> {
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
            return Some(app.processIdentifier());
        }
    }
    None
}

pub fn target_pid(target: Option<String>) -> Option<i32> {
    let needle = target
        .unwrap_or_else(|| DEFAULT_TARGET.to_owned())
        .to_lowercase();
    find_synth_pid(&needle)
}

#[napi]
pub fn get_piano_roll(target: Option<String>) -> Option<JsPianoRoll> {
    let result = compute(target_pid(target)?)?;
    let out = build(&result);
    adopt(result);
    Some(out)
}

pub struct PianoRollTask {
    pid: i32,
}

impl Task for PianoRollTask {
    type Output = Option<PianoRollResult>;
    type JsValue = Option<JsPianoRoll>;

    fn compute(&mut self) -> Result<Self::Output> {
        Ok(compute(self.pid))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.map(|result| {
            let out = build(&result);
            adopt(result);
            out
        }))
    }
}

/// Runs the walk off the main thread, resolving a Promise with the result.
#[napi]
pub fn get_piano_roll_async(target: Option<String>) -> AsyncTask<PianoRollTask> {
    // pid 0 has no AX tree, so the walk falls out immediately and the promise
    // resolves null — the same answer as "target not running".
    AsyncTask::new(PianoRollTask {
        pid: target_pid(target).unwrap_or(0),
    })
}

fn snapshot_viewport_read() -> Option<ViewportRead> {
    CACHE.with_borrow(|cache| {
        Some(ViewportRead {
            content: cache.content.clone(),
            hbar: cache.hbar.clone()?,
            vbar: cache.vbar.clone()?,
            reference: cache.reference.clone(),
            top_inset: cache.top_inset,
        })
    })
}

fn snapshot_canvas_read() -> Option<CanvasRead> {
    CACHE.with_borrow(|cache| {
        Some(CanvasRead {
            window: cache.window.clone()?,
            hbar: cache.hbar.clone()?,
            vbar: cache.vbar.clone()?,
            top_inset: cache.top_inset,
        })
    })
}

fn local_canvas(canvas: CGRect, window: CGRect) -> CGRect {
    CGRect::new(
        CGPoint::new(
            canvas.origin.x - window.origin.x,
            canvas.origin.y - window.origin.y,
        ),
        canvas.size,
    )
}

fn frame_changed(before: CGRect, after: CGRect) -> bool {
    (before.origin.x - after.origin.x).abs() > 0.5
        || (before.origin.y - after.origin.y).abs() > 0.5
        || (before.size.width - after.size.width).abs() > 0.5
        || (before.size.height - after.size.height).abs() > 0.5
}

fn read_canvas(read: &CanvasRead) -> Option<CGRect> {
    let before = ax::ax_frame(read.window.get())?;
    let hbar = ax::ax_frame(read.hbar.get())?;
    let vbar = ax::ax_frame(read.vbar.get())?;
    let after = ax::ax_frame(read.window.get())?;
    if frame_changed(before, after) {
        return None;
    }
    let x = hbar.origin.x;
    let y = vbar.origin.y + read.top_inset;
    Some(local_canvas(
        CGRect::new(
            CGPoint::new(x, y),
            CGSize::new(vbar.origin.x - x, hbar.origin.y - y),
        ),
        after,
    ))
}

pub struct CanvasTask {
    read: Option<CanvasRead>,
}

impl Task for CanvasTask {
    type Output = Option<CGRect>;
    type JsValue = Option<JsRect>;

    fn compute(&mut self) -> Result<Self::Output> {
        Ok(self.read.as_ref().and_then(read_canvas))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.map(JsRect::from))
    }
}

#[napi]
pub fn get_canvas_async() -> AsyncTask<CanvasTask> {
    AsyncTask::new(CanvasTask {
        read: snapshot_canvas_read(),
    })
}

fn read_viewport(read: &ViewportRead) -> Option<JsViewport> {
    let (Some(hbar), Some(vbar)) = (ax::ax_frame(read.hbar.get()), ax::ax_frame(read.vbar.get()))
    else {
        return None;
    };
    let mut content = CGRect::new(
        CGPoint::new(hbar.origin.x, vbar.origin.y),
        CGSize::new(vbar.origin.x - hbar.origin.x, hbar.origin.y - vbar.origin.y),
    );
    if let Some(content_el) = &read.content {
        content = ax::ax_frame(content_el.get())?;
    }
    let ref_y = read
        .reference
        .as_ref()
        .and_then(|reference| ax::ax_frame(reference.get()).map(|frame| frame.origin.y));

    let cx = hbar.origin.x;
    let cy = vbar.origin.y + read.top_inset;
    Some(JsViewport {
        canvas: JsRect {
            x: cx,
            y: cy,
            w: vbar.origin.x - cx,
            h: hbar.origin.y - cy,
        },
        content_x: content.origin.x,
        content_w: content.size.width,
        ref_y,
    })
}

pub struct ViewportTask {
    read: Option<ViewportRead>,
}

impl Task for ViewportTask {
    type Output = Option<JsViewport>;
    type JsValue = Option<JsViewport>;

    fn compute(&mut self) -> Result<Self::Output> {
        Ok(self.read.as_ref().and_then(read_viewport))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi]
pub fn get_viewport_async() -> AsyncTask<ViewportTask> {
    AsyncTask::new(ViewportTask {
        read: snapshot_viewport_read(),
    })
}

/// Cheap read: canvas rect + scroll/zoom from the cached elements (no walk).
#[napi]
pub fn get_viewport() -> Option<JsViewport> {
    CACHE.with_borrow_mut(|cache| {
        let Some(read) = (match (&cache.hbar, &cache.vbar) {
            (Some(hbar), Some(vbar)) => Some(ViewportRead {
                content: cache.content.clone(),
                hbar: hbar.clone(),
                vbar: vbar.clone(),
                reference: cache.reference.clone(),
                top_inset: cache.top_inset,
            }),
            _ => None,
        }) else {
            return None;
        };
        let out = read_viewport(&read);
        if out.is_none() {
            *cache = Cache::default();
        }
        out
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, w: f64, h: f64) -> CGRect {
        CGRect::new(CGPoint::new(x, y), CGSize::new(w, h))
    }

    #[test]
    fn local_canvas_does_not_move_when_the_window_translates() {
        let first = local_canvas(
            rect(140.0, 260.0, 800.0, 400.0),
            rect(100.0, 200.0, 1200.0, 800.0),
        );
        let moved = local_canvas(
            rect(440.0, 160.0, 800.0, 400.0),
            rect(400.0, 100.0, 1200.0, 800.0),
        );

        assert_eq!(first.origin.x, 40.0);
        assert_eq!(first.origin.y, 60.0);
        assert_eq!(first.size.width, 800.0);
        assert_eq!(first.size.height, 400.0);
        assert_eq!(first, moved);
    }
}
