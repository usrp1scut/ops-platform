import { describe, expect, it } from "vitest";

import { buildTerminalWebSocketURL, terminalAssetPath } from "./terminal";

describe("terminalAssetPath", () => {
  it("respects Vite base paths", () => {
    expect(terminalAssetPath("xterm.js", "/portal/")).toBe("/portal/vendor/xterm/xterm.js");
    expect(terminalAssetPath("xterm.css", "/portal")).toBe("/portal/vendor/xterm/xterm.css");
  });
});

describe("buildTerminalWebSocketURL", () => {
  it("builds ws URLs for http pages", () => {
    expect(
      buildTerminalWebSocketURL("asset/one", "ticket one", {
        host: "localhost:8080",
        protocol: "http:",
      } as Location),
    ).toBe("ws://localhost:8080/ws/v1/cmdb/assets/asset%2Fone/terminal?ticket=ticket+one");
  });

  it("builds wss URLs for https pages", () => {
    expect(
      buildTerminalWebSocketURL("asset one", "ticket/one", {
        host: "ops.example.com",
        protocol: "https:",
      } as Location),
    ).toBe("wss://ops.example.com/ws/v1/cmdb/assets/asset%20one/terminal?ticket=ticket%2Fone");
  });
});
