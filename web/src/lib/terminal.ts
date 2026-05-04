type LocationLike = Pick<Location, "host" | "protocol">;

type Disposable = {
  dispose: () => void;
};

export type XtermTerminal = {
  cols: number;
  dispose: () => void;
  focus: () => void;
  loadAddon: (addon: XtermFitAddon) => void;
  onData: (handler: (data: string) => void) => Disposable;
  open: (element: HTMLElement) => void;
  reset: () => void;
  rows: number;
  write: (data: string) => void;
};

export type XtermFitAddon = {
  fit: () => void;
};

type XtermBundle = {
  FitAddon: new () => XtermFitAddon;
  Terminal: new (options: Record<string, unknown>) => XtermTerminal;
};

type XtermWindow = Window &
  typeof globalThis & {
    FitAddon?: {
      FitAddon: new () => XtermFitAddon;
    };
    Terminal?: new (options: Record<string, unknown>) => XtermTerminal;
  };

const xtermAssets = ["xterm.css", "xterm.js", "xterm-addon-fit.js"] as const;
type XtermAsset = (typeof xtermAssets)[number];

let xtermLoadPromise: Promise<XtermBundle> | null = null;

export function terminalAssetPath(asset: XtermAsset, base = "/") {
  const prefix = base.endsWith("/") ? base : `${base}/`;

  return `${prefix}vendor/xterm/${asset}`;
}

export function buildTerminalWebSocketURL(assetID: string, ticket: string, locationLike: LocationLike = window.location) {
  const protocol = locationLike.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams({ ticket });

  return `${protocol}//${locationLike.host}/ws/v1/cmdb/assets/${encodeURIComponent(assetID)}/terminal?${params}`;
}

function loadStyle(href: string) {
  if (document.querySelector(`link[data-xterm-href="${href}"]`)) return;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.xtermHref = href;
  document.head.appendChild(link);
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-xterm-src="${src}"]`);
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
    script.dataset.xtermSrc = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export async function loadXterm(base = import.meta.env.BASE_URL || "/") {
  if (!xtermLoadPromise) {
    xtermLoadPromise = (async () => {
      loadStyle(terminalAssetPath("xterm.css", base));
      await loadScript(terminalAssetPath("xterm.js", base));
      await loadScript(terminalAssetPath("xterm-addon-fit.js", base));

      const xtermWindow = window as XtermWindow;
      if (!xtermWindow.Terminal || !xtermWindow.FitAddon?.FitAddon) {
        throw new Error("Terminal assets loaded but xterm globals are missing.");
      }

      return {
        FitAddon: xtermWindow.FitAddon.FitAddon,
        Terminal: xtermWindow.Terminal,
      };
    })();
  }

  return xtermLoadPromise;
}
