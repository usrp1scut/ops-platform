import { describe, expect, it } from "vitest";

import { buildSSHProxyPath } from "./connectivity";

describe("buildSSHProxyPath", () => {
  it("encodes proxy ids for detail endpoints", () => {
    expect(buildSSHProxyPath("proxy/one")).toBe("/api/v1/cmdb/ssh-proxies/proxy%2Fone");
  });
});
