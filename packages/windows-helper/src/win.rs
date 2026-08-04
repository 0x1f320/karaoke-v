// The Win32 lookups both modules need: finding SynthV's window by its executable
// path, and measuring the rectangle it actually appears to occupy.

use std::ffi::c_void;

use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, LPARAM, MAX_PATH, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowRect, GetWindowTextLengthW, GetWindowThreadProcessId, IsWindowVisible,
};

pub const DEFAULT_TARGET: &str = "synthv-studio";

struct Search<'a> {
    needle: &'a str,
    found: Option<HWND>,
}

fn process_path(hwnd: HWND) -> Option<String> {
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == 0 {
        return None;
    }
    let process: HANDLE =
        unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let mut buffer = [0u16; MAX_PATH as usize];
    let mut size = buffer.len() as u32;
    let read = unsafe {
        QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_FORMAT(0),
            PWSTR(buffer.as_mut_ptr()),
            &mut size,
        )
    };
    let _ = unsafe { CloseHandle(process) };
    read.ok()?;
    Some(String::from_utf16_lossy(&buffer[..size as usize]).to_lowercase())
}

unsafe extern "system" fn enum_proc(hwnd: HWND, param: LPARAM) -> windows::core::BOOL {
    let search = unsafe { &mut *(param.0 as *mut Search) };
    // The main window is the one with a title; JUCE also keeps hidden helpers.
    if !unsafe { IsWindowVisible(hwnd) }.as_bool() || unsafe { GetWindowTextLengthW(hwnd) } == 0 {
        return true.into();
    }
    match process_path(hwnd) {
        Some(path) if path.contains(search.needle) => {
            search.found = Some(hwnd);
            false.into()
        }
        _ => true.into(),
    }
}

/// The visible, titled window of the first process whose image path contains
/// `needle` (which must already be lowercase).
pub fn find_window_for_process(needle: &str) -> Option<HWND> {
    let mut search = Search {
        needle,
        found: None,
    };
    // EnumWindows reports the callback's `false` as an error; the found window is
    // the result either way.
    let _ = unsafe { EnumWindows(Some(enum_proc), LPARAM(&mut search as *mut Search as isize)) };
    search.found
}

/// DWM's extended frame bounds exclude the invisible resize border, so this is the
/// rectangle the window actually looks like it occupies. GetWindowRect is several
/// pixels larger on every side and would leave the overlay visibly offset.
pub fn frame_of(hwnd: HWND) -> Option<RECT> {
    let mut rect = RECT::default();
    let dwm = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut rect as *mut RECT as *mut c_void,
            std::mem::size_of::<RECT>() as u32,
        )
    };
    if dwm.is_err() && unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
        return None;
    }
    Some(rect)
}
