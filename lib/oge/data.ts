import { promises as fs } from 'fs';
import path from 'path';
import { buildHoldingsEstimates, buildKpis, buildSectorSummaries } from './analytics';
import { EMPTY_SECURITY_REFERENCE } from './enrichment';
import { buildEventWindows } from './events';
import { EMPTY_FIXED_INCOME_IDENTIFIER_CACHE } from './fixed-income-identifiers';
import { filterTransactions } from './filter';
import { buildIdentifierReviewItems } from './instrument-identity';
import { buildTrumpIndex, buildTrumpIndexRollups } from './index';
import type {
  AssetIncomeHolding,
  BaselineHolding,
  CacheMeta,
  EstimatedHolding,
  EventWindowSummary,
  FixedIncomeIdentifierCache,
  FinancialDisclosureReport,
  HistoricalSource,
  InstrumentIdentity,
  Liability,
  OgeEvent,
  OgeTransaction,
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
const PAGE_INDEX_LIMIT = 600;
const PAGE_TRANSACTION_LIMIT = 1000;
const PAGE_REVIEW_LIMIT = 500;
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
  fixedIncomeIdentifierCount: 0,
  fixedIncomeFigiMatchCount: 0,
  fixedIncomeIdentifierAmbiguousCount: 0,
  instrumentIdentityCount: 0,
  exactInstrumentReferenceCount: 0,
  identifierReviewCount: 0,
  annualBaselineMatchedCount: 0,
  annualBaselineMissingCount: 0,
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
    instrumentIdentities,
    reviewQueue,
    events,
    eventWindows,
    securityReference,
    securityEnrichments,
    fixedIncomeIdentifiers,
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
    readJson<InstrumentIdentity[]>('instrument-identity.json', []),
    readJson<ReviewQueueItem[]>('review-queue.json', []),
    readJson<OgeEvent[]>('events.json', []),
    readJson<EventWindowSummary[]>('event-windows.json', []),
    readJson<SecurityReferenceCache>('security-reference.json', EMPTY_SECURITY_REFERENCE),
    readJson<SecurityEnrichment[]>('security-enrichment.json', []),
    readJson<FixedIncomeIdentifierCache>('fixed-income-identifiers.json', EMPTY_FIXED_INCOME_IDENTIFIER_CACHE),
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
    instrumentIdentities,
    reviewQueue,
    events,
    eventWindows,
    securityReference,
    securityEnrichments,
    fixedIncomeIdentifiers,
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
    instrumentIdentities: filterInstrumentIdentities(dataset.instrumentIdentities, filters),
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
    instrumentIdentities: response.instrumentIdentities.slice(0, BOOTSTRAP_INDEX_LIMIT),
  };
}

export function buildPageResponse(
  dataset: TrumpOgeDataset,
  page: TrumpOgePageName,
  filters: TrumpOgeFilters = {}
): TrumpOgePageResponse {
  return buildPageResponseFromParts({
    page,
    filters,
    bootstrap: buildDashboardBootstrap(dataset),
    transactions: dataset.transactions,
    baselineHoldings: dataset.baselineHoldings,
    sourceFilings: dataset.sourceFilings,
    historicalSources: dataset.historicalSources,
    reviewQueue: dataset.reviewQueue,
    instrumentIdentities: dataset.instrumentIdentities,
    yearlyExposureSummaries: dataset.yearlyExposureSummaries,
    sourceAudit: dataset.sourceAudit,
    events: dataset.events,
  });
}

export async function loadTrumpOgePageResponse(
  page: TrumpOgePageName,
  filters: TrumpOgeFilters = {}
): Promise<TrumpOgePageResponse> {
  const bootstrap = await loadTrumpOgeBootstrap();
  const needsTransactions = pageNeedsTransactions(page);
  const needsIndex = pageNeedsIndex(page);
  const needsBaseline = pageNeedsBaseline(page);
  const needsSources = pageNeedsSources(page);
  const needsInstrumentIdentities = page === 'identifier-review';

  const [
    transactions,
    baselineHoldings,
    sourceFilings,
    historicalSources,
    reviewQueue,
    instrumentIdentities,
    events,
  ] = await Promise.all([
    needsTransactions ? readJson<OgeTransaction[]>('transactions.json', []) : Promise.resolve([]),
    needsBaseline ? readJson<BaselineHolding[]>('baseline-holdings.json', []) : Promise.resolve([]),
    needsTransactions || needsIndex || page === 'filings' ? readJson<SourceFiling[]>('source-filings.json', []) : Promise.resolve([]),
    needsSources || needsIndex || page === 'timing' ? readJson<HistoricalSource[]>('historical-sources.json', []) : Promise.resolve([]),
    needsTransactions || page === 'review' ? readJson<ReviewQueueItem[]>('review-queue.json', []) : Promise.resolve([]),
    needsInstrumentIdentities ? readJson<InstrumentIdentity[]>('instrument-identity.json', []) : Promise.resolve([]),
    page === 'timing' ? readJson<OgeEvent[]>('events.json', []) : Promise.resolve([]),
  ]);

  return buildPageResponseFromParts({
    page,
    filters,
    bootstrap,
    transactions,
    baselineHoldings,
    sourceFilings,
    historicalSources,
    reviewQueue,
    instrumentIdentities,
    yearlyExposureSummaries: bootstrap.yearlyExposureSummaries,
    sourceAudit: bootstrap.sourceAudit,
    events,
  });
}

export function buildPageResponseFromParts({
  page,
  filters = {},
  bootstrap,
  transactions = [],
  baselineHoldings = [],
  sourceFilings = [],
  historicalSources = [],
  reviewQueue = [],
  instrumentIdentities = [],
  yearlyExposureSummaries = [],
  sourceAudit,
  events = [],
}: {
  page: TrumpOgePageName;
  filters?: TrumpOgeFilters;
  bootstrap: TrumpOgeBootstrap;
  transactions?: OgeTransaction[];
  baselineHoldings?: BaselineHolding[];
  sourceFilings?: SourceFiling[];
  historicalSources?: HistoricalSource[];
  reviewQueue?: ReviewQueueItem[];
  instrumentIdentities?: InstrumentIdentity[];
  yearlyExposureSummaries?: YearlyExposureSummary[];
  sourceAudit?: SourceAudit;
  events?: OgeEvent[];
}): TrumpOgePageResponse {
  const effectiveFilters = filtersForPage(page, filters);
  const filteredTransactions = transactions.length > 0
    ? filterTransactions(transactions, effectiveFilters)
    : [];
  const kpis = transactions.length > 0
    ? buildKpis({
        sourceFilings,
        transactions: filteredTransactions,
        reviewQueue,
      })
    : bootstrap.kpis;
  const base = {
    page,
    cacheMeta: bootstrap.cacheMeta,
    kpis,
    filters: {
      ...effectiveFilters,
      lateOnly: Boolean(effectiveFilters.lateOnly),
    },
    availableSectors: bootstrap.availableSectors,
    availableAssetTypes: bootstrap.availableAssetTypes,
    availableYears: bootstrap.availableYears,
  };
  const sectorSummaries = pageNeedsSectorSummaries(page)
    ? buildSectorSummaries(filteredTransactions)
    : [];
  const indexBundle = pageNeedsIndex(page)
    ? buildIndexBundle({
        transactions: filteredTransactions,
        baselineHoldings,
        sourceFilings,
        historicalSources,
        filters: effectiveFilters,
      })
    : null;
  const holdings = page === 'holdings'
    ? buildHoldingsEstimates(filteredTransactions, baselineHoldings)
    : indexBundle?.holdings || [];

  if (isAssetPage(page)) {
    return {
      ...base,
      transactions: filteredTransactions,
      holdingsEstimates: holdings,
      sectorSummaries,
      trumpIndex: indexBundle?.trumpIndex.slice(0, PAGE_INDEX_LIMIT) || [],
      trumpIndexRollups: indexBundle?.trumpIndexRollups || [],
      sourceFilings,
      historicalSources: filterHistoricalSources(historicalSources, effectiveFilters),
    };
  }

  switch (page) {
    case 'index':
      return {
      ...base,
      historicalSources: filterHistoricalSources(historicalSources, effectiveFilters),
      sourceAudit: sourceAudit || bootstrap.sourceAudit,
      yearlyExposureSummaries,
      trumpIndex: indexBundle?.trumpIndex.slice(0, PAGE_INDEX_LIMIT) || [],
      trumpIndexRollups: indexBundle?.trumpIndexRollups || [],
      };
    case 'sectors':
      return {
        ...base,
        sectorSummaries,
        trumpIndexRollups: bootstrap.trumpIndexRollups,
      };
    case 'timing':
      return {
        ...base,
        transactions: filteredTransactions,
        historicalSources: filterHistoricalSources(historicalSources, effectiveFilters),
        events,
      };
    case 'holdings':
      return {
        ...base,
        holdingsEstimates: holdings,
      };
    case 'transactions':
      return {
        ...base,
        transactions: filteredTransactions.slice(0, PAGE_TRANSACTION_LIMIT),
      };
    case 'filings':
      return {
        ...base,
        sourceAudit: sourceAudit || bootstrap.sourceAudit,
        historicalSources: filterHistoricalSources(historicalSources, effectiveFilters),
        sourceFilings,
      };
    case 'identifier-review': {
      const filteredIdentities = filterInstrumentIdentities(instrumentIdentities, effectiveFilters);
      return {
        ...base,
        instrumentIdentities: filteredIdentities,
        identifierReview: buildIdentifierReviewItems(filteredIdentities).slice(0, PAGE_REVIEW_LIMIT),
      };
    }
    case 'review':
      return {
        ...base,
        reviewQueue: reviewQueue.slice(0, PAGE_REVIEW_LIMIT),
      };
    default:
      return {
        ...base,
        trumpIndex: bootstrap.trumpIndex,
        trumpIndexRollups: bootstrap.trumpIndexRollups,
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
    'identifier-review',
    'conflicts',
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

function pageNeedsTransactions(page: TrumpOgePageName): boolean {
  return page === 'index' ||
    page === 'holdings' ||
    page === 'sectors' ||
    page === 'timing' ||
    page === 'transactions' ||
    isAssetPage(page);
}

function pageNeedsBaseline(page: TrumpOgePageName): boolean {
  return page === 'holdings' || pageNeedsIndex(page);
}

function pageNeedsIndex(page: TrumpOgePageName): boolean {
  return page === 'index' || isAssetPage(page);
}

function pageNeedsSources(page: TrumpOgePageName): boolean {
  return page === 'index' || page === 'filings' || isAssetPage(page);
}

function pageNeedsSectorSummaries(page: TrumpOgePageName): boolean {
  return page === 'sectors' || isAssetPage(page);
}

function buildIndexBundle({
  transactions,
  baselineHoldings,
  sourceFilings,
  historicalSources,
  filters,
}: {
  transactions: OgeTransaction[];
  baselineHoldings: BaselineHolding[];
  sourceFilings: SourceFiling[];
  historicalSources: HistoricalSource[];
  filters: TrumpOgeFilters;
}) {
  const holdings = buildHoldingsEstimates(transactions, baselineHoldings);
  const filteredHoldings = holdings.filter((holding) => holdingMatchesIndexFilters(holding, filters));
  const index = buildTrumpIndex({
    holdings: filteredHoldings,
    transactions,
    sourceFilings,
    historicalSources,
  });
  const trumpIndex = filterTrumpIndexEntries(index.entries, filters);
  return {
    holdings,
    trumpIndex,
    trumpIndexRollups: buildTrumpIndexRollups(trumpIndex),
  };
}

function holdingMatchesIndexFilters(holding: EstimatedHolding, filters: TrumpOgeFilters): boolean {
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
}

function filterTrumpIndexEntries(entries: TrumpIndexEntry[], filters: TrumpOgeFilters): TrumpIndexEntry[] {
  return entries.filter((entry) => {
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

function filterInstrumentIdentities(identities: InstrumentIdentity[], filters: TrumpOgeFilters): InstrumentIdentity[] {
  return identities.filter((identity) => {
    if (filters.assetType && filters.assetType !== 'All' && identity.assetType !== filters.assetType) return false;
    if (filters.sector && filters.sector !== 'All' && identity.sector !== filters.sector) return false;
    if (filters.sourceReliability && filters.sourceReliability !== 'All' && identity.sourceReliability !== filters.sourceReliability) return false;
    if (filters.issuer) {
      const issuer = String(filters.issuer).trim().toLowerCase();
      const haystack = `${identity.displayName} ${identity.parsedIssuerName || ''}`.toLowerCase();
      if (issuer && !haystack.includes(issuer)) return false;
    }
    const query = filters.query?.trim().toLowerCase();
    if (query) {
      const haystack = [
        identity.displayName,
        identity.parsedIssuerName || '',
        identity.cusip || '',
        identity.isin || '',
        identity.figi || '',
        identity.instrumentReferenceLabel || '',
        identity.instrumentReferenceSource || '',
        identity.instrumentReferenceUrl || '',
        identity.evidenceNote || '',
        identity.reviewReason,
        identity.assetType,
        identity.sector,
      ].join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
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
