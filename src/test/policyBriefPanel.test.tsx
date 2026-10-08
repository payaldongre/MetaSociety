/**
 * Render smoke test for the structured policy-brief panel.
 *
 * Uses `react-dom/server` so it needs no DOM-testing peer dependency: if the
 * panel's Select/Badge/Card composition were broken, rendering would throw
 * rather than silently blanking the preview.
 *
 * The panel is now driven by the brief itself rather than by a channel list, so
 * these tests build the same default brief the page uses and assert the panel
 * reflects the feasibility verdict it is handed.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PolicyBriefPanel } from "@/components/PolicyBriefPanel";
import { channelDomainsFor, createDefaultBrief, validatePolicyBrief, type PolicyBrief } from "@/simulation";

function render(brief: PolicyBrief) {
  return renderToStaticMarkup(
    <PolicyBriefPanel brief={brief} feasibility={validatePolicyBrief(brief)} onChange={() => {}} />,
  );
}

describe("PolicyBriefPanel", () => {
  it("renders the verdict, derived parameters, pathway and legal basis", () => {
    const html = render(createDefaultBrief(["HOUSING"]));
    expect(html).toContain("Policy brief");
    expect(html).toMatch(/feasible/i);
    expect(html).toContain("Derived engine parameters");
    expect(html).toContain("Governance pathway");
    expect(html).toContain("Legal basis");
    expect(html).toContain("Pandharpur Municipal Council");
  });

  it("renders without throwing for a pilgrimage policy", () => {
    const html = render(createDefaultBrief(["PILGRIMAGE_FACILITIES"]));
    expect(html.length).toBeGreaterThan(100);
    expect(html).toMatch(/Pilgrimage facilities/i);
  });

  it("shows the blockers and marks a mismatched budget as blocked from simulation", () => {
    const brief = createDefaultBrief(["HOUSING"]);
    const broken: PolicyBrief = { ...brief, statedTotalInr: brief.statedTotalInr - 1 };
    const html = render(broken);
    expect(html).toContain("Blocked from simulation");
    expect(html).toMatch(/must equal the total exactly/i);
  });

  it("derives the domains from the brief's own channels", () => {
    const brief = createDefaultBrief(["HOUSING", "EDUCATION_SKILL"]);
    expect(brief.domains).toEqual(channelDomainsFor(["HOUSING", "EDUCATION_SKILL"]));
    expect(brief.domains).toContain("housing");
    expect(brief.domains).toContain("education_skill");
  });
});
