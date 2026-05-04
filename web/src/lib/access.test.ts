import { describe, expect, it } from "vitest";

import { accessCapabilityState } from "./access";

describe("accessCapabilityState", () => {
  it("marks capabilities allowed from explicit permissions", () => {
    const state = accessCapabilityState(["bastion.request:write"]);

    expect(state.find((item) => item.id === "request")?.allowed).toBe(true);
    expect(state.find((item) => item.id === "approve")?.allowed).toBe(false);
  });

  it("allows every access capability for system admin", () => {
    expect(accessCapabilityState(["system:admin"]).every((item) => item.allowed)).toBe(true);
  });
});
