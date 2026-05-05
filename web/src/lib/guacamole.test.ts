import { describe, expect, it } from "vitest";

import { buildRdpConnectionParams, buildRdpWebSocketURL, guacamoleAssetPath } from "./guacamole";

describe("guacamoleAssetPath", () => {
  it("respects Vite base paths", () => {
    expect(guacamoleAssetPath("/portal/")).toBe("/portal/vendor/guacamole/guacamole-common.min.js");
    expect(guacamoleAssetPath("/portal")).toBe("/portal/vendor/guacamole/guacamole-common.min.js");
  });
});

describe("buildRdpWebSocketURL", () => {
  it("builds ws URLs with ticket query for http pages", () => {
    expect(
      buildRdpWebSocketURL("asset/one", "ticket one", {
        host: "localhost:8080",
        protocol: "http:",
      } as Location),
    ).toBe("ws://localhost:8080/ws/v1/cmdb/assets/asset%2Fone/rdp?ticket=ticket+one");
  });

  it("builds wss URLs with ticket query for https pages", () => {
    expect(
      buildRdpWebSocketURL("asset one", "ticket/one", {
        host: "ops.example.com",
        protocol: "https:",
      } as Location),
    ).toBe("wss://ops.example.com/ws/v1/cmdb/assets/asset%20one/rdp?ticket=ticket%2Fone");
  });
});

describe("buildRdpConnectionParams", () => {
  it("serializes ticket and display parameters", () => {
    expect(
      buildRdpConnectionParams({
        dpi: 192,
        height: 768,
        ticket: "ticket/one",
        timezone: "Asia/Shanghai",
        width: 1024,
      }),
    ).toBe("dpi=192&height=768&ticket=ticket%2Fone&timezone=Asia%2FShanghai&width=1024");
  });
});
