import { promises as fs } from 'fs';
import path from 'path';
import { buildHoldingsEstimates, buildKpis, buildSectorSummaries } from './analytics';
import { EMPTY_SECURITY_REFERENCE } from './enrichment';
import { buildEventWindows } from './events';
import { filterTransactions } from './filter';
import { buildTrumpIndex, buildTrumpIndexRollups } from './index';
import type {
  AssetIncomeHolding,
  BaselineHolding,
  CacheMeta,
  EstimatedHolding,
  EventWindowSummary,
  FinancialDisclosureReport,
  HistoricalSource,
  Liability,
  OgeEvent,
  ReviewQueueItem,
  SecurityEnrichment,
  SecurityReferenceCache,
  SectorSummary,
  SourceFiling,
  TrumpIndexEntry,
  TrumpIndexRollup,
  TrumpOgeApiResponse,
  TrumpOgeDataset,
  TrumpOgeFilters,
  YearlyExposureSummary,
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
  instrumentContextCount: 0,
  enrichedTransactionCount: 0,
  eventCount: 0,
  eventWindowCount: 0,
  historicalSourceCount: 0,
  financialDisclosureReportCount: 0,
  assetIncomeHoldingCount: 0,
  liabilityCount: 0,
  trumpIndexCount: 0,
  notes: ['Run npm run ingest:trump-oge to generate the cache.'],
};

export async function loadTrumpOgeDataset(): Promise<TrumpOgeDataset> {
  const [
    historicalSources,
    sourceFilings,
    transactions,
    baselineHoldings,
    financialDisclosureReports,
    assetIncomeHoldings,
    liabilities,
    yearlyExposureSummaries,
    holdingsEstimates,
    sectorSummaries,
    trumpIndex,
    trumpIndexRollups,
    reviewQueue,
    events,
    eventWindows,
    securityReference,
    securityEnrichments,
    cacheMeta,
  ] = await Promise.all([
    readJson<HistoricalSource[]>('historical-sources.json', []),
    readJson<SourceFiling[]>('source-filings.json', []),
    readJson<TrumpOgeDataset['transactions']>('transactions.json', []),
    readJson<BaselineHolding[]>('baseline-holdings.json', []),
    readJson<FinancialDisclosureReport[]>('financial-disclosure-reports.json', []),
    readJson<AssetIncomeHolding[]>('asset-income-holdings.json', []),
    readJson<Liability[]>('liabilities.json', []),
    readJson<YearlyExposureSummary[]>('yearly-exposure-summaries.json', []),
    readJson<EstimatedHolding[]>('holdings-estimates.json', []),
    readJson<SectorSummary[]>('sector-summaries.json', []),
    readJson<TrumpIndexEntry[]>('trump-index.json', []),
    readJson<TrumpIndexRollup[]>('trump-index-rollups.json', []),
    readJson<ReviewQueueItem[]>('review-queue.json', []),
    readJson<OgeEvent[]>('events.json', []),
    readJson<EventWindowSummary[]>('event-windows.json', []),
    readJson<SecurityReferenceCache>('security-reference.json', EMPTY_SECURITY_REFERENCE),
    readJson<SecurityEnrichment[]>('security-enrichment.json', []),
    readJson<CacheMeta>('cache-meta.json', EMPTY_META),
  ]);

  return {
    historicalSources,
    sourceFilings,
    transactions,
    baselineHoldings,
    financialDisclosureReports,
    assetIncomeHoldings,
    liabilities,
    yearlyExposureSummaries,
    holdingsEstimates,
    sectorSummaries,
    trumpIndex,
    trumpIndexRollups,
    reviewQueue,
    events,
    eventWindows,
    securityReference,
    securityEnrichments,
    cacheMeta,
  };
}

export async function loadTrumpOgeCacheMeta(): Promise<CacheMeta> {
  return readJson<CacheMeta>('cache-meta.json', EMPTY_META);
}

export function buildApiResponse(dataset: TrumpOgeDataset, filters: TrumpOgeFilters = {}): TrumpOgeApiResponse {
  const filteredTransactions = filterTransactions(dataset.transactions, filters);
  const filteredHoldings = buildHoldingsEstimates(filteredTransactions, dataset.baselineHoldings);
  const filteredSectorSummaries = buildSectorSummaries(filteredTransactions);
  const filteredIndex = buildTrumpIndex({
    holdings: filteredHoldings.filter((holding) => {
      if (filters.assetType && filters.assetType !== 'All' && holding.assetType !== filters.assetType) return false;
      if (filters.sector && filters.sector !== 'All' && holding.sector !== filters.sector) return false;
      const query = filters.query?.trim().toLowerCase();
      if (query) {
        const haystack = [
          holding.description,
          holding.resolvedTicker || '',
          holding.issuerContextTicker || '',
          holding.resolvedIssuerName || '',
          holding.issuerContextIssuerName || '',
          holding.instrumentIssuerName || '',
          holding.instrumentSummary || '',
          holding.sector,
          holding.assetType,
        ].join(' ').toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    }),
    transactions: filteredTransactions,
    sourceFilings: dataset.sourceFilings,
    historicalSources: dataset.historicalSources,
  });
  const visibleIndex = filteredIndex.entries.filter((entry) => {
    if (filters.sourceReliability && filters.sourceReliability !== 'All' && entry.sourceReliability !== filters.sourceReliability) return false;
    if (filters.ticker && filters.ticker !== 'All') {
      const ticker = String(filters.ticker).toUpperCase();
      const tickers = [entry.resolvedTicker, entry.issuerContextTicker].filter(Boolean).map((value) => String(value).toUpperCase());
      if (!tickers.includes(ticker)) return false;
    }
    if (filters.issuer) {
      const issuer = String(filters.issuer).trim().toLowerCase();
      const haystack = [
        entry.resolvedIssuerName || '',
        entry.issuerContextIssuerName || '',
        entry.instrumentIssuerName || '',
        entry.displayName,
        entry.instrumentSummary || '',
      ].join(' ').toLowerCase();
      if (issuer && !haystack.includes(issuer)) return false;
    }
    return true;
  });
  const filteredDataset = {
    ...dataset,
    transactions: filteredTransactions,
    holdingsEstimates: filteredHoldings,
    sectorSummaries: filteredSectorSummaries,
    eventWindows: buildEventWindows(dataset.events, filteredTransactions),
    trumpIndex: visibleIndex,
    trumpIndexRollups: buildTrumpIndexRollups(visibleIndex),
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
