use objc2_core_foundation::CGRect;

#[napi(object)]
pub struct JsRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl From<CGRect> for JsRect {
    fn from(rect: CGRect) -> Self {
        JsRect {
            x: rect.origin.x,
            y: rect.origin.y,
            w: rect.size.width,
            h: rect.size.height,
        }
    }
}

#[napi(object)]
pub struct JsStatus {
    pub state: String,
    pub mode: Option<String>,
}

#[napi(object)]
pub struct JsAudioMeterSnapshot {
    pub state: String,
    pub updated_at_ms: f64,
    pub momentary_lufs: Option<f64>,
    pub rms_db: Option<f64>,
    pub peak_db: Option<f64>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u32>,
    pub error: Option<String>,
}

#[napi(object)]
pub struct JsPianoRoll {
    pub canvas: JsRect,
    pub content_x: f64,
    pub content_w: f64,
    pub ref_y: f64,
    pub y_stable: bool,
    pub x_stable: bool,
    pub notes: Vec<JsRect>,
}

#[napi(object)]
pub struct JsViewport {
    pub canvas: JsRect,
    pub content_x: f64,
    pub content_w: f64,
    pub ref_y: Option<f64>,
}
