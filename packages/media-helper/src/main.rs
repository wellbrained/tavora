// Tavora's media helper (the Media connector, apps/desktop/src/main/media.ts). It reads Windows' media sessions, the
// ones the volume flyout shows, and passes play/pause, next and previous on. It talks JSON lines over stdio:
//
//   to Tavora:   {"type":"ready"}
//                {"type":"sessions","sessions":[Session…]}    after every change, at most every 150 ms
//                {"type":"cover","id":…,"key":…,"mime":…,"data":<base64>}    once per song, after its sessions line
//                {"type":"result","req":n,"ok":bool}
//                {"type":"error","message":…}
//   from Tavora: {"req":n,"cmd":"control","id":<session id>,"action":"playPause"|"next"|"previous"}
//
// It waits for Windows' change events and never polls. It ends when Tavora closes its input.
#![cfg_attr(windows, windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Session {
    id: String,
    app: String,
    current: bool,
    title: String,
    artist: String,
    album: String,
    status: &'static str,
    position_ms: Option<i64>,
    position_at: Option<i64>,
    duration_ms: Option<i64>,
    can_play_pause: bool,
    can_next: bool,
    can_previous: bool,
    /// Changes with the song; the cover line with the same key follows when there is one.
    cover_key: Option<String>,
}

#[derive(Deserialize)]
struct Command {
    req: u64,
    cmd: String,
    id: String,
    action: String,
}

/// The most of a cover Tavora takes; anything bigger is left out.
const MAX_COVER_BYTES: u32 = 8 * 1024 * 1024;
/// A position that moved by less than this from where it would be anyway is no change worth telling.
const POSITION_SLACK_MS: i64 = 1500;

fn send(line: &serde_json::Value) {
    use std::io::Write;
    let mut out = std::io::stdout().lock();
    if writeln!(out, "{line}").and_then(|_| out.flush()).is_err() {
        // Tavora went away.
        std::process::exit(0);
    }
}

fn base64(bytes: &[u8]) -> String {
    const ABC: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
        out.push(ABC[(n >> 18) as usize & 63] as char);
        out.push(ABC[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { ABC[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { ABC[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Whether two lists differ in anything but a position that runs on as expected.
fn changed(before: &[Session], after: &[Session]) -> bool {
    if before.len() != after.len() {
        return true;
    }
    before.iter().zip(after).any(|(a, b)| {
        let mut same = a.clone();
        same.position_ms = b.position_ms;
        same.position_at = b.position_at;
        if same != *b {
            return true;
        }
        match (a.position_ms, a.position_at, b.position_ms, b.position_at) {
            (Some(pa), Some(ta), Some(pb), Some(tb)) => {
                let expected = if a.status == "playing" { pa + (tb - ta) } else { pa };
                (expected - pb).abs() > POSITION_SLACK_MS
            }
            (None, _, None, _) => false,
            _ => true,
        }
    })
}

#[cfg(not(windows))]
fn main() {
    send(&serde_json::json!({ "type": "error", "message": "unsupported" }));
}

#[cfg(windows)]
fn main() {
    if let Err(error) = windows_media::run() {
        send(&serde_json::json!({ "type": "error", "message": error.message() }));
        std::process::exit(1);
    }
}

#[cfg(windows)]
mod windows_media {
    use super::*;
    use std::collections::HashMap;
    use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
    use std::time::{Duration, Instant};
    use windows::core::{Result, HSTRING};
    use windows::Foundation::TypedEventHandler;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as WinSession, GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::DataReader;
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

    /// How long the helper waits for more events before it reads again, so a burst of them is read once.
    const SETTLE: Duration = Duration::from_millis(150);
    /// 100 ns ticks between 1601 (Windows' DateTime) and 1970.
    const EPOCH_TICKS: i64 = 116_444_736_000_000_000;

    enum Msg {
        /// Sessions came or went: listen to the new ones.
        Sessions,
        /// Something in a session changed.
        Changed,
        Command(Command),
    }

    struct Tracked {
        id: String,
        session: WinSession,
        tokens: [i64; 3],
        /// The song whose cover went out last.
        cover_sent: Option<String>,
    }

    impl Drop for Tracked {
        fn drop(&mut self) {
            let _ = self.session.RemoveMediaPropertiesChanged(self.tokens[0]);
            let _ = self.session.RemovePlaybackInfoChanged(self.tokens[1]);
            let _ = self.session.RemoveTimelinePropertiesChanged(self.tokens[2]);
        }
    }

    pub fn run() -> Result<()> {
        unsafe { RoInitialize(RO_INIT_MULTITHREADED)? };
        let manager = Manager::RequestAsync()?.get()?;
        let (tx, rx) = channel::<Msg>();

        let on_sessions = tx.clone();
        let sessions_token = manager.SessionsChanged(&TypedEventHandler::new(move |_, _| {
            let _ = on_sessions.send(Msg::Sessions);
            Ok(())
        }))?;
        let on_current = tx.clone();
        let current_token = manager.CurrentSessionChanged(&TypedEventHandler::new(move |_, _| {
            let _ = on_current.send(Msg::Changed);
            Ok(())
        }))?;

        let commands = tx.clone();
        std::thread::spawn(move || {
            for line in std::io::stdin().lines() {
                let Ok(line) = line else { break };
                if let Ok(command) = serde_json::from_str::<Command>(&line) {
                    let _ = commands.send(Msg::Command(command));
                }
            }
            // Tavora closed the input: end.
            std::process::exit(0);
        });

        send(&serde_json::json!({ "type": "ready" }));
        let mut tracked: Vec<Tracked> = Vec::new();
        let mut last: Vec<Session> = Vec::new();
        let mut first = true;
        let mut resubscribe = true;
        let mut due: Option<Instant> = Some(Instant::now());

        loop {
            let wait = due.map(|at| at.saturating_duration_since(Instant::now())).unwrap_or(Duration::from_secs(3600));
            match rx.recv_timeout(wait) {
                Ok(Msg::Sessions) => {
                    resubscribe = true;
                    due.get_or_insert_with(|| Instant::now() + SETTLE);
                }
                Ok(Msg::Changed) => {
                    due.get_or_insert_with(|| Instant::now() + SETTLE);
                }
                Ok(Msg::Command(command)) => {
                    let ok = command.cmd == "control" && control(&tracked, &command.id, &command.action);
                    send(&serde_json::json!({ "type": "result", "req": command.req, "ok": ok }));
                }
                Err(RecvTimeoutError::Timeout) => {
                    due = None;
                    if resubscribe {
                        resubscribe = false;
                        tracked = subscribe(&manager, &tx, tracked)?;
                    }
                    let current = manager.GetCurrentSession().ok().and_then(|s| s.SourceAppUserModelId().ok());
                    let sessions: Vec<Session> = tracked.iter().map(|t| read(t, current.as_ref())).collect();
                    if first || changed(&last, &sessions) {
                        first = false;
                        send(&serde_json::json!({ "type": "sessions", "sessions": sessions }));
                    }
                    for (t, s) in tracked.iter_mut().zip(&sessions) {
                        if s.cover_key.is_some() && t.cover_sent != s.cover_key {
                            t.cover_sent = s.cover_key.clone();
                            send_cover(t, s);
                        }
                    }
                    last = sessions;
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
        let _ = manager.RemoveSessionsChanged(sessions_token);
        let _ = manager.RemoveCurrentSessionChanged(current_token);
        Ok(())
    }

    /// Listens to every session there is now, keeping the ones already listened to (by app and position in the list).
    fn subscribe(manager: &Manager, tx: &Sender<Msg>, before: Vec<Tracked>) -> Result<Vec<Tracked>> {
        let mut old: HashMap<String, Tracked> = before.into_iter().map(|t| (t.id.clone(), t)).collect();
        let mut seen: HashMap<String, u32> = HashMap::new();
        let mut now = Vec::new();
        for session in manager.GetSessions()? {
            let app = session.SourceAppUserModelId().map(|s| s.to_string()).unwrap_or_default();
            let n = seen.entry(app.clone()).or_insert(0);
            let id = format!("{app}#{n}");
            *n += 1;
            if let Some(t) = old.remove(&id) {
                now.push(t);
                continue;
            }
            let handler = |tx: &Sender<Msg>| {
                let tx = tx.clone();
                move || {
                    let _ = tx.send(Msg::Changed);
                }
            };
            let (a, b, c) = (handler(tx), handler(tx), handler(tx));
            let tokens = [
                session.MediaPropertiesChanged(&TypedEventHandler::new(move |_, _| Ok(a())))?,
                session.PlaybackInfoChanged(&TypedEventHandler::new(move |_, _| Ok(b())))?,
                session.TimelinePropertiesChanged(&TypedEventHandler::new(move |_, _| Ok(c())))?,
            ];
            now.push(Tracked { id, session, tokens, cover_sent: None });
        }
        Ok(now)
    }

    fn read(t: &Tracked, current: Option<&HSTRING>) -> Session {
        let s = &t.session;
        let app = s.SourceAppUserModelId().map(|a| a.to_string()).unwrap_or_default();
        let props = s.TryGetMediaPropertiesAsync().and_then(|op| op.get()).ok();
        let text = |f: &dyn Fn(&windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties) -> Result<HSTRING>| {
            props.as_ref().and_then(|p| f(p).ok()).map(|h| h.to_string()).unwrap_or_default()
        };
        let title = text(&|p| p.Title());
        let artist = text(&|p| p.Artist());
        let album = text(&|p| p.AlbumTitle());
        let has_cover = props.as_ref().is_some_and(|p| p.Thumbnail().is_ok());
        let info = s.GetPlaybackInfo().ok();
        let status = match info.as_ref().and_then(|i| i.PlaybackStatus().ok()) {
            Some(Status::Playing) => "playing",
            Some(Status::Paused) => "paused",
            Some(Status::Stopped) => "stopped",
            Some(Status::Changing) => "changing",
            _ => "closed",
        };
        let controls = info.as_ref().and_then(|i| i.Controls().ok());
        let can = |f: &dyn Fn(&windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackControls) -> Result<bool>| {
            controls.as_ref().and_then(|c| f(c).ok()).unwrap_or(false)
        };
        let (mut position_ms, mut position_at, mut duration_ms) = (None, None, None);
        if let Ok(timeline) = s.GetTimelineProperties() {
            let start = timeline.StartTime().map(|t| t.Duration).unwrap_or(0);
            let end = timeline.EndTime().map(|t| t.Duration).unwrap_or(0);
            if end > start {
                duration_ms = Some((end - start) / 10_000);
                position_ms = timeline.Position().ok().map(|p| ((p.Duration - start) / 10_000).max(0));
                let now = (std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)) as i64;
                let updated = timeline.LastUpdatedTime().map(|t| (t.UniversalTime - EPOCH_TICKS) / 10_000).unwrap_or(0);
                // Some players leave the time empty or set it ahead; then the position counts from now.
                position_at = Some(if updated <= 0 || updated > now { now } else { updated });
            }
        }
        let cover_key = has_cover.then(|| format!("{title}\u{1f}{artist}\u{1f}{album}"));
        Session {
            current: current.is_some_and(|c| c.to_string() == app) && t.id.ends_with("#0"),
            id: t.id.clone(),
            app,
            title,
            artist,
            album,
            status,
            position_ms,
            position_at,
            duration_ms,
            can_play_pause: can(&|c| c.IsPlayPauseToggleEnabled()),
            can_next: can(&|c| c.IsNextEnabled()),
            can_previous: can(&|c| c.IsPreviousEnabled()),
            cover_key,
        }
    }

    fn send_cover(t: &Tracked, s: &Session) {
        let bytes = (|| -> Result<(String, Vec<u8>)> {
            let props = t.session.TryGetMediaPropertiesAsync()?.get()?;
            let stream = props.Thumbnail()?.OpenReadAsync()?.get()?;
            let size = stream.Size()?;
            if size == 0 || size > MAX_COVER_BYTES as u64 {
                return Ok((String::new(), Vec::new()));
            }
            let mime = stream.ContentType().map(|c| c.to_string()).unwrap_or_default();
            let reader = DataReader::CreateDataReader(&stream)?;
            let n = reader.LoadAsync(size as u32)?.get()?;
            let mut buf = vec![0u8; n as usize];
            reader.ReadBytes(&mut buf)?;
            Ok((mime, buf))
        })();
        if let Ok((mime, data)) = bytes {
            if !data.is_empty() {
                send(&serde_json::json!({ "type": "cover", "id": s.id, "key": s.cover_key, "mime": mime, "data": base64(&data) }));
            }
        }
    }

    fn control(tracked: &[Tracked], id: &str, action: &str) -> bool {
        let Some(t) = tracked.iter().find(|t| t.id == id) else { return false };
        let s = &t.session;
        let op = match action {
            "playPause" => s.TryTogglePlayPauseAsync(),
            "next" => s.TrySkipNextAsync(),
            "previous" => s.TrySkipPreviousAsync(),
            _ => return false,
        };
        op.and_then(|op| op.get()).unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(status: &'static str, position_ms: i64, position_at: i64) -> Session {
        Session {
            id: "Spotify.exe#0".into(),
            app: "Spotify.exe".into(),
            current: true,
            title: "Song".into(),
            artist: "Artist".into(),
            album: "Album".into(),
            status,
            position_ms: Some(position_ms),
            position_at: Some(position_at),
            duration_ms: Some(200_000),
            can_play_pause: true,
            can_next: true,
            can_previous: true,
            cover_key: None,
        }
    }

    #[test]
    fn base64_matches_the_standard() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn a_position_running_on_is_no_change() {
        let a = session("playing", 10_000, 1_000_000);
        assert!(!changed(&[a.clone()], &[session("playing", 15_000, 1_005_000)]));
        assert!(!changed(&[a.clone()], &[session("playing", 15_900, 1_005_000)]));
        assert!(changed(&[a.clone()], &[session("playing", 60_000, 1_005_000)]));
        assert!(changed(&[a], &[session("paused", 15_000, 1_005_000)]));
    }

    #[test]
    fn a_paused_position_stays() {
        let a = session("paused", 10_000, 1_000_000);
        assert!(!changed(&[a.clone()], &[session("paused", 10_000, 1_009_000)]));
        assert!(changed(&[a], &[session("paused", 30_000, 1_009_000)]));
    }
}
