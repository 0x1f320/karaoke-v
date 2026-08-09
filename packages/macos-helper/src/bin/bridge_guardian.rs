#![cfg(target_os = "macos")]

use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::{FileTypeExt, MetadataExt, OpenOptionsExt};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

const FIFO_LATE_OPEN_GRACE: Duration = Duration::from_millis(300);
const GRACE_POLL_INTERVAL: Duration = Duration::from_millis(10);
const RENDEZVOUS_BYTES: u64 = 128;

struct GuardedFifo {
    path: PathBuf,
    file: File,
    dev: u64,
    ino: u64,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("voxpane bridge guardian: {error}");
        std::process::exit(1);
    }
}

fn run() -> io::Result<()> {
    let args = env::args_os().skip(1).collect::<Vec<_>>();
    if args.len() != 6 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "expected control socket, rendezvous, app session, and three FIFO paths",
        ));
    }
    let control_path = PathBuf::from(&args[0]);
    let rendezvous = PathBuf::from(&args[1]);
    let session = args[2]
        .to_str()
        .filter(|value| valid_session(value))
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid app session"))?;
    let fifos = args[3..]
        .iter()
        .map(|path| open_fifo(Path::new(path)))
        .collect::<io::Result<Vec<_>>>()?;
    let mut control = UnixStream::connect(control_path)?;

    detach_from_launcher()?;
    control.write_all(b"READY\n")?;
    control.flush()?;
    wait_for_owner_eof(&mut control)?;

    withdraw_rendezvous(&rendezvous, session);
    drain_late_open_grace(&fifos)?;
    for fifo in &fifos {
        unlink_owned_fifo(fifo);
    }
    drain_until_writers_close(fifos)
}

fn valid_session(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn open_fifo(path: &Path) -> io::Result<GuardedFifo> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW)
        .open(path)?;
    let metadata = file.metadata()?;
    if !metadata.file_type().is_fifo() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("endpoint is not a FIFO: {}", path.display()),
        ));
    }
    Ok(GuardedFifo {
        path: path.to_path_buf(),
        file,
        dev: metadata.dev(),
        ino: metadata.ino(),
    })
}

fn detach_from_launcher() -> io::Result<()> {
    let launcher_pid = unsafe { libc::getpid() };
    let child_pid = unsafe { libc::fork() };
    if child_pid < 0 {
        return Err(io::Error::last_os_error());
    }
    if child_pid > 0 {
        unsafe { libc::_exit(0) }
    }
    if unsafe { libc::setsid() } < 0 {
        return Err(io::Error::last_os_error());
    }
    while unsafe { libc::getppid() } == launcher_pid {
        thread::sleep(Duration::from_millis(1));
    }
    Ok(())
}

fn wait_for_owner_eof(control: &mut UnixStream) -> io::Result<()> {
    let mut buffer = [0_u8; 64];
    loop {
        match control.read(&mut buffer) {
            Ok(0) => return Ok(()),
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
}

fn withdraw_rendezvous(path: &Path, session: &str) {
    let Ok(before) = fs::symlink_metadata(path) else {
        return;
    };
    if !before.is_file() || before.len() != RENDEZVOUS_BYTES {
        return;
    }
    let Ok(mut file) = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW)
        .open(path)
    else {
        return;
    };
    let Ok(opened) = file.metadata() else {
        return;
    };
    if !opened.is_file() || before.dev() != opened.dev() || before.ino() != opened.ino() {
        return;
    }
    let mut bytes = Vec::with_capacity(RENDEZVOUS_BYTES as usize + 1);
    if Read::take(&mut file, RENDEZVOUS_BYTES + 1)
        .read_to_end(&mut bytes)
        .is_err()
        || bytes.len() != RENDEZVOUS_BYTES as usize
        || rendezvous_session(&bytes) != Some(session)
    {
        return;
    }
    let Ok(current) = fs::symlink_metadata(path) else {
        return;
    };
    if current.is_file() && current.dev() == opened.dev() && current.ino() == opened.ino() {
        let _ = fs::remove_file(path);
    }
}

fn rendezvous_session(bytes: &[u8]) -> Option<&str> {
    let text = std::str::from_utf8(bytes).ok()?;
    let mut lines = text.lines();
    if lines.next()? != "VPR1" {
        return None;
    }
    lines.next()?;
    lines.next()
}

fn unlink_owned_fifo(fifo: &GuardedFifo) {
    let Ok(current) = fs::symlink_metadata(&fifo.path) else {
        return;
    };
    if current.file_type().is_fifo() && current.dev() == fifo.dev && current.ino() == fifo.ino {
        let _ = fs::remove_file(&fifo.path);
    }
}

fn drain_late_open_grace(fifos: &[GuardedFifo]) -> io::Result<()> {
    let deadline = Instant::now() + FIFO_LATE_OPEN_GRACE;
    loop {
        for fifo in fifos {
            drain_available(fifo.file.as_raw_fd(), false)?;
        }
        let now = Instant::now();
        if now >= deadline {
            return Ok(());
        }
        thread::sleep(GRACE_POLL_INTERVAL.min(deadline - now));
    }
}

fn drain_until_writers_close(fifos: Vec<GuardedFifo>) -> io::Result<()> {
    // Darwin poll can miss the continuation of a blocked write larger than the FIFO buffer.
    // A blocking reader per channel follows the kernel backpressure path until writer EOF.
    let drains = fifos
        .into_iter()
        .map(|fifo| thread::spawn(move || drain_blocking(fifo.file)))
        .collect::<Vec<_>>();
    for drain in drains {
        drain
            .join()
            .map_err(|_| io::Error::other("guardian drain thread panicked"))??;
    }
    Ok(())
}

fn drain_blocking(mut file: File) -> io::Result<()> {
    let fd = file.as_raw_fd();
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags & !libc::O_NONBLOCK) } < 0 {
        return Err(io::Error::last_os_error());
    }
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        match file.read(&mut buffer) {
            Ok(0) => return Ok(()),
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
}

fn drain_available(fd: libc::c_int, close_on_eof: bool) -> io::Result<bool> {
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = unsafe { libc::read(fd, buffer.as_mut_ptr().cast(), buffer.len()) };
        if read > 0 {
            continue;
        }
        if read == 0 {
            return Ok(close_on_eof);
        }
        let error = io::Error::last_os_error();
        if error.kind() == io::ErrorKind::Interrupted {
            continue;
        }
        if error.kind() == io::ErrorKind::WouldBlock {
            return Ok(false);
        }
        return Err(error);
    }
}
