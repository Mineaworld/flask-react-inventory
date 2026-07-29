import { describe, expect, it } from "vitest";

import { formatCurrency, formatDecimal, formatExchangeRate, formatQuantity, formatUsdValue } from "./format";

describe("decimal display formatting", () => {
  it("keeps two decimals for normal totals", () => {
    expect(formatDecimal("0.0000")).toBe("0.00");
    expect(formatDecimal("12")).toBe("12.00");
    expect(formatDecimal("12.345")).toBe("12.35");
  });

  it("shows enough precision for inventory and exchange data", () => {
    expect(formatQuantity("12.345")).toBe("12.345");
    expect(formatUsdValue("1.2195")).toBe("1.2195");
    expect(formatExchangeRate("4100.123456")).toBe("4,100.123456");
  });

  it("formats USD and KHR with the same two-decimal rule", () => {
    expect(formatCurrency("20.0000", "USD")).toBe("$20.00");
    expect(formatCurrency("145000", "KHR")).toBe("៛145,000.00");
  });
});
