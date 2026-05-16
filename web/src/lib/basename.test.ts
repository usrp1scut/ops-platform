import { describe, expect, it } from "vitest";

import { appBasename, fullPath } from "./basename";

// Root ("/") is the canonical deploy shape (standalone nginx image). The
// sub-path cases use a generic "/sub" mount to keep the optional VITE_BASE
// branch covered without implying a real /portal mount still exists.
describe("appBasename", () => {
  it("returns an empty string when the app is mounted at the document root", () => {
    expect(appBasename("/")).toBe("");
  });

  it("strips a trailing slash for sub-path mounts", () => {
    expect(appBasename("/sub/")).toBe("/sub");
  });

  it("collapses repeated trailing slashes", () => {
    expect(appBasename("/sub//")).toBe("/sub");
  });

  it("leaves a slashless mount untouched", () => {
    expect(appBasename("/sub")).toBe("/sub");
  });
});

describe("fullPath", () => {
  it("returns the base URL itself when the router is at /", () => {
    expect(fullPath("/", "/")).toBe("/");
    expect(fullPath("/", "/sub/")).toBe("/sub/");
  });

  it("falls back to / when both inputs are empty", () => {
    expect(fullPath("", "")).toBe("/");
  });

  it("preserves a leading-slash router path at the root (the normal case)", () => {
    expect(fullPath("/cmdb", "/")).toBe("/cmdb");
  });

  it("prefixes a leading-slash router path with a sub-path basename", () => {
    expect(fullPath("/cmdb", "/sub/")).toBe("/sub/cmdb");
  });

  it("normalizes a slash-less router path", () => {
    expect(fullPath("cmdb", "/sub/")).toBe("/sub/cmdb");
  });
});
