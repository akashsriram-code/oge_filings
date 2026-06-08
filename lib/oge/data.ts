import { promises as fs } from 'fs';
import path from 'path';
import { buildKpis } from './analytics';
import { EMPTY_SECURITY_REFERENCE } from './enrichment';
import { buildEventWindows } from './events';
import { filterTransactions } from './filter';
import type {
  BaselineHolding,
  CacheMeta,
  EstimatedHolding,
  EventWindowSummary,
  OgeEvent,
  ReviewQueueItem,
  SecurityEnrichment,
  SecurityReferenceCache,
  SectorSummary,
  SourceFiling,
  TrumpOgeApiResponse,
  TrumpOgeDataset,
  TrumpOgeFilters,
} from './types';

const DATA_ROOT = path.join(process.cwd(), 'data', 'oge', 'trump');

const EMPTY_META: CacheMeta = {
  generatedAt: new Date(0).toISOString(),
  dataThrough: null,
  source: 'empty',
  sourceFilingCount: 0,
  transactionCount: 0,
  baselineHoldingCount: 0,
  estimatedHoldingCount: 0,
  reviewQueueCount: 0,
  lateTransactionCount: 0,
  estimatedTotalMidpoint: 0,
  securityReferenceCount: 0,
  securityEnrichmentCount: 0,
  enrichedTransactionCount: 0,
  eventCount: 0,
  eventWindowCount: 0,
  notes: ['Run npm run ingest:trump-oge to generate the cache.'],
};

export async function loadTrumpOgeDataset(): Promise<TrumpOgeDataset> {
  const [
    sourceFilings,
    transactions,
    baselineHoldings,
    holdingsEstimates,
    sectorSummaries,
    reviewQueue,
    events,
    eventWindows,
    securityReference,
    securityEnrichments,
    cacheMeta,
  ] = await Promise.all([
    readJson<SourceFiling[]>('source-filings.json', []),
    readJson<TrumpOgeDataset['transactions']>('transactions.json', []),
    readJson<BaselineHolding[]>('baseline-holdings.json', []),
    readJson<EstimatedHolding[]>('holdings-estimates.json', []),
    readJson<SectorSummary[]>('sector-summaries.json', []),
    readJson<ReviewQueueItem[]>('review-queue.json', []),
    readJson<OgeEvent[]>('events.json', []),
    readJson<EventWindowSummary[]>('event-windows.json', []),
    readJson<SecurityReferenceCache>('security-reference.json', EMPTY_SECURITY_REFERENCE),
    readJson<SecurityEnrichment[]>('security-enrichment.json', []),
    readJson<CacheMeta>('cache-meta.json', EMPTY_META),
  ]);

  return {
    sourceFilings,
    transactions,
    baselineHoldings,
    holdingsEstimates,
    sectorSummaries,
    reviewQueue,
    events,
    eventWindows,
    securityReference,
    securityEnrichments,
    cacheMeta,
  };
}

export function buildApiResponse(dataset: TrumpOgeDataset, filters: TrumpOgeFilters = {}): TrumpOgeApiResponse {
  const filteredTransactions = filterTransactions(dataset.transactions, filters);
  const filteredDataset = {
    ...dataset,
    transactions: filteredTransactions,
    eventWindows: buildEventWindows(dataset.events, filteredTransactions),
  };

  return {
    ...filteredDataset,
    kpis: buildKpis({
      sourceFilings: dataset.sourceFilings,
      transactions: filteredTransactions,
      reviewQueue: dataset.reviewQueue,
    }),
    filters: {
      ...filters,
      lateOnly: Boolean(filters.lateOnly),
    },
    availableSectors: Array.from(new Set(dataset.transactions.map((tx) => tx.sector))).sort(),
    availableAssetTypes: Array.from(new Set(dataset.transactions.map((tx) => tx.assetType))).sort(),
  };
}

async function readJson<T>(filename: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(path.join(DATA_ROOT, filename), 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
