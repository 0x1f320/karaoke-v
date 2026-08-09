#![cfg(target_os = "macos")]

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::Shutdown;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const SESSION: &str = "0123456789abcdef0123456789abcdef";
const OTHER_SESSION: &str = "fedcba9876543210fedcba9876543210";
static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(1);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "voxpane-bridge-guardian-{}-{nonce}-{}",
            std::process::id(),
            NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).expect("create test directory");
        Self(path)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn rendezvous_record(session: &str) -> Vec<u8> {
    let prefix = format!("VPR1\n0\n{session}\n00000000\n");
    let mut bytes = prefix.into_bytes();
    bytes.resize(128, b' ');
    bytes
}

fn make_fifo(path: &Path) {
    let status = Command::new("/usr/bin/mkfifo")
        .arg(path)
        .status()
        .expect("run mkfifo");
    assert!(status.success(), "mkfifo failed for {}", path.display());
}

fn control_path() -> PathBuf {
    PathBuf::from("/tmp").join(format!(
        "vbg-{}-{}.sock",
        std::process::id(),
        NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)
    ))
}

fn start_guardian(directory: &Path, session: &str) -> (UnixStream, PathBuf, [PathBuf; 3]) {
    let rendezvous = directory.join("pipe-session");
    fs::write(&rendezvous, rendezvous_record(session)).expect("write rendezvous");
    let fifos = ["state", "scroll", "notes"].map(|channel| {
        let path = directory.join(format!("pipe-{session}-{channel}"));
        make_fifo(&path);
        path
    });
    let control_path = control_path();
    let listener = UnixListener::bind(&control_path).expect("bind guardian control socket");
    let mut child = Command::new(env!("CARGO_BIN_EXE_voxpane-bridge-guardian"))
        .arg(&control_path)
        .arg(&rendezvous)
        .arg(session)
        .args(&fifos)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("start bridge guardian");
    let control = accept_control(&listener, &mut child);
    let mut ready = String::new();
    BufReader::new(control.try_clone().expect("clone control stream"))
        .read_line(&mut ready)
        .expect("read guardian readiness");
    if ready != "READY\n" {
        let mut stderr = String::new();
        child
            .stderr
            .take()
            .expect("guardian stderr")
            .read_to_string(&mut stderr)
            .expect("read guardian stderr");
        panic!("guardian did not become ready: {ready:?} {stderr}");
    }
    wait_for_exit(&mut child);
    drop(listener);
    fs::remove_file(control_path).expect("remove guardian control socket");
    control
        .set_read_timeout(Some(Duration::from_secs(3)))
        .expect("set control timeout");
    (control, rendezvous, fifos)
}

fn wait_for_exit(child: &mut Child) {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if let Some(status) = child.try_wait().expect("inspect guardian") {
            assert!(status.success(), "guardian exited with {status}");
            return;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            panic!("guardian did not exit after every writer closed");
        }
        thread::sleep(Duration::from_millis(10));
    }
}

fn accept_control(listener: &UnixListener, child: &mut Child) -> UnixStream {
    listener
        .set_nonblocking(true)
        .expect("set control listener nonblocking");
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                stream
                    .set_nonblocking(false)
                    .expect("set control stream blocking");
                return stream;
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(error) => panic!("accept guardian control connection: {error}"),
        }
        if let Some(status) = child.try_wait().expect("inspect guardian launcher") {
            let mut stderr = String::new();
            child
                .stderr
                .take()
                .expect("guardian stderr")
                .read_to_string(&mut stderr)
                .expect("read guardian stderr");
            panic!("guardian launcher exited before control connection: {status} {stderr}");
        }
        assert!(
            Instant::now() < deadline,
            "guardian did not connect to control socket"
        );
        thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn daemonizes_before_control_readiness_and_survives_launcher_exit() {
    let directory = TestDirectory::new();
    let (mut control, rendezvous, fifos) = start_guardian(&directory.0, SESSION);

    let mut writer = OpenOptions::new()
        .write(true)
        .open(&fifos[0])
        .expect("open FIFO writer after launcher exit");
    control
        .shutdown(Shutdown::Write)
        .expect("close guardian owner control");
    writer
        .write_all(&vec![0x5a; 256 * 1024])
        .expect("orphaned guardian drains writer");
    drop(writer);
    let mut drained = Vec::new();
    control
        .read_to_end(&mut drained)
        .expect("guardian closes control socket after draining");

    assert!(!rendezvous.exists());
    assert!(fifos.iter().all(|path| !path.exists()));
}

#[test]
fn stays_dormant_until_owner_eof_then_drains_existing_writers() {
    let directory = TestDirectory::new();
    let (mut control, rendezvous, fifos) = start_guardian(&directory.0, SESSION);
    let mut writer = OpenOptions::new()
        .write(true)
        .open(&fifos[0])
        .expect("open FIFO writer");
    let mut app_reader = OpenOptions::new()
        .read(true)
        .open(&fifos[0])
        .expect("open app FIFO reader");

    writer.write_all(b"app-data").expect("write app data");
    let mut received = [0_u8; 8];
    app_reader
        .read_exact(&mut received)
        .expect("app reader receives data");
    assert_eq!(&received, b"app-data");

    drop(app_reader);
    control
        .shutdown(Shutdown::Write)
        .expect("close guardian owner control");
    writer
        .write_all(&vec![0x5a; 256 * 1024])
        .expect("guardian drains beyond FIFO capacity");
    drop(writer);
    let mut drained = Vec::new();
    control
        .read_to_end(&mut drained)
        .expect("guardian closes control socket after draining");

    assert!(!rendezvous.exists());
    assert!(fifos.iter().all(|path| !path.exists()));
}

#[test]
fn preserves_replacement_rendezvous_and_endpoint_nodes() {
    let directory = TestDirectory::new();
    let (mut control, rendezvous, fifos) = start_guardian(&directory.0, SESSION);

    fs::remove_file(&rendezvous).expect("remove old rendezvous");
    let replacement = rendezvous_record(OTHER_SESSION);
    fs::write(&rendezvous, &replacement).expect("write replacement rendezvous");
    fs::remove_file(&fifos[0]).expect("remove old FIFO path");
    File::create(&fifos[0]).expect("create endpoint replacement");

    control
        .shutdown(Shutdown::Write)
        .expect("close guardian owner control");
    let mut drained = Vec::new();
    control
        .read_to_end(&mut drained)
        .expect("guardian closes control socket after draining");

    assert_eq!(
        fs::read(&rendezvous).expect("read replacement"),
        replacement
    );
    assert!(fs::metadata(&fifos[0])
        .expect("replacement endpoint")
        .is_file());
    assert!(!fifos[1].exists());
    assert!(!fifos[2].exists());
}
