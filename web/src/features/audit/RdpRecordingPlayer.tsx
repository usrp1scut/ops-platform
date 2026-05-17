import { useEffect, useRef, useState } from "react";

import { type GuacamoleSessionRecording, loadGuacamole } from "../../lib/guacamole";

function formatClock(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

type PlayerState = "loading" | "ready" | "error";

// RdpRecordingPlayer renders a recorded Guacamole RDP session (the
// server→client instruction stream) using the vendored
// Guacamole.SessionRecording player: play/pause/seek over the audited frames.
// No server-side transcoding — the recording file is itself the replayable
// protocol stream.
export function RdpRecordingPlayer({ blob }: { blob: Blob }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const recordingRef = useRef<GuacamoleSessionRecording | null>(null);
  const [state, setState] = useState<PlayerState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);

  useEffect(() => {
    let disposed = false;

    async function open() {
      try {
        const host = hostRef.current;
        if (!host) return;
        const Guacamole = await loadGuacamole();
        if (disposed) return;

        host.innerHTML = "";
        const scroll = document.createElement("div");
        scroll.className = "guacamole-scroll";
        host.appendChild(scroll);

        const recording = new Guacamole.SessionRecording(blob);
        recordingRef.current = recording;
        scroll.appendChild(recording.getDisplay().getElement());

        recording.onload = () => {
          if (disposed) return;
          setDuration(recording.getDuration());
          setState("ready");
        };
        recording.onerror = (message) => {
          if (disposed) return;
          setErrorMessage(message || "Failed to parse recording.");
          setState("error");
        };
        recording.onprogress = (total, current) => {
          if (disposed) return;
          setDuration(total);
          setPosition(current);
        };
        recording.onplay = () => !disposed && setPlaying(true);
        recording.onpause = () => !disposed && setPlaying(false);
        recording.onseek = (pos) => !disposed && setPosition(pos);

        recording.connect();
      } catch (error) {
        if (disposed) return;
        setErrorMessage(error instanceof Error ? error.message : "Failed to load player.");
        setState("error");
      }
    }

    void open();

    return () => {
      disposed = true;
      const recording = recordingRef.current;
      if (recording) {
        recording.onload = null;
        recording.onerror = null;
        recording.onabort = null;
        recording.onprogress = null;
        recording.onplay = null;
        recording.onpause = null;
        recording.onseek = null;
        if (recording.isPlaying()) recording.pause();
        recording.disconnect();
      }
      recordingRef.current = null;
      if (hostRef.current) hostRef.current.innerHTML = "";
    };
  }, [blob]);

  function togglePlay() {
    const recording = recordingRef.current;
    if (!recording || state !== "ready") return;
    if (recording.isPlaying()) {
      recording.pause();
    } else {
      recording.play();
    }
  }

  function onSeek(event: React.ChangeEvent<HTMLInputElement>) {
    const recording = recordingRef.current;
    if (!recording || state !== "ready") return;
    const next = Number(event.target.value);
    setPosition(next);
    recording.seek(next);
  }

  return (
    <div className="rdp-recording-player">
      {state === "loading" ? <p className="muted">Loading recording…</p> : null}
      {state === "error" ? <p className="inline-error">{errorMessage}</p> : null}
      <div ref={hostRef} className="live-rdp-host" hidden={state !== "ready"} />
      <div className="rdp-recording-controls">
        <button
          type="button"
          className="secondary-button compact"
          onClick={togglePlay}
          disabled={state !== "ready"}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          min={0}
          max={duration || 0}
          value={Math.min(position, duration || 0)}
          onChange={onSeek}
          disabled={state !== "ready" || duration <= 0}
          aria-label="Seek recording"
        />
        <span className="muted">
          {formatClock(position)} / {formatClock(duration)}
        </span>
      </div>
    </div>
  );
}
