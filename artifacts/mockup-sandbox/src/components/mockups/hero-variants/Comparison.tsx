// SPDX-License-Identifier: AGPL-3.0-or-later
import Variant01 from "./Variant01";
import Variant02 from "./Variant02";
import Variant03 from "./Variant03";
import Variant04 from "./Variant04";
import Variant05 from "./Variant05";

export default function Comparison() {
  const variants = [Variant01, Variant02, Variant03, Variant04, Variant05];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        gap: 16,
        padding: 16,
        background: "#0a0907",
        overflowX: "auto",
        minHeight: "100vh",
      }}
    >
      {variants.map((V, i) => (
        <div
          key={i}
          style={{
            flex: "0 0 520px",
            border: "1px solid #2a241c",
          }}
        >
          <V />
        </div>
      ))}
    </div>
  );
}
