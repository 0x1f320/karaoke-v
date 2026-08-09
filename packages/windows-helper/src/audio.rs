use crate::stick::monotonic_now;
use crate::types::JsAudioMeterSnapshot;

fn unsupported_snapshot() -> JsAudioMeterSnapshot {
    JsAudioMeterSnapshot {
        state: "unsupported".to_string(),
        updated_at_ms: monotonic_now(),
        momentary_lufs: None,
        rms_db: None,
        peak_db: None,
        sample_rate: None,
        channels: None,
        error: Some("WASAPI process loopback is not implemented yet".to_string()),
    }
}

#[napi]
pub fn start_audio_meter(_target: Option<String>) -> JsAudioMeterSnapshot {
    unsupported_snapshot()
}

#[napi]
pub fn stop_audio_meter() -> JsAudioMeterSnapshot {
    unsupported_snapshot()
}

#[napi]
pub fn read_audio_meter() -> JsAudioMeterSnapshot {
    unsupported_snapshot()
}
