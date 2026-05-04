import { describe, expect, it } from "vitest";

import { buildHostKeyOverridePath, buildHostKeyPath, buildSSHProxyPath } from "./connectivity";

describe("buildSSHProxyPath", () => {
  it("encodes proxy ids for detail endpoints", () => {
    expect(buildSSHProxyPath("proxy/one")).toBe("/api/v1/cmdb/ssh-proxies/proxy%2Fone");
  });
});

describe("host key endpoint builders", () => {
  it("encodes scope and target ids for delete endpoints", () => {
    expect(buildHostKeyPath("asset", "asset/one")).toBe("/api/v1/cmdb/hostkeys/asset/asset%2Fone");
  });

  it("builds override endpoints", () => {
    expect(buildHostKeyOverridePath("proxy", "proxy one")).toBe(
      "/api/v1/cmdb/hostkeys/proxy/proxy%20one/override",
    );
  });
});
