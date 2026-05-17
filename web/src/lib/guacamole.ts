type LocationLike = Pick<Location, "host" | "protocol">;

type GuacamoleDisplay = {
  getElement: () => HTMLElement;
  getScale: () => number;
};

export type GuacamoleMouseState = {
  down: boolean;
  left: boolean;
  middle: boolean;
  right: boolean;
  up: boolean;
  x: number;
  y: number;
};

export type GuacamoleMouse = {
  onmousedown: ((state: GuacamoleMouseState) => void) | null;
  onmousemove: ((state: GuacamoleMouseState) => void) | null;
  onmouseup: ((state: GuacamoleMouseState) => void) | null;
};

export type GuacamoleKeyboard = {
  onkeydown: ((keysym: number) => void) | null;
  onkeyup: ((keysym: number) => void) | null;
};

export type GuacamoleClient = {
  connect: (params: string) => void;
  disconnect: () => void;
  getDisplay: () => GuacamoleDisplay;
  onerror: ((error: { message?: string }) => void) | null;
  onstatechange: ((state: number) => void) | null;
  sendKeyEvent: (pressed: 0 | 1, keysym: number) => void;
  sendMouseState: (state: GuacamoleMouseState) => void;
};

// Guacamole.SessionRecording: in-browser player for a recorded server→client
// instruction stream. The vendored guacamole-common bundle accepts a Blob
// source directly and derives the timeline from the embedded `sync`
// instructions. Positions/durations are in milliseconds.
export type GuacamoleSessionRecording = {
  connect: (data?: string) => void;
  disconnect: () => void;
  getDisplay: () => GuacamoleDisplay;
  getDuration: () => number;
  getPosition: () => number;
  isPlaying: () => boolean;
  play: () => void;
  pause: () => void;
  seek: (position: number, callback?: () => void) => void;
  onload: (() => void) | null;
  onerror: ((message: string) => void) | null;
  onabort: (() => void) | null;
  onprogress: ((duration: number, current: number) => void) | null;
  onplay: (() => void) | null;
  onpause: (() => void) | null;
  onseek: ((position: number) => void) | null;
};

export type GuacamoleNamespace = {
  Client: new (tunnel: unknown) => GuacamoleClient;
  Keyboard: new (element: HTMLElement) => GuacamoleKeyboard;
  Mouse: new (element: HTMLElement) => GuacamoleMouse;
  WebSocketTunnel: new (url: string) => unknown;
  SessionRecording: new (source: Blob) => GuacamoleSessionRecording;
};

type GuacamoleWindow = Window &
  typeof globalThis & {
    Guacamole?: GuacamoleNamespace;
  };

export type RdpConnectionParams = {
  dpi: number;
  height: number;
  ticket: string;
  timezone: string;
  width: number;
};

let guacamoleLoadPromise: Promise<GuacamoleNamespace> | null = null;

export function guacamoleAssetPath(base = "/") {
  const prefix = base.endsWith("/") ? base : `${base}/`;

  return `${prefix}vendor/guacamole/guacamole-common.min.js`;
}

export function buildRdpWebSocketURL(
  assetID: string,
  ticket: string,
  locationLike: LocationLike = window.location,
) {
  // Mirroring the SSH terminal endpoint: the ticket goes in the URL query so
  // the backend can authenticate the WebSocket at handshake time and reject
  // bad tickets before the Guacamole tunnel is opened. The same ticket is
  // also included in the Guacamole connect parameters (see
  // buildRdpConnectionParams) for the in-band auth path; both layers
  // accepting the same value is intentional.
  const protocol = locationLike.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams({ ticket });

  return `${protocol}//${locationLike.host}/ws/v1/cmdb/assets/${encodeURIComponent(assetID)}/rdp?${params}`;
}

export function buildRdpConnectionParams(params: RdpConnectionParams) {
  return new URLSearchParams({
    dpi: String(params.dpi),
    height: String(params.height),
    ticket: params.ticket,
    timezone: params.timezone,
    width: String(params.width),
  }).toString();
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-guacamole-src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.dataset.guacamoleSrc = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export async function loadGuacamole(base = import.meta.env.BASE_URL || "/") {
  if (!guacamoleLoadPromise) {
    guacamoleLoadPromise = (async () => {
      await loadScript(guacamoleAssetPath(base));

      const guacamoleWindow = window as GuacamoleWindow;
      if (!guacamoleWindow.Guacamole) {
        throw new Error("Guacamole asset loaded but global client is missing.");
      }

      return guacamoleWindow.Guacamole;
    })();
  }

  return guacamoleLoadPromise;
}
