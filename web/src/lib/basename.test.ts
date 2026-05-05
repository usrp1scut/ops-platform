import { describe, expect, it } from "vitest";

import { appBasename, fullPath } from "./basename";

describe("appBasename", () => {
  it("returns an empty string when the app is mounted at the document root", () => {
    expect(appBasename("/")).toBe("");
  });

  it("strips a trailing slash for sub-path mounts", () => {
    expect(appBasename("/portal/")).toBe("/portal");
  });

  it("collapses repeated trailing slashes", () => {
    expect(appBasename("/portal//")).toBe("/portal");
  });

  it("leaves a slashless mount untouched", () => {
    expect(appBasename("/portal")).toBe("/portal");
  });
});

describe("fullPath", () => {
  it("returns the base URL itself when the router is at /", () => {
    expect(fullPath("/", "/")).toBe("/");
    expect(fullPath("/", "/portal/")).toBe("/portal/");
  });

  it("falls back to / when both inputs are empty", () => {
    expect(fullPath("", "")).toBe("/");
  });

  it("prefixes a leading-slash router path with the basename", () => {
    expect(fullPath("/cmdb", "/portal/")).toBe("/portal/cmdb");
  });

  it("preserves a leading-slash router path when there is no basename", () => {
    expect(fullPath("/cmdb", "/")).toBe("/cmdb");
  });

  it("normalizes a slash-less router path", () => {
    expect(fullPath("cmdb", "/portal/")).toBe("/portal/cmdb");
  });
});
