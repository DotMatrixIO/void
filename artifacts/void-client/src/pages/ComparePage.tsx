// SPDX-License-Identifier: AGPL-3.0-or-later
import PageShell from "@/components/PageShell";
import {
  sectionStyle,
  headingStyle,
  leadStyle as subheadStyle,
} from "@/components/longFormStyles";
import CompareTable from "@/components/CompareTable";
import ReadMoreButton from "@/components/short-form/ReadMoreButton";

// /compare short-form page. Per user direction: one-sentence intro,
// the thirteen-row comparison table itself, and READ THE LONG VERSION →
// to /docs/compare. No bullets, no breadcrumb, no other prose. The
// per-row prose, the "when VOID is the wrong tool" guidance, and the
// one-last-thing closer live on /docs/compare.

export default function ComparePage() {
  return (
    <PageShell backHref="/" backLabel="← BACK">
      <div style={sectionStyle}>
        <div style={headingStyle}>WHY NOT ZOOM?</div>
        <div style={subheadStyle}>FAIR QUESTION.</div>

        <p style={{ margin: "0 0 28px" }}>
          There are several perfectly good video tools in the world. Here is the honest score.
        </p>

        <CompareTable data-testid="compare-table" />

        <div style={{ marginTop: "28px" }}>
          <ReadMoreButton href="/docs/compare" />
        </div>
      </div>
    </PageShell>
  );
}
