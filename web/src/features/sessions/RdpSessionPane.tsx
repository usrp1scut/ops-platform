import { useEffect, useRef, useState } from "react";

import {
  buildRdpConnectionParams,
  buildRdpWebSocketURL,
  loadGuacamole,
  type GuacamoleClient,
  type GuacamoleKeyboard,
  type GuacamoleMouse,
  type GuacamoleMouseState,
} from "../../lib/guacamole";

export type LiveRDPStatus = "connecting" | "connected" | "closed" | "disconnected" | "error";

type RdpSessionPaneProps = {
  active: boolean;
  assetID: string;
  assetName: string;
  onStatusChange: (sessionID: string, status: LiveRDPStatus, message?: string) => void;
  sessionID: string;
  ticket: string;
};

function displaySize(element: HTMLElement) {
  const rect = element.getBoundingClientRect();

  return {
    height: Math.max(600, Math.floor(rect.height || 720)),
    width: Math.max(800, Math.floor(rect.width || 1024)),
  };
}

function timezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function RdpSessionPane({ active, assetID, assetName, onStatusChange, sessionID, ticket }: RdpSessionPaneProps) {
  const clientRef = useRef<GuacamoleClient | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const keyboardRef = useRef<GuacamoleKeyboard | null>(null);
  const mouseRef = useRef<GuacamoleMouse | null>(null);
  const statusRef = useRef<LiveRDPStatus>("connecting");
  // Mirror the props through refs so the effect below can read the latest
  // values without needing them in its dependency list. The effect must NOT
  // tear down the live RDP tunnel just because the parent re-rendered with
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

    function setStatus(status: LiveRDPStatus, nextMessage?: string) {
      statusRef.current = status;
      setMessage(nextMessage || status);
      onStatusChangeRef.current(sessionID, status, nextMessage);
    }

    async function openRdp() {
      try {
        const host = hostRef.current;
        if (!host) return;

        const Guacamole = await loadGuacamole();
        if (disposed) return;

        host.innerHTML = "";
        host.tabIndex = 0;
        const scroll = document.createElement("div");
        scroll.className = "guacamole-scroll";
        host.appendChild(scroll);

        const { height, width } = displaySize(host);
        const dpi = Math.round((window.devicePixelRatio || 1) * 96);
        const tunnel = new Guacamole.WebSocketTunnel(buildRdpWebSocketURL(assetID, ticket));
        const client = new Guacamole.Client(tunnel);
        const display = client.getDisplay();
        scroll.appendChild(display.getElement());
        clientRef.current = client;

        // Both Guacamole callbacks guard on `disposed`. The cleanup below
        // calls client.disconnect() which itself drives the client into
        // state 5 (DISCONNECTED) and may also raise onerror — without
        // these guards we'd setMessage / call onStatusChangeRef on a tab
        // that the user has already closed.
        client.onstatechange = (state) => {
          if (disposed) return;
          if (state === 3) {
            setStatus("connected", "Connected");
            return;
          }
          if (state === 5 && statusRef.current !== "error") {
            setStatus("disconnected", "Disconnected");
          }
        };

        client.onerror = (error) => {
          if (disposed) return;
          setStatus("error", error?.message || "RDP connection error");
        };

        const params = buildRdpConnectionParams({
          dpi,
          height,
          ticket,
          timezone: timezone(),
          width,
        });
        client.connect(params);

        const mouse = new Guacamole.Mouse(scroll);
        mouse.onmousedown = mouse.onmouseup = mouse.onmousemove = (mouseState: GuacamoleMouseState) => {
          const scale = display.getScale() || 1;
          client.sendMouseState({
            ...mouseState,
            x: mouseState.x / scale,
            y: mouseState.y / scale,
          });
        };
        mouseRef.current = mouse;

        const keyboard = new Guacamole.Keyboard(host);
        keyboard.onkeydown = (keysym) => client.sendKeyEvent(1, keysym);
        keyboard.onkeyup = (keysym) => client.sendKeyEvent(0, keysym);
        keyboardRef.current = keyboard;

        host.addEventListener("mousedown", () => {
          try {
            host.focus();
          } catch {
            // Focusing the RDP mount is best-effort.
          }
        });
        host.focus();
        setMessage(`Connecting to ${assetNameRef.current || assetID}`);
      } catch (error) {
        setStatus("error", error instanceof Error ? error.message : "Failed to open RDP.");
      }
    }

    setStatus("connecting", "Connecting");
    void openRdp();

    return () => {
      disposed = true;
      if (keyboardRef.current) {
        keyboardRef.current.onkeydown = null;
        keyboardRef.current.onkeyup = null;
      }
      if (mouseRef.current) {
        mouseRef.current.onmousedown = null;
        mouseRef.current.onmousemove = null;
        mouseRef.current.onmouseup = null;
      }
      clientRef.current?.disconnect();
      clientRef.current = null;
      keyboardRef.current = null;
      mouseRef.current = null;
      if (hostRef.current) hostRef.current.innerHTML = "";
    };
  }, [assetID, sessionID, ticket]);

  useEffect(() => {
    if (!active) return;

    const handle = window.setTimeout(() => {
      try {
        hostRef.current?.focus();
      } catch {
        // Best-effort only.
      }
    }, 0);

    return () => window.clearTimeout(handle);
  }, [active]);

  return (
    <div className="live-rdp-pane">
      <div ref={hostRef} className="live-rdp-host" />
      <div className={`live-terminal-status ${statusRef.current}`}>{message}</div>
    </div>
  );
}
