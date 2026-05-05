import { useEffect, useRef, useState } from "react";

import { buildTerminalWebSocketURL, loadXterm, type XtermFitAddon, type XtermTerminal } from "../../lib/terminal";

export type LiveSSHStatus = "connecting" | "connected" | "closed" | "disconnected" | "error";

type TerminalFrame = {
  code?: number;
  message?: string;
  payload?: string;
  type?: string;
};

type SshTerminalPaneProps = {
  active: boolean;
  assetID: string;
  assetName: string;
  onStatusChange: (sessionID: string, status: LiveSSHStatus, message?: string) => void;
  sessionID: string;
  ticket: string;
};

function frameFromMessage(data: unknown): TerminalFrame | null {
  if (typeof data !== "string") return null;

  try {
    return JSON.parse(data) as TerminalFrame;
  } catch {
    return null;
  }
}

export function SshTerminalPane({ active, assetID, assetName, onStatusChange, sessionID, ticket }: SshTerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const fitRef = useRef<XtermFitAddon | null>(null);
  const statusRef = useRef<LiveSSHStatus>("connecting");
  const terminalRef = useRef<XtermTerminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // Mirror the props through refs so the effect below can read the latest
  // values without needing them in its dependency list. The effect must NOT
  // tear down the live SSH socket just because the parent re-rendered with
  // a freshly-created callback or a renamed asset.
  const onStatusChangeRef = useRef(onStatusChange);
  const assetNameRef = useRef(assetName);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
    assetNameRef.current = assetName;
  }, [assetName, onStatusChange]);
  const [message, setMessage] = useState("Connecting");

  useEffect(() => {
    let disposed = false;
    let inputDisposable: { dispose: () => void } | null = null;
    let pingHandle = 0;

    function setStatus(status: LiveSSHStatus, nextMessage?: string) {
      statusRef.current = status;
      setMessage(nextMessage || status);
      onStatusChangeRef.current(sessionID, status, nextMessage);
    }

    function fitAndResize() {
      const fit = fitRef.current;
      const terminal = terminalRef.current;
      const ws = wsRef.current;
      if (!fit || !terminal) return;

      try {
        fit.fit();
      } catch {
        return;
      }

      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
      }
    }

    async function openTerminal() {
      try {
        const host = hostRef.current;
        if (!host) return;

        const { FitAddon, Terminal } = await loadXterm();
        if (disposed) return;

        const terminal = new Terminal({
          convertEol: true,
          cursorBlink: true,
          fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
          fontSize: 13,
          scrollback: 5000,
          theme: {
            background: "#000000",
            foreground: "#e7f0ec",
          },
        });
        const fit = new FitAddon();
        terminal.loadAddon(fit);
        terminal.open(host);
        terminalRef.current = terminal;
        fitRef.current = fit;
        terminal.write(`Connecting to ${assetNameRef.current || assetID}...\r\n`);

        const ws = new WebSocket(buildTerminalWebSocketURL(assetID, ticket));
        wsRef.current = ws;

        // Every WebSocket callback guards on `disposed` so that frames
        // queued in the browser between cleanup and the actual TCP close
        // do not write into a torn-down xterm or call setState/parent
        // callbacks for a tab the user already closed.
        ws.onopen = () => {
          if (disposed) return;
          terminal.write("\x1b[32mconnected\x1b[0m\r\n");
          setStatus("connected", "Connected");
          fitAndResize();
          terminal.focus();
        };

        ws.onmessage = (event) => {
          if (disposed) return;
          const frame = frameFromMessage(event.data);
          if (!frame) return;

          if (frame.type === "data") {
            terminal.write(frame.payload || "");
            return;
          }

          if (frame.type === "error") {
            const errorMessage = frame.message || "Terminal error.";
            terminal.write(`\r\n\x1b[31m[error] ${errorMessage}\x1b[0m\r\n`);
            setStatus("error", errorMessage);
            return;
          }

          if (frame.type === "exit") {
            const code = frame.code ?? 0;
            terminal.write(`\r\n\x1b[33m[session exited code=${code}]\x1b[0m\r\n`);
            setStatus("closed", `Exited with code ${code}`);
          }
        };

        ws.onerror = () => {
          if (disposed) return;
          setStatus("error", "WebSocket connection error");
        };

        ws.onclose = () => {
          if (disposed) return;
          if (statusRef.current !== "error" && statusRef.current !== "closed") {
            setStatus("disconnected", "Disconnected");
          }
        };

        inputDisposable = terminal.onData((data) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "data", payload: data }));
          }
        });

        window.addEventListener("resize", fitAndResize);
        pingHandle = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 30000);
        fitAndResize();
      } catch (error) {
        if (disposed) return;
        setStatus("error", error instanceof Error ? error.message : "Failed to open terminal.");
      }
    }

    setStatus("connecting", "Connecting");
    void openTerminal();

    return () => {
      disposed = true;
      window.removeEventListener("resize", fitAndResize);
      window.clearInterval(pingHandle);
      inputDisposable?.dispose();
      wsRef.current?.close();
      terminalRef.current?.dispose();
      wsRef.current = null;
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [assetID, sessionID, ticket]);

  useEffect(() => {
    if (!active) return;

    const handle = window.setTimeout(() => {
      try {
        fitRef.current?.fit();
        terminalRef.current?.focus();
      } catch {
        // Best-effort only: inactive tabs may not have measurable dimensions yet.
      }
    }, 0);

    return () => window.clearTimeout(handle);
  }, [active]);

  return (
    <div className="live-terminal-pane">
      <div ref={hostRef} className="live-terminal-host" />
      <div className={`live-terminal-status ${statusRef.current}`}>{message}</div>
    </div>
  );
}
