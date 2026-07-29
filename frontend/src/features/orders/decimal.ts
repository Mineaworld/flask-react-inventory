type FixedValue = {
  scale: number;
  units: bigint;
};

const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;

function parseFixed(value: string): FixedValue | null {
  const normalized = value.trim();
  if (!DECIMAL_PATTERN.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  return { scale: fraction.length, units: BigInt(`${whole}${fraction}`) };
}

function tenPow(scale: number): bigint {
  return 10n ** BigInt(scale);
}

function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

function formatUnits(units: bigint, scale: number): string {
  const padded = units.toString().padStart(scale + 1, "0");
  if (scale === 0) return padded;
  return `${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}

export function estimateLine(quantity: string, unitAmount: string, exchangeRate: string): { amount: string; usd: string } | null {
  const quantityValue = parseFixed(quantity);
  const amountValue = parseFixed(unitAmount);
  const rateValue = parseFixed(exchangeRate);
  if (!quantityValue || !amountValue || !rateValue || rateValue.units === 0n) return null;

  const productUnits = quantityValue.units * amountValue.units;
  const productScale = quantityValue.scale + amountValue.scale;
  const amountCents = divideRounded(productUnits * 100n, tenPow(productScale));
  const unitUsdTenThousandths = divideRounded(
    amountValue.units * tenPow(rateValue.scale) * 10_000n,
    tenPow(amountValue.scale) * rateValue.units,
  );
  const usdTenThousandths = divideRounded(
    quantityValue.units * unitUsdTenThousandths,
    tenPow(quantityValue.scale),
  );
  return { amount: formatUnits(amountCents, 2), usd: formatUnits(usdTenThousandths, 4) };
}

export function estimateDocument(lines: Array<{ quantity: string; unitAmount: string }>, exchangeRate: string): { amount: string; usd: string } {
  let amount = 0n;
  let usd = 0n;
  for (const line of lines) {
    const estimate = estimateLine(line.quantity, line.unitAmount, exchangeRate);
    if (!estimate) continue;
    amount += BigInt(estimate.amount.replace(".", ""));
    usd += BigInt(estimate.usd.replace(".", ""));
  }
  return { amount: formatUnits(amount, 2), usd: formatUnits(usd, 4) };
}
