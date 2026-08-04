use windows::Win32::Foundation::RECT;

#[napi(object)]
pub struct JsRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl From<RECT> for JsRect {
    fn from(rect: RECT) -> Self {
        JsRect {
            x: rect.left as f64,
            y: rect.top as f64,
            w: (rect.right - rect.left) as f64,
            h: (rect.bottom - rect.top) as f64,
        }
    }
}

#[napi(object)]
pub struct JsTargetFrame {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub visible: bool,
    pub foreground: bool,
}

#[napi(object)]
pub struct JsCanvas {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    /// The window the canvas was found in, as a decimal string — a HWND does not
    /// survive a round trip through a JS number on 64-bit.
    pub hwnd: String,
    pub elements: u32,
    pub origin: Option<JsRect>,
}

#[napi(object)]
pub struct JsElement {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub control_type: i32,
}

#[napi(object)]
pub struct JsStatus {
    pub state: String,
}
