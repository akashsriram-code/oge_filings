import { addRanges } from './amounts';
import { buildSecurityKey, normalizeSecurityDescription } from './classify';
import type { MoneyRange, OgeTransaction } from './types';

export type EquityNetDirection = 'Net buy' | 'Net sale' | 'Hold';

export interface EquityStockSummary {
  id: string;
  stockName: string;
  normalizedStockName: string;
  ticker: string | null;
  resolvedTicker: string | null;
  resolvedIssuerName: string | null;
  resolvedExchange: string | null;
  resolvedCik: number | null;
  resolvedSector: string | null;
  resolvedSic: string | null;
  resolvedSicDescription: string | null;
  enrichmentSource: string;
  enrichmentConfidence: number;
  enrichmentFlags: string[];
  sector: string;
  purchaseCount: number;
  saleCount: number;
  transactionCount: number;
  purchases: MoneyRange;
  sales: MoneyRange;
  net: MoneyRange;
  netDirection: EquityNetDirection;
  netDirectionNote: string;
  firstPurchaseDate: string | null;
  lastPurchaseDate: string | null;
  lastTransactionDate: string | null;
  lateCount: number;
  confidence: number;
  sourceTransactionIds: string[];
}

export function buildEquityStockSummaries(transactions: OgeTransaction[]): EquityStockSummary[] {
  const groups = new Map<string, OgeTransaction[]>();
  for (const tx of transactions) {
    if (tx.assetType !== 'Equity') continue;
    const key = tx.resolvedTicker ? `TICKER ${tx.resolvedTicker}` : buildEquityStockKey(tx.description);
    const rows = groups.get(key) || [];
    rows.push(tx);
    groups.set(key, rows);
  }

  return Array.from(groups.entries())
    .map(([normalizedStockName, rows]) => {
      const purchases = rows.filter((row) => row.type === 'Purchase');
      const sales = rows.filter((row) => row.type === 'Sale');
      const purchaseRange = addRanges('Equity purchases', purchases.map((row) => row.amount));
      const saleRange = addRanges('Equity sales', sales.map((row) => row.amount));
      const netRange = {
        label: 'Net equity flow',
        min: purchaseRange.min - saleRange.max,
        max: purchaseRange.max - saleRange.min,
        midpoint: purchaseRange.midpoint - saleRange.midpoint,
      };
      const dates = rows.map((row) => row.date).sort();
      const purchaseDates = purchases.map((row) => row.date).sort();
      const sample = rows[0];
      const enrichedSample = rows
        .filter((row) => row.resolvedTicker)
        .sort((a, b) => b.enrichmentConfidence - a.enrichmentConfidence)[0] || sample;
      const enrichmentFlags = Array.from(new Set(rows.flatMap((row) => row.enrichmentFlags)));

      return {
        id: normalizedStockName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        stockName: enrichedSample.resolvedIssuerName || titleCaseStockName(normalizedStockName),
        normalizedStockName,
        ticker: rows.find((row) => row.ticker)?.ticker || null,
        resolvedTicker: enrichedSample.resolvedTicker,
        resolvedIssuerName: enrichedSample.resolvedIssuerName,
        resolvedExchange: enrichedSample.resolvedExchange,
        resolvedCik: enrichedSample.resolvedCik,
        resolvedSector: enrichedSample.resolvedSector,
        resolvedSic: enrichedSample.resolvedSic,
        resolvedSicDescription: enrichedSample.resolvedSicDescription,
        enrichmentSource: enrichedSample.enrichmentSource,
        enrichmentConfidence: rows.reduce((sum, row) => sum + row.enrichmentConfidence, 0) / rows.length,
        enrichmentFlags,
        sector: enrichedSample.resolvedSector || sample.sector,
        purchaseCount: purchases.length,
        saleCount: sales.length,
        transactionCount: rows.length,
        purchases: purchaseRange,
        sales: saleRange,
        net: netRange,
        netDirection: classifyNetDirection(netRange),
        netDirectionNote: describeNetDirection(netRange, purchases.length, sales.length),
        firstPurchaseDate: purchaseDates[0] || null,
        lastPurchaseDate: purchaseDates.at(-1) || null,
        lastTransactionDate: dates.at(-1) || null,
        lateCount: rows.filter((row) => row.lateFilingFlag).length,
        confidence: rows.reduce((sum, row) => sum + row.classificationConfidence, 0) / rows.length,
        sourceTransactionIds: rows.map((row) => row.id),
      } satisfies EquityStockSummary;
    })
    .filter((summary) => summary.purchaseCount > 0)
    .sort((a, b) =>
      b.purchases.midpoint - a.purchases.midpoint ||
      b.purchaseCount - a.purchaseCount ||
      a.stockName.localeCompare(b.stockName)
    );
}

export function deriveEquityStockName(description: string): string {
  const normalized = normalizeSecurityDescription(description);
  return buildEquityStockKey(normalized);
}

function buildEquityStockKey(description: string): string {
  return buildSecurityKey(description)
    .replace(/\b(REGS|REGISTERED|RESTRICTED|DISCRETIONARY ORDER|CONFIRMATION|PURSUANT TO REG S)\b.*$/g, '')
    .replace(/\b(CLASS|CL)\s+[A-Z]\b/g, '')
    .replace(/\b(NEW|DEL|F|PLC|LTD|INC|CORP|CORPORATION|CO|HLDGS|HOLDINGS|GROUP|SA|NV|LP|LLC|REIT)\b/g, '')
    .replace(/\b(EQUITY|COMMON|COM|ORD|SHS|SHARES|STOCK)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim() || buildSecurityKey(description);
}

function classifyNetDirection(net: MoneyRange): EquityNetDirection {
  if (net.midpoint > 0) return 'Net buy';
  if (net.midpoint < 0) return 'Net sale';
  return 'Hold';
}

function describeNetDirection(net: MoneyRange, purchaseCount: number, saleCount: number): string {
  const basis = 'Based on disclosed-range midpoint';
  if (purchaseCount === 0 && saleCount === 0) return 'No buy or sale rows in the visible set';
  if (purchaseCount > 0 && saleCount === 0) return `${basis}; no sales in visible rows`;
  if (saleCount > 0 && purchaseCount === 0) return `${basis}; no buys in visible rows`;
  if (net.min < 0 && net.max > 0) return `${basis}; range crosses zero`;
  return basis;
}

function titleCaseStockName(value: string): string {
  const keepUpper = new Set(['AAR', 'ABM', 'ACI', 'ADMA', 'ETF', 'REIT', 'CSG', 'DNOW']);
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((word) => {
      const upper = word.toUpperCase();
      if (keepUpper.has(upper)) return upper;
      if (word.length <= 2) return upper;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}
