// Presses SynthV's Scripts ▸ Rescan for it, so a bridge script the app has just
// written is picked up by a SynthV that is already running.
//
// Measured, because none of it is documented: a rescan re-executes every script
// file, and it cancels the timers the previous copy had scheduled — so the old
// bridge stops publishing rather than running alongside the new one. Pressing
// the item through AX does not open the menu on screen and does not take focus.

use objc2_application_services::{AXError, AXUIElement};
use objc2_core_foundation::{CFArray, CFBoolean, CFRetained, CFString};

use crate::ax::copy_attribute;

const ATTR_MENU_BAR: &str = "AXMenuBar";
const ATTR_CHILDREN: &str = "AXChildren";
const ATTR_TITLE: &str = "AXTitle";
const ATTR_ENABLED: &str = "AXEnabled";
const ACTION_PRESS: &str = "AXPress";

/// The English title of the menu the item lives in, for the case below where
/// nothing of ours is in it yet.
const SCRIPTS_MENU: &str = "Scripts";
const RESCAN_ITEM: &str = "Rescan";

/// SynthV lists a script's category as a disabled header inside the Scripts
/// menu, so our own category identifies that menu whatever language SynthV is
/// running in — as long as a copy of the script has been loaded once before.
const CATEGORY_MARKER: &str = "0x1F956";

fn children(el: &AXUIElement) -> Vec<CFRetained<AXUIElement>> {
    let attribute = CFString::from_static_str(ATTR_CHILDREN);
    let Some(value) = copy_attribute(el, &attribute) else {
        return Vec::new();
    };
    let Ok(array) = value.downcast::<CFArray>() else {
        return Vec::new();
    };
    (0..array.count())
        .filter_map(|index| {
            let raw = unsafe { array.value_at_index(index) } as *const AXUIElement;
            std::ptr::NonNull::new(raw.cast_mut()).map(|el| unsafe { CFRetained::retain(el) })
        })
        .collect()
}

fn title(el: &AXUIElement) -> Option<String> {
    let attribute = CFString::from_static_str(ATTR_TITLE);
    let value = copy_attribute(el, &attribute)?;
    Some(value.downcast::<CFString>().ok()?.to_string())
}

fn is_enabled(el: &AXUIElement) -> bool {
    let attribute = CFString::from_static_str(ATTR_ENABLED);
    copy_attribute(el, &attribute)
        .and_then(|value| value.downcast::<CFBoolean>().ok())
        .is_some_and(|flag| flag.as_bool())
}

/// The menu behind a menu bar item — its only child.
fn submenu(item: &AXUIElement) -> Option<CFRetained<AXUIElement>> {
    children(item).into_iter().next()
}

fn lists_our_scripts(menu: &AXUIElement) -> bool {
    children(menu)
        .iter()
        .any(|item| title(item).as_deref() == Some(CATEGORY_MARKER))
}

fn find_scripts_menu(menu_bar: &AXUIElement) -> Option<CFRetained<AXUIElement>> {
    let mut by_title = None;
    for bar_item in children(menu_bar) {
        let Some(menu) = submenu(&bar_item) else {
            continue;
        };
        if lists_our_scripts(&menu) {
            return Some(menu);
        }
        if title(&bar_item).as_deref() == Some(SCRIPTS_MENU) {
            by_title = Some(menu);
        }
    }
    by_title
}

/// Rescan is the menu's first command. Falling back to it by position is what
/// keeps this working under a SynthV whose UI is not in English, where the only
/// other handle — the title — is translated.
fn find_rescan(menu: &AXUIElement) -> Option<CFRetained<AXUIElement>> {
    let items = children(menu);
    let mut first_enabled = None;
    for item in items {
        if !is_enabled(&item) {
            continue;
        }
        if title(&item).as_deref() == Some(RESCAN_ITEM) {
            return Some(item);
        }
        if first_enabled.is_none() {
            first_enabled = Some(item);
        }
    }
    first_enabled
}

/// Press Scripts ▸ Rescan in the target app. False when the app is not running,
/// when Accessibility is not granted, or when the menu could not be identified —
/// in which case the script is still installed and a restart of SynthV picks it
/// up.
#[napi]
pub fn rescan_scripts(target: Option<String>) -> bool {
    let Some(pid) = crate::pianoroll::target_pid(target) else {
        return false;
    };
    let app = unsafe { AXUIElement::new_application(pid) };
    let attribute = CFString::from_static_str(ATTR_MENU_BAR);
    let Some(menu_bar) = copy_attribute(&app, &attribute) else {
        return false;
    };
    let Ok(menu_bar) = menu_bar.downcast::<AXUIElement>() else {
        return false;
    };
    let Some(menu) = find_scripts_menu(&menu_bar) else {
        return false;
    };
    let Some(item) = find_rescan(&menu) else {
        return false;
    };
    let action = CFString::from_static_str(ACTION_PRESS);
    unsafe { item.perform_action(&action) == AXError::Success }
}
