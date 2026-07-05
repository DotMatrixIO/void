// SPDX-License-Identifier: AGPL-3.0-or-later
import IterationA from "./IterationA";
import IterationB from "./IterationB";

export default function Comparison2() {
  const variants = [IterationA, IterationB];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        gap: 16,
        padding: 16,
        background: "#0a0907",
        minHeight: "100vh",
      }}
    >
      {variants.map((V, i) => (
        <div
          key={i}
          style={{
            flex: "1 1 0",
            minWidth: 0,
            border: "1px solid #2a241c",
          }}
        >
          <V />
        </div>
      ))}
    </div>
  );
}
