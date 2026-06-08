import type { MoneyRange } from './types';

export const ZERO_RANGE: MoneyRange = {
  label: '$0',
  min: 0,
  max: 0,
  midpoint: 0,
};

export const OGE_AMOUNT_RANGES: MoneyRange[] = [
  { label: '$1,001-$15,000', min: 1001, max: 15000, midpoint: 8000.5 },
  { label: '$15,001-$50,000', min: 15001, max: 50000, midpoint: 32500.5 },
  { label: '$50,001-$100,000', min: 50001, max: 100000, midpoint: 75000.5 },
  { label: '$100,001-$250,000', min: 100001, max: 250000, midpoint: 175000.5 },
  { label: '$250,001-$500,000', min: 250001, max: 500000, midpoint: 375000.5 },
  { label: '$500,001-$1,000,000', min: 500001, max: 1000000, midpoint: 750000.5 },
  { label: '$1,000,001-$5,000,000', min: 1000001, max: 5000000, midpoint: 3000000.5 },
  { label: '$5,000,001-$25,000,000', min: 5000001, max: 25000000, midpoint: 15000000.5 },
  { label: '$25,000,001-$50,000,000', min: 25000001, max: 50000000, midpoint: 37500000.5 },
  { label: 'Over $50,000,000', min: 50000001, max: 50000001, midpoint: 50000001 },
];

const AMOUNT_BY_LABEL = new Map(OGE_AMOUNT_RANGES.map((range) => [normalizeRangeLabel(range.label), range]));

export function parseOgeAmountRange(value: string | null | undefined): MoneyRange {
  const normalized = normalizeRangeLabel(value || '');
  const direct = AMOUNT_BY_LABEL.get(normalized);
  if (direct) return { ...direct };

  const match = normalized.match(/\$?([0-9,]+)\s*-\s*\$?([0-9,]+)/);
  if (match) {
    const min = parseMoney(match[1]);
    const max = parseMoney(match[2]);
    if (min > 0 && max >= min) {
      const canonical = `$${formatInteger(min)}-$${formatInteger(max)}`;
      return { label: canonical, min, max, midpoint: (min + max) / 2 };
    }
  }

  if (/over\s+\$?50,?000,?000/i.test(value || '')) {
    return { ...OGE_AMOUNT_RANGES[OGE_AMOUNT_RANGES.length - 1] };
  }

  return { ...ZERO_RANGE, label: value?.trim() || 'Unknown' };
}

export function addRanges(label: string, ranges: MoneyRange[]): MoneyRange {
  const total = ranges.reduce(
    (acc, range) => ({
      min: acc.min + safeNumber(range.min),
      max: acc.max + safeNumber(range.max),
      midpoint: acc.midpoint + safeNumber(range.midpoint),
    }),
    { min: 0, max: 0, midpoint: 0 }
  );

  return {
    label,
    min: total.min,
    max: total.max,
    midpoint: total.midpoint,
  };
}

export function subtractRanges(label: string, left: MoneyRange, right: MoneyRange): MoneyRange {
  return {
    label,
    min: Math.max(0, safeNumber(left.min) - safeNumber(right.max)),
    max: Math.max(0, safeNumber(left.max) - safeNumber(right.min)),
    midpoint: Math.max(0, safeNumber(left.midpoint) - safeNumber(right.midpoint)),
  };
}

export function formatMoney(value: number, compact = true): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 0,
  }).format(safeNumber(value));
}

export function formatRange(range: MoneyRange): string {
  if (range.max === 0 && range.min === 0) return '$0';
  if (range.min === range.max) return `${formatMoney(range.min)}`;
  return `${formatMoney(range.min)}-${formatMoney(range.max)}`;
}

export function normalizeRangeLabel(value: string): string {
  return value
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\s+/g, '')
    .replace(/,/g, '')
    .replace(/US\$/gi, '$')
    .toUpperCase();
}

function parseMoney(value: string): number {
  const parsed = Number(value.replace(/[$,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}
