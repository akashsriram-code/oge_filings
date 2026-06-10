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
  SourceAudit,
  SourceFiling,
  TrumpOgeBootstrap,
  TrumpIndexEntry,
  TrumpIndexRollup,
  TrumpOgeApiResponse,
  TrumpOgeDataset,
  TrumpOgeFilters,
  TrumpOgePageName,
  TrumpOgePageResponse,
  YearlyExposureSummary,
} from './types';

const DATA_ROOT = path.join(process.cwd(), 'data', 'oge', 'trump');
const BOOTSTRAP_INDEX_LIMIT = 80;
const jsonMemo = new Map<string, { mtimeMs: number; size: number; value: unknown }>();

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

const EMPTY_SOURCE_AUDIT: SourceAudit = {
  generatedAt: new Date(0).toISOString(),
  minDate: '2015-01-01',
  checkedThrough: new Date(0).toISOString().slice(0, 10),
  ogeApiRecordCount: 0,
  registrySourceCount: 0,
  officialPdfCount: 0,
  archivedCopyCount: 0,
  metadataOnlyCount: 0,
  officialRecordsWithoutRegistry: 0,
  coverageByYear: [],
  gaps: [],
  completenessStatus: 'incomplete',
  notes: ['Run npm run ingest:trump-oge to generate the source audit cache.'],
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
    sourceAudit,
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
    readJson<SourceAudit>('source-audit.json', EMPTY_SOURCE_AUDIT),
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
    sourceAudit,
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

export async function loadTrumpOgeBootstrap(): Promise<TrumpOgeBootstrap> {
  const cached = await readJson<TrumpOgeBootstrap | null>('dashboard-bootstrap.json', null);
  if (cached) return cached;
  return buildDashboardBootstrap(await loadTrumpOgeDataset());
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
          holding.instrumentIssuerState || '',
          holding.instrumentIssuerCategory || '',
          holding.instrumentReferenceLabel || '',
          holding.instrumentReferenceSource || '',
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
        entry.instrumentIssuerState || '',
        entry.instrumentIssuerCategory || '',
        entry.instrumentReferenceLabel || '',
        entry.instrumentReferenceSource || '',
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

export function buildDashboardBootstrap(dataset: TrumpOgeDataset, filters: TrumpOgeFilters = {}): TrumpOgeBootstrap {
  const response = buildApiResponse(dataset, filters);
  return {
    cacheMeta: response.cacheMeta,
    kpis: response.kpis,
    filters: response.filters,
    availableSectors: response.availableSectors,
    availableAssetTypes: response.availableAssetTypes,
    availableYears: buildAvailableYears(dataset),
    sourceAudit: response.sourceAudit,
    yearlyExposureSummaries: response.yearlyExposureSummaries,
    trumpIndex: response.trumpIndex.slice(0, BOOTSTRAP_INDEX_LIMIT),
    trumpIndexRollups: response.trumpIndexRollups,
  };
}

export function buildPageResponse(
  dataset: TrumpOgeDataset,
  page: TrumpOgePageName,
  filters: TrumpOgeFilters = {}
): TrumpOgePageResponse {
  const effectiveFilters = filtersForPage(page, filters);
  const response = buildApiResponse(dataset, effectiveFilters);
  const base = {
    page,
    cacheMeta: response.cacheMeta,
    kpis: response.kpis,
    filters: response.filters,
    availableSectors: response.availableSectors,
    availableAssetTypes: response.availableAssetTypes,
    availableYears: buildAvailableYears(dataset),
  };

  if (isAssetPage(page)) {
    return {
      ...base,
      transactions: response.transactions,
      holdingsEstimates: response.holdingsEstimates,
      sectorSummaries: response.sectorSummaries,
      trumpIndex: response.trumpIndex,
      trumpIndexRollups: response.trumpIndexRollups,
      sourceFilings: dataset.sourceFilings,
      historicalSources: filterHistoricalSources(dataset.historicalSources, effectiveFilters),
    };
  }

  switch (page) {
    case 'index':
      return {
        ...base,
        historicalSources: filterHistoricalSources(dataset.historicalSources, effectiveFilters),
        sourceAudit: dataset.sourceAudit,
        yearlyExposureSummaries: response.yearlyExposureSummaries,
        trumpIndex: response.trumpIndex,
        trumpIndexRollups: response.trumpIndexRollups,
      };
    case 'sectors':
      return {
        ...base,
        sectorSummaries: response.sectorSummaries,
        trumpIndexRollups: response.trumpIndexRollups,
      };
    case 'timing':
      return {
        ...base,
        transactions: response.transactions,
        historicalSources: filterHistoricalSources(dataset.historicalSources, effectiveFilters),
        events: dataset.events,
      };
    case 'holdings':
      return {
        ...base,
        holdingsEstimates: response.holdingsEstimates,
      };
    case 'transactions':
      return {
        ...base,
        transactions: response.transactions,
      };
    case 'filings':
      return {
        ...base,
        sourceAudit: dataset.sourceAudit,
        historicalSources: filterHistoricalSources(dataset.historicalSources, effectiveFilters),
        sourceFilings: dataset.sourceFilings,
        financialDisclosureReports: dataset.financialDisclosureReports,
        assetIncomeHoldings: dataset.assetIncomeHoldings,
        liabilities: dataset.liabilities,
      };
    case 'review':
      return {
        ...base,
        reviewQueue: dataset.reviewQueue,
      };
    default:
      return {
        ...base,
        trumpIndex: response.trumpIndex.slice(0, BOOTSTRAP_INDEX_LIMIT),
        trumpIndexRollups: response.trumpIndexRollups,
      };
  }
}

export function isTrumpOgePageName(value: string | null): value is TrumpOgePageName {
  return Boolean(value && [
    'index',
    'equities',
    'corporate-bonds',
    'municipal-bonds',
    'funds',
    'preferred',
    'other',
    'holdings',
    'sectors',
    'timing',
    'transactions',
    'filings',
    'review',
  ].includes(value));
}

export function ogeCacheHeaders(cacheMeta: CacheMeta): HeadersInit {
  return {
    'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
    'x-cache-version': cacheMeta.generatedAt,
  };
}

export function clearOgeJsonMemoForTests() {
  jsonMemo.clear();
}

function buildAvailableYears(dataset: Pick<TrumpOgeDataset, 'transactions' | 'historicalSources'>): string[] {
  return Array.from(new Set([
    ...dataset.transactions.map((tx) => tx.date.slice(0, 4)),
    ...dataset.historicalSources.map((source) => source.reportYear ? String(source.reportYear) : source.filedDate.slice(0, 4)),
  ].filter(Boolean))).sort((a, b) => b.localeCompare(a));
}

function filtersForPage(page: TrumpOgePageName, filters: TrumpOgeFilters): TrumpOgeFilters {
  const assetType = assetTypeForPage(page);
  const next = assetType ? { ...filters, assetType } : { ...filters };
  if (page === 'timing') {
    return {
      ...next,
      year: 'All',
      startDate: '',
      endDate: '',
    };
  }
  return next;
}

function isAssetPage(page: TrumpOgePageName): boolean {
  return Boolean(assetTypeForPage(page));
}

function assetTypeForPage(page: TrumpOgePageName) {
  const assetTypes = {
    equities: 'Equity',
    'corporate-bonds': 'Corporate Bond',
    'municipal-bonds': 'Municipal Bond',
    funds: 'ETF / Fund',
    preferred: 'Preferred / Hybrid',
    other: 'Other',
  } satisfies Partial<Record<TrumpOgePageName, TrumpOgeDataset['transactions'][number]['assetType']>>;
  return assetTypes[page as keyof typeof assetTypes] || null;
}

function filterHistoricalSources(sources: HistoricalSource[], filters: TrumpOgeFilters): HistoricalSource[] {
  return sources.filter((source) => {
    if (filters.year && filters.year !== 'All' && source.reportYear !== Number(filters.year) && !source.filedDate.startsWith(String(filters.year))) return false;
    if (filters.sourceReliability && filters.sourceReliability !== 'All' && source.sourceReliability !== filters.sourceReliability) return false;
    return true;
  });
}

async function readJson<T>(filename: string, fallback: T): Promise<T> {
  try {
    const filePath = path.join(DATA_ROOT, filename);
    const stats = await fs.stat(filePath);
    const cached = jsonMemo.get(filePath);
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      return cached.value as T;
    }
    const raw = await fs.readFile(filePath, 'utf8');
    const value = JSON.parse(raw) as T;
    jsonMemo.set(filePath, { mtimeMs: stats.mtimeMs, size: stats.size, value });
    return value;
  } catch {
    return fallback;
  }
}
