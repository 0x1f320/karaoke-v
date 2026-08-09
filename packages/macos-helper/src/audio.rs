use std::collections::VecDeque;
use std::ptr::NonNull;
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::Duration;

use block2::RcBlock;
use dispatch2::{DispatchQueue, DispatchQueueAttr, DispatchRetained};
use napi::bindgen_prelude::{AsyncTask, Env, Result as NapiResult, Task};
use objc2::define_class;
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::AnyThread;
use objc2_core_audio_types::{
    kAudioFormatFlagIsFloat, kAudioFormatFlagIsSignedInteger, kAudioFormatLinearPCM,
    kAudio_NoError, AudioBuffer, AudioBufferList, AudioStreamBasicDescription,
};
use objc2_core_foundation::CFRetained;
use objc2_core_media::{
    kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, CMAudioFormatDescription,
    CMAudioFormatDescriptionGetStreamBasicDescription, CMBlockBuffer, CMSampleBuffer,
};
use objc2_foundation::{NSArray, NSError, NSObject, NSObjectProtocol};
use objc2_screen_capture_kit::{
    SCContentFilter, SCDisplay, SCRunningApplication, SCShareableContent, SCStream,
    SCStreamConfiguration, SCStreamDelegate, SCStreamOutput, SCStreamOutputType,
};

use crate::clock::monotonic_now;
use crate::types::JsAudioMeterSnapshot;

const DEFAULT_TARGET: &str = "synthesizer";
const CAPTURE_SAMPLE_RATE: u32 = 48_000;
const CAPTURE_CHANNELS: u32 = 2;
const START_TIMEOUT: Duration = Duration::from_secs(8);
const STOP_TIMEOUT: Duration = Duration::from_secs(3);
const MOMENTARY_WINDOW_MS: u32 = 400;
const SHORT_TERM_WINDOW_MS: u32 = 3_000;

#[derive(Clone, Copy)]
struct MeterBlock {
    samples: usize,
    sum_squares: f64,
    peak: f64,
}

#[derive(Default)]
struct RollingAudioMeter {
    momentary: VecDeque<MeterBlock>,
    short_term: VecDeque<MeterBlock>,
    momentary_samples: usize,
    short_term_samples: usize,
    momentary_sum_squares: f64,
    short_term_sum_squares: f64,
    long_term_samples: usize,
    long_term_sum_squares: f64,
}

struct AudioMeterRuntime {
    stream: Retained<SCStream>,
    _delegate: Retained<AudioStreamDelegate>,
    output: Retained<AudioStreamOutput>,
    queue: DispatchRetained<DispatchQueue>,
}

unsafe impl Send for AudioMeterRuntime {}

struct AudioMeterState {
    snapshot: JsAudioMeterSnapshot,
    runtime: Option<AudioMeterRuntime>,
    meter: RollingAudioMeter,
}

static AUDIO_METER: OnceLock<Mutex<AudioMeterState>> = OnceLock::new();

fn meter_state() -> &'static Mutex<AudioMeterState> {
    AUDIO_METER.get_or_init(|| {
        Mutex::new(AudioMeterState {
            snapshot: idle_snapshot(),
            runtime: None,
            meter: RollingAudioMeter::default(),
        })
    })
}

fn clone_snapshot(snapshot: &JsAudioMeterSnapshot) -> JsAudioMeterSnapshot {
    JsAudioMeterSnapshot {
        state: snapshot.state.clone(),
        updated_at_ms: snapshot.updated_at_ms,
        momentary_lufs: snapshot.momentary_lufs,
        short_term_lufs: snapshot.short_term_lufs,
        long_term_lufs: snapshot.long_term_lufs,
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
        short_term_lufs: None,
        long_term_lufs: None,
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
        short_term_lufs: None,
        long_term_lufs: None,
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
        short_term_lufs: None,
        long_term_lufs: None,
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
        short_term_lufs: None,
        long_term_lufs: None,
        rms_db: None,
        peak_db: None,
        sample_rate: None,
        channels: None,
        error: Some(error),
    }
}

fn levels_snapshot(
    state: &str,
    levels: MeterLevels,
    sample_rate: u32,
    channels: u32,
) -> JsAudioMeterSnapshot {
    JsAudioMeterSnapshot {
        state: state.to_string(),
        updated_at_ms: monotonic_now(),
        momentary_lufs: levels.momentary_lufs,
        short_term_lufs: levels.short_term_lufs,
        long_term_lufs: levels.long_term_lufs,
        rms_db: levels.rms_db,
        peak_db: levels.peak_db,
        sample_rate: Some(sample_rate),
        channels: Some(channels),
        error: None,
    }
}

fn store_snapshot(snapshot: JsAudioMeterSnapshot) {
    if let Ok(mut state) = meter_state().lock() {
        state.snapshot = snapshot;
    }
}

fn store_sample_snapshot(samples: &[f32], sample_rate: u32, channels: u32) {
    if let Ok(mut state) = meter_state().lock() {
        let levels = state.meter.ingest(samples, sample_rate, channels);
        let snapshot_state = if levels.peak_db.is_none() {
            "silent"
        } else {
            "running"
        };
        state.snapshot = levels_snapshot(snapshot_state, levels, sample_rate, channels);
    }
}

fn store_silence_snapshot(sample_count: usize, sample_rate: u32, channels: u32) {
    if let Ok(mut state) = meter_state().lock() {
        let levels = state
            .meter
            .ingest_silence(sample_count, sample_rate, channels);
        state.snapshot = levels_snapshot("silent", levels, sample_rate, channels);
    }
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

fn lufs_from_mean_square(mean_square: f64) -> Option<f64> {
    amplitude_to_db(mean_square.sqrt()).map(|db| db - 0.691)
}

fn window_samples(sample_rate: u32, channels: u32, window_ms: u32) -> usize {
    let samples = sample_rate as u64 * channels.max(1) as u64 * window_ms.max(1) as u64 / 1_000;
    samples.max(channels.max(1) as u64) as usize
}

impl RollingAudioMeter {
    fn ingest(&mut self, samples: &[f32], sample_rate: u32, channels: u32) -> MeterLevels {
        let block = meter_block(samples);
        self.ingest_block(block, sample_rate, channels)
    }

    fn ingest_silence(
        &mut self,
        sample_count: usize,
        sample_rate: u32,
        channels: u32,
    ) -> MeterLevels {
        self.ingest_block(
            MeterBlock {
                samples: sample_count,
                sum_squares: 0.0,
                peak: 0.0,
            },
            sample_rate,
            channels,
        )
    }

    fn ingest_block(&mut self, block: MeterBlock, sample_rate: u32, channels: u32) -> MeterLevels {
        if block.samples == 0 {
            return MeterLevels::empty();
        }
        self.long_term_samples += block.samples;
        self.long_term_sum_squares += block.sum_squares;
        push_window(
            &mut self.momentary,
            &mut self.momentary_samples,
            &mut self.momentary_sum_squares,
            block,
            window_samples(sample_rate, channels, MOMENTARY_WINDOW_MS),
        );
        push_window(
            &mut self.short_term,
            &mut self.short_term_samples,
            &mut self.short_term_sum_squares,
            block,
            window_samples(sample_rate, channels, SHORT_TERM_WINDOW_MS),
        );
        MeterLevels {
            momentary_lufs: lufs_from_window(self.momentary_samples, self.momentary_sum_squares),
            short_term_lufs: lufs_from_window(self.short_term_samples, self.short_term_sum_squares),
            long_term_lufs: lufs_from_window(self.long_term_samples, self.long_term_sum_squares),
            rms_db: amplitude_to_db((block.sum_squares / block.samples as f64).sqrt()),
            peak_db: amplitude_to_db(block.peak),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct MeterLevels {
    momentary_lufs: Option<f64>,
    short_term_lufs: Option<f64>,
    long_term_lufs: Option<f64>,
    rms_db: Option<f64>,
    peak_db: Option<f64>,
}

impl MeterLevels {
    fn empty() -> Self {
        Self {
            momentary_lufs: None,
            short_term_lufs: None,
            long_term_lufs: None,
            rms_db: None,
            peak_db: None,
        }
    }
}

fn lufs_from_window(samples: usize, sum_squares: f64) -> Option<f64> {
    if samples == 0 {
        None
    } else {
        lufs_from_mean_square(sum_squares / samples as f64)
    }
}

fn meter_block(samples: &[f32]) -> MeterBlock {
    let mut peak: f64 = 0.0;
    let mut sum_squares = 0.0;
    for sample in samples {
        let clamped = clamp_sample(*sample);
        peak = peak.max(clamped.abs());
        sum_squares += clamped * clamped;
    }
    MeterBlock {
        samples: samples.len(),
        sum_squares,
        peak,
    }
}

fn push_window(
    window: &mut VecDeque<MeterBlock>,
    sample_count: &mut usize,
    sum_squares: &mut f64,
    block: MeterBlock,
    max_samples: usize,
) {
    window.push_back(block);
    *sample_count += block.samples;
    *sum_squares += block.sum_squares;
    while *sample_count > max_samples {
        let trim = *sample_count - max_samples;
        if let Some(front) = window.front_mut() {
            let remove = trim.min(front.samples);
            let ratio = remove as f64 / front.samples as f64;
            front.samples -= remove;
            front.sum_squares -= front.sum_squares * ratio;
            *sample_count -= remove;
            *sum_squares -= front.sum_squares * 0.0 + block.sum_squares * 0.0;
        }
        if matches!(window.front(), Some(front) if front.samples == 0) {
            window.pop_front();
        }
        *sum_squares = window.iter().map(|block| block.sum_squares).sum();
    }
}

#[cfg(test)]
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

fn extract_f32_samples(
    audio_buffer_list: *const AudioBufferList,
    format: &AudioStreamBasicDescription,
) -> Vec<f32> {
    if audio_buffer_list.is_null() || format.mFormatID != kAudioFormatLinearPCM {
        return Vec::new();
    }
    let is_float = format.mFormatFlags & kAudioFormatFlagIsFloat != 0;
    let is_i16 =
        format.mFormatFlags & kAudioFormatFlagIsSignedInteger != 0 && format.mBitsPerChannel == 16;
    let list = unsafe { &*audio_buffer_list };
    let count = list.mNumberBuffers as usize;
    let buffers = unsafe { std::slice::from_raw_parts(list.mBuffers.as_ptr(), count) };
    let mut samples = Vec::new();
    for buffer in buffers {
        collect_buffer_samples(buffer, format, is_float, is_i16, &mut samples);
    }
    samples
}

fn collect_buffer_samples(
    buffer: &AudioBuffer,
    format: &AudioStreamBasicDescription,
    is_float: bool,
    is_i16: bool,
    samples: &mut Vec<f32>,
) {
    if buffer.mData.is_null() || buffer.mDataByteSize == 0 {
        return;
    }
    let bytes = buffer.mDataByteSize as usize;
    if is_float && format.mBitsPerChannel == 32 {
        let values = unsafe { std::slice::from_raw_parts(buffer.mData as *const f32, bytes / 4) };
        samples.extend(values.iter().copied());
        return;
    }
    if is_i16 {
        let raw = unsafe { std::slice::from_raw_parts(buffer.mData as *const u8, bytes) };
        samples.extend(
            raw.chunks_exact(2)
                .map(|bytes| i16::from_le_bytes([bytes[0], bytes[1]]) as f32 / i16::MAX as f32),
        );
    }
}

fn handle_sample_buffer(sample_buffer: &CMSampleBuffer) -> Result<(), String> {
    let format_description = unsafe { sample_buffer.format_description() }
        .ok_or_else(|| "audio sample buffer has no format description".to_string())?;
    let format = format_description
        .downcast_ref::<CMAudioFormatDescription>()
        .ok_or_else(|| "audio sample buffer is not an audio format".to_string())?;
    let stream_description = unsafe { CMAudioFormatDescriptionGetStreamBasicDescription(format) };
    if stream_description.is_null() {
        return Err("audio sample buffer has no stream description".to_string());
    }
    let stream_description = unsafe { &*stream_description };
    let mut needed = 0usize;
    let mut block_buffer: *mut CMBlockBuffer = std::ptr::null_mut();
    let status = unsafe {
        sample_buffer.audio_buffer_list_with_retained_block_buffer(
            &mut needed,
            std::ptr::null_mut(),
            0,
            None,
            None,
            kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
            std::ptr::null_mut(),
        )
    };
    if status != kAudio_NoError || needed == 0 {
        return Err(format!("failed to size audio buffer list: {status}"));
    }
    let mut storage = vec![0u8; needed];
    let list = storage.as_mut_ptr() as *mut AudioBufferList;
    let status = unsafe {
        sample_buffer.audio_buffer_list_with_retained_block_buffer(
            std::ptr::null_mut(),
            list,
            needed,
            None,
            None,
            kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
            &mut block_buffer,
        )
    };
    if status != kAudio_NoError {
        return Err(format!("failed to read audio buffer list: {status}"));
    }
    let samples = extract_f32_samples(list, stream_description);
    let sample_rate = if stream_description.mSampleRate > 0.0 {
        stream_description.mSampleRate.round() as u32
    } else {
        CAPTURE_SAMPLE_RATE
    };
    let channels = stream_description.mChannelsPerFrame.max(1);
    if samples.is_empty() {
        store_silence_snapshot(0, sample_rate, channels);
    } else {
        store_sample_snapshot(&samples, sample_rate, channels);
    }
    if let Some(block_buffer) = NonNull::new(block_buffer) {
        unsafe {
            let _ = CFRetained::from_raw(block_buffer);
        }
    }
    Ok(())
}

#[derive(Default)]
struct AudioStreamOutputIvars;

define_class!(
    #[unsafe(super(NSObject))]
    #[ivars = AudioStreamOutputIvars]
    struct AudioStreamOutput;

    unsafe impl NSObjectProtocol for AudioStreamOutput {}

    unsafe impl SCStreamOutput for AudioStreamOutput {
        #[unsafe(method(stream:didOutputSampleBuffer:ofType:))]
        unsafe fn stream_did_output_sample_buffer_of_type(
            &self,
            _stream: &SCStream,
            sample_buffer: &CMSampleBuffer,
            r#type: SCStreamOutputType,
        ) {
            if r#type != SCStreamOutputType::Audio {
                return;
            }
            if let Err(error) = handle_sample_buffer(sample_buffer) {
                store_snapshot(error_snapshot(error));
            }
        }
    }
);

impl AudioStreamOutput {
    fn new() -> Retained<Self> {
        let this = Self::alloc().set_ivars(AudioStreamOutputIvars);
        unsafe { objc2::msg_send![super(this), init] }
    }
}

#[derive(Default)]
struct AudioStreamDelegateIvars;

define_class!(
    #[unsafe(super(NSObject))]
    #[ivars = AudioStreamDelegateIvars]
    struct AudioStreamDelegate;

    unsafe impl NSObjectProtocol for AudioStreamDelegate {}

    #[allow(non_snake_case)]
    unsafe impl SCStreamDelegate for AudioStreamDelegate {
        #[unsafe(method(stream:didStopWithError:))]
        unsafe fn stream_didStopWithError(&self, _stream: &SCStream, error: &NSError) {
            store_snapshot(error_snapshot(format!(
                "audio capture stopped: {}",
                error.localizedDescription()
            )));
        }
    }
);

impl AudioStreamDelegate {
    fn new() -> Retained<Self> {
        let this = Self::alloc().set_ivars(AudioStreamDelegateIvars);
        unsafe { objc2::msg_send![super(this), init] }
    }
}

fn ns_error_message(error: *mut NSError) -> Option<String> {
    NonNull::new(error).map(|error| unsafe {
        let retained = Retained::retain(error.as_ptr()).expect("NSError pointer should retain");
        retained.localizedDescription().to_string()
    })
}

type WaitPair<T> = Arc<(Mutex<Option<Result<T, String>>>, Condvar)>;

fn wait_for_shareable_content() -> Result<Retained<SCShareableContent>, String> {
    let pair: WaitPair<usize> = Arc::new((Mutex::new(None), Condvar::new()));
    let callback_pair = Arc::clone(&pair);
    let block = RcBlock::new(
        move |content: *mut SCShareableContent, error: *mut NSError| {
            let result = if let Some(message) = ns_error_message(error) {
                Err(message)
            } else if let Some(content) = NonNull::new(content) {
                let retained = unsafe {
                    Retained::retain(content.as_ptr())
                        .expect("SCShareableContent pointer should retain")
                };
                Ok(Retained::into_raw(retained) as usize)
            } else {
                Err("ScreenCaptureKit returned no shareable content".to_string())
            };
            let (lock, cvar) = &*callback_pair;
            if let Ok(mut state) = lock.lock() {
                *state = Some(result);
                cvar.notify_one();
            }
        },
    );
    unsafe {
        SCShareableContent::getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler(
            true, true, &block,
        );
    }
    wait_for_result(
        pair,
        START_TIMEOUT,
        "timed out reading ScreenCaptureKit content",
    )
    .and_then(|content| unsafe {
        Retained::from_raw(content as *mut SCShareableContent)
            .ok_or_else(|| "ScreenCaptureKit returned an invalid content pointer".to_string())
    })
}

fn wait_for_result<T>(
    pair: WaitPair<T>,
    timeout: Duration,
    timeout_message: &str,
) -> Result<T, String> {
    let (lock, cvar) = &*pair;
    let state = lock
        .lock()
        .map_err(|_| "ScreenCaptureKit wait lock poisoned".to_string())?;
    let mut state = cvar
        .wait_timeout_while(state, timeout, |state| state.is_none())
        .map_err(|_| "ScreenCaptureKit wait failed".to_string())?
        .0;
    state
        .take()
        .unwrap_or_else(|| Err(timeout_message.to_string()))
}

fn target_app(
    content: &SCShareableContent,
    target: &str,
) -> Option<Retained<SCRunningApplication>> {
    let needle = target.to_lowercase();
    let apps = unsafe { content.applications() };
    for app in apps.iter() {
        let name = unsafe { app.applicationName() }.to_string().to_lowercase();
        let bundle_id = unsafe { app.bundleIdentifier() }.to_string().to_lowercase();
        if name.contains(&needle) || bundle_id.contains(&needle) {
            return Some(app.clone());
        }
    }
    None
}

fn first_display(content: &SCShareableContent) -> Option<Retained<SCDisplay>> {
    unsafe { content.displays() }.iter().next()
}

fn start_capture(target: &str) -> Result<AudioMeterRuntime, String> {
    let content = wait_for_shareable_content()?;
    let app = target_app(&content, target)
        .ok_or_else(|| format!("target application not found: {target}"))?;
    let display =
        first_display(&content).ok_or_else(|| "no capturable display found".to_string())?;
    let included_apps = NSArray::from_retained_slice(&[app]);
    let excepting_windows = NSArray::new();
    let filter = unsafe {
        SCContentFilter::initWithDisplay_includingApplications_exceptingWindows(
            SCContentFilter::alloc(),
            &display,
            &included_apps,
            &excepting_windows,
        )
    };
    let config = unsafe { SCStreamConfiguration::new() };
    unsafe {
        config.setWidth(2);
        config.setHeight(2);
        config.setQueueDepth(1);
        config.setCapturesAudio(true);
        config.setExcludesCurrentProcessAudio(true);
        config.setSampleRate(CAPTURE_SAMPLE_RATE as isize);
        config.setChannelCount(CAPTURE_CHANNELS as isize);
    }
    let delegate = AudioStreamDelegate::new();
    let delegate_protocol = ProtocolObject::from_ref(&*delegate);
    let stream = unsafe {
        SCStream::initWithFilter_configuration_delegate(
            SCStream::alloc(),
            &filter,
            &config,
            Some(delegate_protocol),
        )
    };
    let output = AudioStreamOutput::new();
    let output_protocol = ProtocolObject::from_ref(&*output);
    let queue = DispatchQueue::new("sh.0x1f320.voxpane.audio-meter", DispatchQueueAttr::SERIAL);
    unsafe {
        stream
            .addStreamOutput_type_sampleHandlerQueue_error(
                output_protocol,
                SCStreamOutputType::Audio,
                Some(&queue),
            )
            .map_err(|error| error.localizedDescription().to_string())?;
    }
    wait_for_stream_start(&stream)?;
    Ok(AudioMeterRuntime {
        stream,
        _delegate: delegate,
        output,
        queue,
    })
}

fn wait_for_stream_start(stream: &SCStream) -> Result<(), String> {
    let pair = Arc::new((Mutex::new(None), Condvar::new()));
    let callback_pair = Arc::clone(&pair);
    let block = RcBlock::new(move |error: *mut NSError| {
        let result = ns_error_message(error).map_or(Ok(()), Err);
        let (lock, cvar) = &*callback_pair;
        if let Ok(mut state) = lock.lock() {
            *state = Some(result);
            cvar.notify_one();
        }
    });
    unsafe {
        stream.startCaptureWithCompletionHandler(Some(&block));
    }
    wait_for_result(
        pair,
        START_TIMEOUT,
        "timed out starting ScreenCaptureKit stream",
    )
}

fn wait_for_stream_stop(stream: &SCStream) {
    let pair = Arc::new((Mutex::new(None), Condvar::new()));
    let callback_pair = Arc::clone(&pair);
    let block = RcBlock::new(move |_error: *mut NSError| {
        let (lock, cvar) = &*callback_pair;
        if let Ok(mut state) = lock.lock() {
            *state = Some(Ok(()));
            cvar.notify_one();
        }
    });
    unsafe {
        stream.stopCaptureWithCompletionHandler(Some(&block));
    }
    let _ = wait_for_result(
        pair,
        STOP_TIMEOUT,
        "timed out stopping ScreenCaptureKit stream",
    );
}

fn stop_runtime(runtime: AudioMeterRuntime) {
    wait_for_stream_stop(&runtime.stream);
    let output_protocol = ProtocolObject::from_ref(&*runtime.output);
    let _ = unsafe {
        runtime
            .stream
            .removeStreamOutput_type_error(output_protocol, SCStreamOutputType::Audio)
    };
    drop(runtime.queue);
}

fn start_audio_meter_blocking(target: Option<String>) -> JsAudioMeterSnapshot {
    let target = target.unwrap_or_else(|| DEFAULT_TARGET.to_string());
    if !objc2::available!(macos = 13.0) {
        return unsupported_snapshot(
            "ScreenCaptureKit audio capture requires macOS 13 or newer".to_string(),
        );
    }
    if let Some(runtime) = match meter_state().lock() {
        Ok(mut state) => state.runtime.take(),
        Err(_) => return error_snapshot("audio meter state lock poisoned".to_string()),
    } {
        stop_runtime(runtime);
    }
    store_snapshot(starting_snapshot());
    match start_capture(&target) {
        Ok(runtime) => {
            if let Ok(mut state) = meter_state().lock() {
                state.runtime = Some(runtime);
                state.meter = RollingAudioMeter::default();
                state.snapshot = levels_snapshot(
                    "silent",
                    MeterLevels::empty(),
                    CAPTURE_SAMPLE_RATE,
                    CAPTURE_CHANNELS,
                );
                clone_snapshot(&state.snapshot)
            } else {
                error_snapshot("audio meter state lock poisoned".to_string())
            }
        }
        Err(error) => {
            let snapshot = error_snapshot(error);
            store_snapshot(clone_snapshot(&snapshot));
            snapshot
        }
    }
}

pub struct StartAudioMeterTask {
    target: Option<String>,
}

impl Task for StartAudioMeterTask {
    type Output = JsAudioMeterSnapshot;
    type JsValue = JsAudioMeterSnapshot;

    fn compute(&mut self) -> NapiResult<Self::Output> {
        Ok(start_audio_meter_blocking(self.target.clone()))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> NapiResult<Self::JsValue> {
        Ok(output)
    }
}

#[napi]
pub fn start_audio_meter(target: Option<String>) -> AsyncTask<StartAudioMeterTask> {
    AsyncTask::new(StartAudioMeterTask { target })
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
    use std::ffi::c_void;
    use std::mem::size_of;

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
    fn rolling_meter_separates_momentary_short_and_long_windows() {
        let mut meter = RollingAudioMeter::default();
        let loud = meter.ingest(&[1.0, -1.0, 1.0, -1.0], 10, 1);
        assert!((loud.momentary_lufs.unwrap() + 0.691).abs() < 0.000001);
        assert!((loud.short_term_lufs.unwrap() + 0.691).abs() < 0.000001);
        assert!((loud.long_term_lufs.unwrap() + 0.691).abs() < 0.000001);

        let decayed = meter.ingest_silence(26, 10, 1);
        assert_eq!(decayed.momentary_lufs, None);
        assert!(decayed.short_term_lufs.is_some());
        assert!(decayed.long_term_lufs.is_some());
        assert!(
            (decayed.short_term_lufs.unwrap() - decayed.long_term_lufs.unwrap()).abs() < 0.000001
        );

        let long_only = meter.ingest_silence(30, 10, 1);
        assert_eq!(long_only.momentary_lufs, None);
        assert_eq!(long_only.short_term_lufs, None);
        assert!(long_only.long_term_lufs.is_some());
    }

    #[test]
    fn extracts_interleaved_f32_samples() {
        let data = [0.25f32, -0.5, 1.0, 0.0];
        let buffer = AudioBuffer {
            mNumberChannels: 2,
            mDataByteSize: (data.len() * size_of::<f32>()) as u32,
            mData: data.as_ptr() as *mut c_void,
        };
        let list = AudioBufferList {
            mNumberBuffers: 1,
            mBuffers: [buffer],
        };
        let format = AudioStreamBasicDescription {
            mSampleRate: CAPTURE_SAMPLE_RATE as f64,
            mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kAudioFormatFlagIsFloat,
            mBytesPerPacket: 8,
            mFramesPerPacket: 1,
            mBytesPerFrame: 8,
            mChannelsPerFrame: 2,
            mBitsPerChannel: 32,
            mReserved: 0,
        };

        assert_eq!(extract_f32_samples(&list, &format), data);
    }
}
