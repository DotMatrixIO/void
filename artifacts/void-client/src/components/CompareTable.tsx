// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared thirteen-row / six-tool comparison table.
//
// Originally lived inline in DocsComparePage. Extracted so the
// short-form /compare page can render the same table beneath its
// one-sentence intro without duplicating data or styles. Long-form
// /docs/compare still owns the per-row prose and the "when VOID is
// the wrong tool" closer.

import ScrollableTable from "@/components/ScrollableTable";

type CellValue = "YES" | "NO" | string;

export const compareTools = [
  "ZOOM",
  "MEET",
  "FACETIME",
  "SIGNAL",
  "JITSI",
  "VOID",
] as const;

export type CompareTool = (typeof compareTools)[number];

export interface CompareRow {
  label: string;
  values: Record<CompareTool, CellValue>;
}

export const compareRows: CompareRow[] = [
  {
    label: "NO ACCOUNT REQUIRED",
    values: { ZOOM: "NO", MEET: "NO", FACETIME: "NO", SIGNAL: "NO", JITSI: "YES", VOID: "YES" },
  },
  {
    label: "NO RECORD OF WHO MET WHOM",
    values: { ZOOM: "NO", MEET: "NO", FACETIME: "NO", SIGNAL: "NO", JITSI: "DEPENDS", VOID: "YES" },
  },
  {
    label: "RUNS ON YOUR OWN HARDWARE",
    values: { ZOOM: "NO", MEET: "NO", FACETIME: "NO", SIGNAL: "NO", JITSI: "YES", VOID: "YES" },
  },
  {
    label: "OPEN SOURCE",
    values: { ZOOM: "NO", MEET: "NO", FACETIME: "NO", SIGNAL: "YES", JITSI: "YES", VOID: "YES" },
  },
  {
    label: "NOTHING SAVED BY DEFAULT",
    values: { ZOOM: "NO", MEET: "NO", FACETIME: "NO", SIGNAL: "NO", JITSI: "YES", VOID: "YES" },
  },
  {
    label: "FACE & VOICE MASKS BUILT IN",
    values: { ZOOM: "NO", MEET: "NO", FACETIME: "NO", SIGNAL: "NO", JITSI: "NO", VOID: "YES" },
  },
  {
    label: "PAY WITH LIGHTNING — NO IDENTITY ATTACHED",
    values: { ZOOM: "NO", MEET: "NO", FACETIME: "NO", SIGNAL: "NO", JITSI: "NO", VOID: "YES" },
  },
  {
    label: "NO SERVER IN THE MIDDLE",
    values: { ZOOM: "NO", MEET: "NO", FACETIME: "YES", SIGNAL: "NO", JITSI: "NO", VOID: "YES" },
  },
  {
    label: "WORKS FROM A LINK — NO APP TO INSTALL",
    values: { ZOOM: "DEPENDS", MEET: "YES", FACETIME: "DEPENDS", SIGNAL: "NO", JITSI: "YES", VOID: "YES" },
  },
  {
    label: "SERVER NEVER HOLDS THE KEY",
    values: { ZOOM: "DEPENDS", MEET: "NO", FACETIME: "DEPENDS", SIGNAL: "YES", JITSI: "DEPENDS", VOID: "YES" },
  },
  {
    label: "MAX PARTICIPANTS",
    values: { ZOOM: "1000", MEET: "500", FACETIME: "32", SIGNAL: "50", JITSI: "100", VOID: "4" },
  },
  {
    label: "NATIVE MOBILE APPS",
    values: { ZOOM: "YES", MEET: "YES", FACETIME: "YES", SIGNAL: "YES", JITSI: "YES", VOID: "NO" },
  },
  {
    label: "RECORDING / TRANSCRIPTS",
    values: { ZOOM: "YES", MEET: "YES", FACETIME: "NO", SIGNAL: "NO", JITSI: "YES", VOID: "NO" },
  },
];

export function compareCellColor(value: CellValue, tool: CompareTool): string {
  if (value === "DEPENDS") return "var(--gold)";
  if (tool === "VOID") {
    return "var(--teal)";
  }
  if (value === "YES") return "var(--fg-on-dark)";
  if (value === "NO") return "#6B6354";
  return "var(--fg-on-dark)";
}

const tableCellBase: React.CSSProperties = {
  padding: "10px 8px",
  borderBottom: "1px solid #2A241B",
  borderRight: "1px solid #2A241B",
  textAlign: "center",
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
  letterSpacing: "1px",
  whiteSpace: "nowrap",
};

const labelCellBase: React.CSSProperties = {
  ...tableCellBase,
  textAlign: "left",
  color: "var(--fg-on-dark)",
  fontSize: "12px",
  letterSpacing: "1.5px",
  textTransform: "uppercase",
  whiteSpace: "normal",
  minWidth: "180px",
  paddingRight: "12px",
};

const headerCellBase: React.CSSProperties = {
  ...tableCellBase,
  fontWeight: 700,
  fontSize: "12px",
  letterSpacing: "2px",
  color: "var(--burnt)",
  borderBottom: "2px solid var(--gold)",
  borderTop: "2px solid var(--gold)",
  background: "rgba(0,0,0,0.25)",
};

interface CompareTableProps {
  "data-testid"?: string;
}

export default function CompareTable({ "data-testid": testId }: CompareTableProps = {}) {
  return (
    <ScrollableTable
      data-testid={testId}
      ariaLabel="Video tool capability comparison. Scroll sideways to reach every column, including VOID."
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          borderTop: "2px solid var(--gold)",
          borderLeft: "1px solid #2A241B",
          fontFamily: "var(--font-mono)",
        }}
      >
        <thead>
          <tr>
            <th
              style={{
                ...headerCellBase,
                textAlign: "left",
                minWidth: "180px",
                color: "var(--gold)",
              }}
              scope="col"
            >
              CAPABILITY
            </th>
            {compareTools.map((tool) => (
              <th
                key={tool}
                style={{
                  ...headerCellBase,
                  color: tool === "VOID" ? "var(--teal)" : "var(--burnt)",
                }}
                scope="col"
              >
                {tool}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {compareRows.map((row) => (
            <tr key={row.label}>
              <th style={labelCellBase} scope="row">
                {row.label}
              </th>
              {compareTools.map((tool) => {
                const value = row.values[tool];
                return (
                  <td
                    key={tool}
                    style={{
                      ...tableCellBase,
                      color: compareCellColor(value, tool),
                      fontWeight: tool === "VOID" ? 700 : 400,
                      background:
                        tool === "VOID" ? "rgba(0,0,0,0.25)" : "transparent",
                    }}
                  >
                    {value}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollableTable>
  );
}
