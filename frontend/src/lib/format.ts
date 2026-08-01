import type { Currency } from "../types/api";

const twoDecimalFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const quantityFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 3,
});

const usdValueFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 4,
});

const exchangeRateFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 6,
});

function numberOrZero(value: number | string | null | undefined): number {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

export function formatDecimal(value: number | string | null | undefined): string {
  return twoDecimalFormatter.format(numberOrZero(value));
}

export function formatQuantity(value: number | string | null | undefined): string {
  return quantityFormatter.format(numberOrZero(value));
}

export function formatUsdValue(value: number | string | null | undefined): string {
  return usdValueFormatter.format(numberOrZero(value));
}

export function formatExchangeRate(value: number | string | null | undefined): string {
  return exchangeRateFormatter.format(numberOrZero(value));
}

const zeroDecimalFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatCurrency(value: number | string | null | undefined, currency: Currency): string {
  const num = numberOrZero(value);
  if (currency === "KHR") {
    return `៛${zeroDecimalFormatter.format(num)}`;
  }
  return `$${twoDecimalFormatter.format(num)}`;
}
