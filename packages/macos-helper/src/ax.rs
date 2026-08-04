// Shared Accessibility helpers for the macOS addon.

use std::ffi::c_void;
use std::ptr::NonNull;
use std::sync::OnceLock;

use objc2_application_services::{AXError, AXUIElement, AXValue, AXValueType};
use objc2_core_foundation::{CFArray, CFRetained, CFString, CFType, CGPoint, CGRect, CGSize};

// The AX attribute and notification names are `#define`d to CFSTR(...) in the SDK
// headers, so no binding generator can emit them — they have to be spelled here.
pub const ATTR_ROLE: &str = "AXRole";
pub const ATTR_POSITION: &str = "AXPosition";
pub const ATTR_SIZE: &str = "AXSize";
pub const ATTR_CHILDREN: &str = "AXChildren";
pub const ATTR_MAIN_WINDOW: &str = "AXMainWindow";
pub const ATTR_FOCUSED_WINDOW: &str = "AXFocusedWindow";
pub const ATTR_WINDOWS: &str = "AXWindows";

pub const NOTIFY_MOVED: &str = "AXMoved";
pub const NOTIFY_RESIZED: &str = "AXResized";
pub const NOTIFY_WINDOW_MINIATURIZED: &str = "AXWindowMiniaturized";
pub const NOTIFY_WINDOW_DEMINIATURIZED: &str = "AXWindowDeminiaturized";
pub const NOTIFY_UI_ELEMENT_DESTROYED: &str = "AXUIElementDestroyed";
pub const NOTIFY_FOCUSED_WINDOW_CHANGED: &str = "AXFocusedWindowChanged";
pub const NOTIFY_MAIN_WINDOW_CHANGED: &str = "AXMainWindowChanged";

pub const ROLE_GROUP: &str = "AXGroup";
pub const ROLE_SCROLL_BAR: &str = "AXScrollBar";

/// The attribute-name strings, built once. The piano-roll walk asks for them per
/// node, and rebuilding a CFString each time would cost more than the AX reads.
pub struct Names {
    pub position: CFRetained<CFString>,
    pub size: CFRetained<CFString>,
    pub main_window: CFRetained<CFString>,
    pub focused_window: CFRetained<CFString>,
    pub windows: CFRetained<CFString>,
    /// The two roles the walk looks for, kept as CFStrings so a node's role can be
    /// classified by CFEqual. Converting each role to a Rust String instead costs a
    /// UTF-16 decode and an allocation per node, which nearly doubles the walk.
    pub role_group: CFRetained<CFString>,
    pub role_scroll_bar: CFRetained<CFString>,
    /// role + position + size + children, in the order `read_node` unpacks them.
    pub node_attrs: CFRetained<CFArray>,
}

// CFStrings and CFArrays are immutable once created, so sharing these across the
// piano-roll walk's worker thread is sound even though CFRetained is not Send.
unsafe impl Send for Names {}
unsafe impl Sync for Names {}

pub fn names() -> &'static Names {
    static NAMES: OnceLock<Names> = OnceLock::new();
    NAMES.get_or_init(|| {
        let role = CFString::from_static_str(ATTR_ROLE);
        let position = CFString::from_static_str(ATTR_POSITION);
        let size = CFString::from_static_str(ATTR_SIZE);
        let children = CFString::from_static_str(ATTR_CHILDREN);
        let node_attrs = CFArray::from_retained_objects(&[
            role.clone(),
            position.clone(),
            size.clone(),
            children.clone(),
        ]);
        Names {
            position,
            size,
            main_window: CFString::from_static_str(ATTR_MAIN_WINDOW),
            focused_window: CFString::from_static_str(ATTR_FOCUSED_WINDOW),
            windows: CFString::from_static_str(ATTR_WINDOWS),
            role_group: CFString::from_static_str(ROLE_GROUP),
            role_scroll_bar: CFString::from_static_str(ROLE_SCROLL_BAR),
            node_attrs: unsafe { CFRetained::cast_unchecked(node_attrs) },
        }
    })
}

/// Copy one attribute off an element. `None` when the element does not carry it.
pub fn copy_attribute(el: &AXUIElement, attribute: &CFString) -> Option<CFRetained<CFType>> {
    let mut value: *const CFType = std::ptr::null();
    let err = unsafe { el.copy_attribute_value(attribute, NonNull::from(&mut value)) };
    if err != AXError::Success {
        return None;
    }
    NonNull::new(value.cast_mut()).map(|v| unsafe { CFRetained::from_raw(v) })
}

/// Unwrap an AXValue into the geometry it wraps.
pub fn ax_point(value: &CFType) -> Option<CGPoint> {
    let value = value.downcast_ref::<AXValue>()?;
    let mut point = CGPoint::ZERO;
    let ok = unsafe {
        value.value(
            AXValueType::CGPoint,
            NonNull::new_unchecked(&mut point as *mut CGPoint as *mut c_void),
        )
    };
    ok.then_some(point)
}

pub fn ax_size(value: &CFType) -> Option<CGSize> {
    let value = value.downcast_ref::<AXValue>()?;
    let mut size = CGSize::ZERO;
    let ok = unsafe {
        value.value(
            AXValueType::CGSize,
            NonNull::new_unchecked(&mut size as *mut CGSize as *mut c_void),
        )
    };
    ok.then_some(size)
}

/// Read an element's screen frame (top-left origin, global points). `None` if the
/// element has no position/size.
pub fn ax_frame(el: &AXUIElement) -> Option<CGRect> {
    let names = names();
    let position = copy_attribute(el, &names.position)?;
    let size = copy_attribute(el, &names.size)?;
    Some(CGRect::new(ax_point(&position)?, ax_size(&size)?))
}

/// The app's main window (falling back to focused, then first), so tree walks and
/// frame reads skip the large menu-bar subtree.
pub fn copy_main_window(app: &AXUIElement) -> Option<CFRetained<AXUIElement>> {
    let names = names();
    for attribute in [&names.main_window, &names.focused_window] {
        if let Some(window) = copy_attribute(app, attribute) {
            if let Ok(window) = window.downcast::<AXUIElement>() {
                return Some(window);
            }
        }
    }
    let windows = copy_attribute(app, &names.windows)?;
    let windows = windows.downcast::<CFArray>().ok()?;
    if windows.count() == 0 {
        return None;
    }
    let first = unsafe { windows.value_at_index(0) } as *const AXUIElement;
    NonNull::new(first.cast_mut()).map(|el| unsafe { CFRetained::retain(el) })
}

/// AXUIElement is a CFType and the AX API may be called from any thread, so the
/// piano-roll walk can hand its findings back to the main thread. Rust cannot see
/// that through CFRetained, hence the wrapper.
pub struct SendElement(pub CFRetained<AXUIElement>);

unsafe impl Send for SendElement {}

impl SendElement {
    pub fn get(&self) -> &AXUIElement {
        &self.0
    }
}

impl Clone for SendElement {
    fn clone(&self) -> Self {
        SendElement(self.0.clone())
    }
}
