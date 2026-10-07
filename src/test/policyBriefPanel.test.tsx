/**
 * Render smoke test for the governance/policy-brief panel.
 *
 * Uses `react-dom/server` so it needs no DOM-testing peer dependency: if the
 * panel's Select/Badge/Card composition were broken, rendering would throw
 * rather than silently blanking the preview.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PolicyBriefPanel } from "@/components/PolicyBriefPanel";

describe("PolicyBriefPanel", () => {
  it("renders the governance verdict, pathway and legal basis", () => {
    const html = renderToStaticMarkup(<PolicyBriefPanel channelIds={["HOUSING"]} />);
    expect(html).toContain("Policy brief");
    expect(html).toMatch(/feasible/i);
    expect(html).toContain("Governance pathway");
    expect(html).toContain("Legal basis");
    expect(html).toContain("Pandharpur Municipal Council");
  });

  it("renders without throwing for a pilgrimage policy", () => {
    const html = renderToStaticMarkup(<PolicyBriefPanel channelIds={["PILGRIMAGE_FACILITIES"]} />);
    expect(html.length).toBeGreaterThan(100);
    expect(html).toMatch(/Pilgrimage facilities/i);
  });
});
