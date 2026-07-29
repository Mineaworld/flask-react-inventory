import { describe, expect, it } from "vitest";

import { estimateDocument, estimateLine } from "./decimal";

describe("order decimal preview", () => {
  it("locks the unit USD value to four decimals before calculating the line total", () => {
    expect(estimateLine("3", "1", "3")).toEqual({ amount: "3.00", usd: "0.9999" });
    expect(estimateDocument([{ quantity: "3", unitAmount: "1" }], "3")).toEqual({
      amount: "3.00",
      usd: "0.9999",
    });
  });

  it("sums document-currency values at the two-decimal model scale", () => {
    expect(estimateDocument([
      { quantity: "0.005", unitAmount: "1.00" },
      { quantity: "0.005", unitAmount: "1.00" },
    ], "1")).toEqual({ amount: "0.02", usd: "0.0100" });
  });
});
