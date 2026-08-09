use std::mem::{size_of, ManuallyDrop};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use windows::core::{implement, IUnknown, Interface, Ref, HRESULT};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Media::Audio::{
    ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
    IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
    IAudioCaptureClient, IAudioClient, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_LOOPBACK,
    AUDIOCLIENT_ACTIVATION_PARAMS, AUDIOCLIENT_ACTIVATION_PARAMS_0,
    AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
    WAVEFORMATEX, WAVE_FORMAT_PCM,
};
use windows::Win32::System::Com::StructuredStorage::{
    PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0,
};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, BLOB, COINIT_MULTITHREADED};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Variant::VT_BLOB;

use crate::stick::monotonic_now;
use crate::types::JsAudioMeterSnapshot;
use crate::win::DEFAULT_TARGET;

const MIN_PROCESS_LOOPBACK_BUILD: u32 = 20348;
const CAPTURE_SAMPLE_RATE: u32 = 44_100;
const CAPTURE_CHANNELS: u16 = 2;
const CAPTURE_BITS_PER_SAMPLE: u16 = 16;
const CAPTURE_BUFFER_MS: i64 = 100;

#[repr(C)]
struct RtlOsVersionInfoW {
    size: u32,
    major: u32,
    minor: u32,
    build: u32,
    platform_id: u32,
    service_pack: [u16; 128],
}

#[link(name = "ntdll")]
unsafe extern "system" {
    fn RtlGetVersion(version: *mut RtlOsVersionInfoW) -> i32;
}

struct AudioMeterRuntime {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

struct AudioMeterState {
    snapshot: JsAudioMeterSnapshot,
    runtime: Option<AudioMeterRuntime>,
}

struct ActivationState {
    completed: bool,
    result: Option<Result<IUnknown, String>>,
}

static AUDIO_METER: OnceLock<Mutex<AudioMeterState>> = OnceLock::new();

fn meter_state() -> &'static Mutex<AudioMeterState> {
    AUDIO_METER.get_or_init(|| {
        Mutex::new(AudioMeterState {
            snapshot: idle_snapshot(),
            runtime: None,
        })
    })
}

fn clone_snapshot(snapshot: &JsAudioMeterSnapshot) -> JsAudioMeterSnapshot {
    JsAudioMeterSnapshot {
        state: snapshot.state.clone(),
        updated_at_ms: snapshot.updated_at_ms,
        momentary_lufs: snapshot.momentary_lufs,
        rms_db: snapshot.rms_db,
        peak_db: snapshot.peak_db,
        sample_rate: snapshot.sample_rate,
        channels: snapshot.channels,
        error: snapshot.error.clone(),
    }
}

fn idle_snapshot() -> JsAudioMeterSnapshot {
    JsAudioMeterSnapshot {
        state: "idle".to_string(),
        updated_at_ms: monotonic_now(),
        momentary_lufs: None,
        rms_db: None,
        peak_db: None,
        sample_rate: None,
        channels: None,
        error: None,
    }
}

fn starting_snapshot() -> JsAudioMeterSnapshot {
    JsAudioMeterSnapshot {
        state: "starting".to_string(),
        updated_at_ms: monotonic_now(),
        momentary_lufs: None,
        rms_db: None,
        peak_db: None,
        sample_rate: None,
        channels: None,
        error: None,
    }
}

fn unsupported_snapshot(reason: String) -> JsAudioMeterSnapshot {
    JsAudioMeterSnapshot {
        state: "unsupported".to_string(),
        updated_at_ms: monotonic_now(),
        momentary_lufs: None,
        rms_db: None,
        peak_db: None,
        sample_rate: None,
        channels: None,
        error: Some(reason),
    }
}

fn error_snapshot(error: String) -> JsAudioMeterSnapshot {
    JsAudioMeterSnapshot {
        state: "error".to_string(),
        updated_at_ms: monotonic_now(),
        momentary_lufs: None,
        rms_db: None,
        peak_db: None,
        sample_rate: None,
        channels: None,
        error: Some(error),
    }
}

fn levels_snapshot(
    state: &str,
    momentary_lufs: Option<f64>,
    rms_db: Option<f64>,
    peak_db: Option<f64>,
) -> JsAudioMeterSnapshot {
    JsAudioMeterSnapshot {
        state: state.to_string(),
        updated_at_ms: monotonic_now(),
        momentary_lufs,
        rms_db,
        peak_db,
        sample_rate: Some(CAPTURE_SAMPLE_RATE),
        channels: Some(CAPTURE_CHANNELS as u32),
        error: None,
    }
}

fn store_snapshot(snapshot: JsAudioMeterSnapshot) {
    if let Ok(mut state) = meter_state().lock() {
        state.snapshot = snapshot;
    }
}

fn windows_build() -> Option<u32> {
    let mut info = RtlOsVersionInfoW {
        size: size_of::<RtlOsVersionInfoW>() as u32,
        major: 0,
        minor: 0,
        build: 0,
        platform_id: 0,
        service_pack: [0; 128],
    };
    let status = unsafe { RtlGetVersion(&mut info) };
    (status == 0).then_some(info.build)
}

fn find_target_process_id(target: &str) -> Result<u32, String> {
    let needle = target.to_lowercase();
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }
        .map_err(|error| format!("failed to enumerate processes: {error}"))?;
    let mut entry = PROCESSENTRY32W {
        dwSize: size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let first = unsafe { Process32FirstW(snapshot, &mut entry) };
    if let Err(error) = first {
        let _ = unsafe { CloseHandle(snapshot) };
        return Err(format!("failed to read process list: {error}"));
    }
    loop {
        let exe = wide_array_to_string(&entry.szExeFile).to_lowercase();
        if exe.contains(&needle) {
            let pid = entry.th32ProcessID;
            let _ = unsafe { CloseHandle(snapshot) };
            return Ok(pid);
        }
        if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
            break;
        }
    }
    let _ = unsafe { CloseHandle(snapshot) };
    Err(format!("target process not found: {target}"))
}

fn wide_array_to_string(value: &[u16]) -> String {
    let len = value.iter().position(|ch| *ch == 0).unwrap_or(value.len());
    String::from_utf16_lossy(&value[..len])
}

fn clamp_sample(sample: f32) -> f64 {
    if sample.is_finite() {
        sample.clamp(-1.0, 1.0) as f64
    } else {
        0.0
    }
}

fn amplitude_to_db(amplitude: f64) -> Option<f64> {
    if amplitude <= 0.0 {
        None
    } else {
        Some(20.0 * amplitude.log10())
    }
}

fn levels_from_f32(samples: &[f32]) -> (Option<f64>, Option<f64>, Option<f64>) {
    if samples.is_empty() {
        return (None, None, None);
    }
    let mut peak: f64 = 0.0;
    let mut sum_squares = 0.0;
    for sample in samples {
        let clamped = clamp_sample(*sample);
        peak = peak.max(clamped.abs());
        sum_squares += clamped * clamped;
    }
    let peak_db = amplitude_to_db(peak);
    let rms_db = amplitude_to_db((sum_squares / samples.len() as f64).sqrt());
    let momentary_lufs = rms_db.map(|db| db - 0.691);
    (momentary_lufs, rms_db, peak_db)
}

fn pcm_i16_to_f32(buffer: &[u8]) -> Vec<f32> {
    buffer
        .chunks_exact(2)
        .map(|bytes| i16::from_le_bytes([bytes[0], bytes[1]]) as f32 / i16::MAX as f32)
        .collect()
}

#[implement(
    IActivateAudioInterfaceCompletionHandler,
    windows_core::imp::IAgileObject
)]
struct ActivationCompletion {
    pair: Arc<(Mutex<ActivationState>, Condvar)>,
}

impl IActivateAudioInterfaceCompletionHandler_Impl for ActivationCompletion_Impl {
    fn ActivateCompleted(
        &self,
        activate_operation: Ref<IActivateAudioInterfaceAsyncOperation>,
    ) -> windows::core::Result<()> {
        let (lock, cvar) = &*self.pair;
        let result = read_activation_result(&activate_operation);
        if let Ok(mut state) = lock.lock() {
            state.completed = true;
            state.result = Some(result);
            cvar.notify_one();
        }
        Ok(())
    }
}

impl windows_core::imp::IAgileObject_Impl for ActivationCompletion_Impl {}

fn read_activation_result(
    activate_operation: &Ref<IActivateAudioInterfaceAsyncOperation>,
) -> Result<IUnknown, String> {
    let operation = activate_operation
        .ok()
        .map_err(|error| format!("process loopback activation callback was invalid: {error}"))?;
    let mut result = HRESULT(0);
    let mut unknown: Option<IUnknown> = None;
    unsafe { operation.GetActivateResult(&mut result, &mut unknown) }
        .map_err(|error| format!("failed to read process loopback activation result: {error}"))?;
    result
        .ok()
        .map_err(|error| format!("process loopback activation failed: {error}"))?;
    unknown.ok_or_else(|| "process loopback returned no audio client".to_string())
}

fn activate_process_loopback(pid: u32) -> Result<IAudioClient, String> {
    let pair = Arc::new((
        Mutex::new(ActivationState {
            completed: false,
            result: None,
        }),
        Condvar::new(),
    ));
    let completion: IActivateAudioInterfaceCompletionHandler = ActivationCompletion {
        pair: Arc::clone(&pair),
    }
    .into();
    let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: pid,
                ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            },
        },
    };
    let blob = BLOB {
        cbSize: size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
        pBlobData: &mut params as *mut AUDIOCLIENT_ACTIVATION_PARAMS as *mut u8,
    };
    let propvariant = ManuallyDrop::new(PROPVARIANT {
        Anonymous: PROPVARIANT_0 {
            Anonymous: ManuallyDrop::new(PROPVARIANT_0_0 {
                vt: VT_BLOB,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: PROPVARIANT_0_0_0 { blob },
            }),
        },
    });
    let _operation = unsafe {
        ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            &IAudioClient::IID,
            Some(&*propvariant),
            &completion,
        )
    }
    .map_err(|error| format!("failed to activate process loopback: {error}"))?;
    let (lock, cvar) = &*pair;
    let completed = lock
        .lock()
        .map_err(|_| "process loopback activation lock poisoned".to_string())?;
    let wait = cvar
        .wait_timeout_while(completed, Duration::from_secs(5), |state| !state.completed)
        .map_err(|_| "process loopback activation wait failed".to_string())?;
    let mut state = wait.0;
    if !state.completed {
        return Err("process loopback activation timed out".to_string());
    }
    let unknown = state
        .result
        .take()
        .unwrap_or_else(|| Err("process loopback activation returned no result".to_string()))?;
    unknown
        .cast::<IAudioClient>()
        .map_err(|error| format!("process loopback returned an unexpected interface: {error}"))
}

fn capture_format() -> WAVEFORMATEX {
    let block_align = CAPTURE_CHANNELS * (CAPTURE_BITS_PER_SAMPLE / 8);
    WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_PCM as u16,
        nChannels: CAPTURE_CHANNELS,
        nSamplesPerSec: CAPTURE_SAMPLE_RATE,
        nAvgBytesPerSec: CAPTURE_SAMPLE_RATE * block_align as u32,
        nBlockAlign: block_align,
        wBitsPerSample: CAPTURE_BITS_PER_SAMPLE,
        cbSize: 0,
    }
}

fn capture_process_loopback(pid: u32, stop: Arc<AtomicBool>) -> Result<(), String> {
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
        .ok()
        .map_err(|error| format!("failed to initialize COM: {error}"))?;
    let result = capture_process_loopback_inner(pid, stop);
    unsafe { CoUninitialize() };
    result
}

fn capture_process_loopback_inner(pid: u32, stop: Arc<AtomicBool>) -> Result<(), String> {
    let audio_client = activate_process_loopback(pid)?;
    let format = capture_format();
    let buffer_duration_hns = CAPTURE_BUFFER_MS * 10_000;
    unsafe {
        audio_client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
            buffer_duration_hns,
            0,
            &format,
            None,
        )
    }
    .map_err(|error| format!("failed to initialize process loopback stream: {error}"))?;
    let capture_client: IAudioCaptureClient = unsafe { audio_client.GetService() }
        .map_err(|error| format!("failed to open process loopback capture client: {error}"))?;
    unsafe { audio_client.Start() }
        .map_err(|error| format!("failed to start process loopback capture: {error}"))?;
    store_snapshot(levels_snapshot("silent", None, None, None));
    while !stop.load(Ordering::Relaxed) {
        read_capture_packets(&capture_client)?;
        thread::sleep(Duration::from_millis(10));
    }
    let _ = unsafe { audio_client.Stop() };
    Ok(())
}

fn read_capture_packets(capture_client: &IAudioCaptureClient) -> Result<(), String> {
    loop {
        let packet_frames = unsafe { capture_client.GetNextPacketSize() }
            .map_err(|error| format!("failed to read process loopback packet size: {error}"))?;
        if packet_frames == 0 {
            return Ok(());
        }
        let mut data = std::ptr::null_mut();
        let mut frames = 0;
        let mut flags = 0;
        unsafe { capture_client.GetBuffer(&mut data, &mut frames, &mut flags, None, None) }
            .map_err(|error| format!("failed to read process loopback buffer: {error}"))?;
        let bytes = frames as usize * CAPTURE_CHANNELS as usize * 2;
        let snapshot = if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null() {
            levels_snapshot("silent", None, None, None)
        } else {
            let buffer = unsafe { std::slice::from_raw_parts(data, bytes) };
            let samples = pcm_i16_to_f32(buffer);
            let (momentary_lufs, rms_db, peak_db) = levels_from_f32(&samples);
            if peak_db.is_none() {
                levels_snapshot("silent", None, None, None)
            } else {
                levels_snapshot("running", momentary_lufs, rms_db, peak_db)
            }
        };
        let release = unsafe { capture_client.ReleaseBuffer(frames) };
        store_snapshot(snapshot);
        release.map_err(|error| format!("failed to release process loopback buffer: {error}"))?;
    }
}

fn stop_runtime(runtime: AudioMeterRuntime) {
    runtime.stop.store(true, Ordering::Relaxed);
    if let Some(thread) = runtime.thread {
        let _ = thread.join();
    }
}

#[napi]
pub fn start_audio_meter(target: Option<String>) -> JsAudioMeterSnapshot {
    if let Some(build) = windows_build() {
        if build < MIN_PROCESS_LOOPBACK_BUILD {
            return unsupported_snapshot(format!(
                "WASAPI process loopback requires Windows build {MIN_PROCESS_LOOPBACK_BUILD} or newer; current build is {build}"
            ));
        }
    }
    let target = target.unwrap_or_else(|| DEFAULT_TARGET.to_string());
    let pid = match find_target_process_id(&target) {
        Ok(pid) => pid,
        Err(error) => return error_snapshot(error),
    };
    let mut state = match meter_state().lock() {
        Ok(state) => state,
        Err(_) => return error_snapshot("audio meter state lock poisoned".to_string()),
    };
    if let Some(runtime) = state.runtime.take() {
        drop(state);
        stop_runtime(runtime);
        state = match meter_state().lock() {
            Ok(state) => state,
            Err(_) => return error_snapshot("audio meter state lock poisoned".to_string()),
        };
    }
    let stop = Arc::new(AtomicBool::new(false));
    let capture_stop = Arc::clone(&stop);
    let thread = thread::spawn(move || {
        match catch_unwind(AssertUnwindSafe(|| {
            capture_process_loopback(pid, capture_stop)
        })) {
            Ok(Ok(())) => {}
            Ok(Err(error)) => store_snapshot(error_snapshot(error)),
            Err(_) => store_snapshot(error_snapshot(
                "process loopback capture panicked".to_string(),
            )),
        }
    });
    state.snapshot = starting_snapshot();
    state.runtime = Some(AudioMeterRuntime {
        stop,
        thread: Some(thread),
    });
    clone_snapshot(&state.snapshot)
}

#[napi]
pub fn stop_audio_meter() -> JsAudioMeterSnapshot {
    let runtime = match meter_state().lock() {
        Ok(mut state) => state.runtime.take(),
        Err(_) => return error_snapshot("audio meter state lock poisoned".to_string()),
    };
    if let Some(runtime) = runtime {
        stop_runtime(runtime);
    }
    let snapshot = idle_snapshot();
    store_snapshot(clone_snapshot(&snapshot));
    snapshot
}

#[napi]
pub fn read_audio_meter() -> JsAudioMeterSnapshot {
    match meter_state().lock() {
        Ok(state) => clone_snapshot(&state.snapshot),
        Err(_) => error_snapshot("audio meter state lock poisoned".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_are_empty_for_silence() {
        assert_eq!(levels_from_f32(&[]), (None, None, None));
        assert_eq!(levels_from_f32(&[0.0, 0.0]), (None, None, None));
    }

    #[test]
    fn levels_report_full_scale_peak() {
        let (_lufs, rms, peak) = levels_from_f32(&[1.0, -1.0]);
        assert!((peak.unwrap() - 0.0).abs() < 0.000001);
        assert!((rms.unwrap() - 0.0).abs() < 0.000001);
    }

    #[test]
    fn levels_report_lower_quiet_signal() {
        let (_lufs, rms, peak) = levels_from_f32(&[0.25, -0.25]);
        assert!((peak.unwrap() + 12.041199826559248).abs() < 0.000001);
        assert!((rms.unwrap() + 12.041199826559248).abs() < 0.000001);
    }
}
