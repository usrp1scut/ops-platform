import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PanelState } from "./PanelState";

describe("PanelState", () => {
  it("renders neutral panel state messages", () => {
    const html = renderToStaticMarkup(<PanelState kind="empty" message="No requests yet." />);

    expect(html).toContain("notice-row");
    expect(html).toContain("No requests yet.");
    expect(html).not.toContain("warn");
  });

  it("renders warning panel state messages", () => {
    const html = renderToStaticMarkup(<PanelState kind="permission" message="Permission required" />);

    expect(html).toContain("notice-row warn");
    expect(html).toContain("Permission required");
  });

  it("renders success panel state messages", () => {
    const html = renderToStaticMarkup(<PanelState kind="success" message="Request approved." />);

    expect(html).toContain("notice-row ok");
    expect(html).toContain("Request approved.");
  });
});
