"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BadgeInfo,
  Bot,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Database,
  Download,
  ExternalLink,
  FileText,
  Filter,
  Landmark,
  Layers,
  LineChart as LineChartIcon,
  MessageSquare,
  PanelTop,
  RefreshCw,
  Scale,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Table2,
} from 'lucide-react';
import { hierarchy, treemap } from 'd3-hierarchy';
import { scaleLinear } from 'd3-scale';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  buildEventWindows,
  EVENT_CATEGORY_COLORS,
  eventCategoryLabel,
  eventMonth,
  eventWindowBounds,
} from '@/lib/oge/events';
import { filterTransactions } from '@/lib/oge/filter';
import { EMPTY_SECURITY_REFERENCE } from '@/lib/oge/enrichment';
import { EMPTY_FIXED_INCOME_IDENTIFIER_CACHE } from '@/lib/oge/fixed-income-identifiers';
import { formatMoney, formatRange } from '@/lib/oge/amounts';
import { confidenceLabel, describeAssetType, describeSector, describeTransaction, summarizeSector } from '@/lib/oge/descriptions';
import { buildEquityStockSummaries, deriveEquityStockName, type EquityStockSummary } from '@/lib/oge/stocks';
import { buildTrumpOgeWorkbook, trumpOgeWorkbookFilename } from '@/lib/oge/workbook';
import type {
  AssetType,
  CacheMeta,
  EstimatedHolding,
  EventCategory,
  EventWindowSummary,
  HistoricalSource,
  InstrumentIdentity,
  OgeEvent,
  OgeTransaction,
  SectorSummary,
  SourceAudit,
  SourceReliability,
  TransactionType,
  TrumpOgeBootstrap,
  TrumpIndexCitation,
  TrumpIndexEntry,
  TrumpOgeApiResponse,
  TrumpOgeDataset,
  TrumpOgeFilters,
  TrumpOgePageName,
  TrumpOgePageResponse,
} from '@/lib/oge/types';

interface TrumpOgeDashboardProps {
  initialData?: TrumpOgeBootstrap | TrumpOgeApiResponse | null;
}

type PageKey =
  | 'ask'
  | 'index'
  | 'equities'
  | 'corporate-bonds'
  | 'municipal-bonds'
  | 'funds'
  | 'preferred'
  | 'other'
  | 'holdings'
  | 'sectors'
  | 'timing'
  | 'transactions'
  | 'filings'
  | 'identifier-review'
  | 'conflicts'
  | 'review';

interface PageDefinition {
  key: PageKey;
  label: string;
  eyebrow: string;
  description: string;
  assetType?: AssetType;
  icon: React.ReactNode;
}

const PAGE_DEFINITIONS: PageDefinition[] = [
  { key: 'ask', label: 'Ask', eyebrow: 'Interview', description: 'Question the index with cited OpenArena-style markdown answers.', icon: <Bot className="h-4 w-4" /> },
  { key: 'index', label: 'Trump Index', eyebrow: 'Ranked signal', description: 'Ranked exposure, change, activity, citations, and source badges.', icon: <Layers className="h-4 w-4" /> },
  { key: 'equities', label: 'Equity', eyebrow: 'Stocks', description: 'Public-company stock exposure, net buys/sells, tickers, sectors.', assetType: 'Equity', icon: <BriefcaseBusiness className="h-4 w-4" /> },
  { key: 'corporate-bonds', label: 'Corporate Bonds', eyebrow: 'Credit', description: 'Corporate issuer context, coupons, maturities, and flows.', assetType: 'Corporate Bond', icon: <Building2 className="h-4 w-4" /> },
  { key: 'municipal-bonds', label: 'Municipal Bonds', eyebrow: 'Munis', description: 'State/issuer categories and MSRB EMMA reference links.', assetType: 'Municipal Bond', icon: <Landmark className="h-4 w-4" /> },
  { key: 'funds', label: 'ETF/Fund', eyebrow: 'Funds', description: 'Fund and ETF exposure grouped by strategy and direction.', assetType: 'ETF / Fund', icon: <PanelTop className="h-4 w-4" /> },
  { key: 'preferred', label: 'Preferred', eyebrow: 'Hybrid', description: 'Preferred and hybrid securities with fixed-income context.', assetType: 'Preferred / Hybrid', icon: <Sparkles className="h-4 w-4" /> },
  { key: 'other', label: 'Other', eyebrow: 'Unsorted', description: 'Rows that need classification review or do not fit a core class.', assetType: 'Other', icon: <Table2 className="h-4 w-4" /> },
  { key: 'holdings', label: 'Holdings', eyebrow: 'Estimated', description: 'Baseline plus flow-derived holdings bands and confidence flags.', icon: <RefreshCw className="h-4 w-4" /> },
  { key: 'sectors', label: 'Sectors', eyebrow: 'Rollups', description: 'Sector exposure maps, net flow bars, and asset-type mix.', icon: <PanelTop className="h-4 w-4" /> },
  { key: 'timing', label: 'Timing', eyebrow: 'Dates', description: 'Transaction-date flow, late density, and public event overlays.', icon: <LineChartIcon className="h-4 w-4" /> },
  { key: 'transactions', label: 'Transactions', eyebrow: 'Rows', description: 'Searchable transaction table with source PDF links.', icon: <FileText className="h-4 w-4" /> },
  { key: 'filings', label: 'Filings', eyebrow: 'Audit', description: 'Source registry, completeness audit, OGE PDFs, hashes.', icon: <ShieldCheck className="h-4 w-4" /> },
  { key: 'identifier-review', label: 'Identifiers', eyebrow: 'Evidence', description: 'Exact instrument links, CUSIP/FIGI gaps, and publication review priority.', icon: <BadgeInfo className="h-4 w-4" /> },
  { key: 'conflicts', label: 'Conflicts', eyebrow: 'Analysis', description: 'Potential conflicts of interest, policy connections, suspicious timing.', icon: <Scale className="h-4 w-4" /> },
  { key: 'review', label: 'Review', eyebrow: 'Flags', description: 'Parser, baseline, source, and classification issues.', icon: <AlertTriangle className="h-4 w-4" /> },
];

const ASSET_COLORS: Record<string, string> = {
  Equity: '#2563eb',
  'Corporate Bond': '#0f766e',
  'Municipal Bond': '#d97706',
  'ETF / Fund': '#7c3aed',
  'Preferred / Hybrid': '#be123c',
  Other: '#64748b',
};

const FILTER_DEFAULTS: TrumpOgeFilters = {
  year: 'All',
  startDate: '',
  endDate: '',
  assetType: 'All',
  sector: 'All',
  transactionType: 'All',
  sourceReliability: 'All',
  ticker: '',
  issuer: '',
  lateOnly: false,
  query: '',
  confidence: null,
};

const EVENT_CATEGORIES: EventCategory[] = ['tariff', 'fed', 'white-house', 'market', 'company-news', 'truth-social', 'interview', 'reuters', 'manual'];
type TimingRangePreset = 'visible' | 'full' | 'since2025' | 'last24' | 'last12' | 'custom';

interface DateRange {
  startDate: string;
  endDate: string;
  label: string;
}

export function TrumpOgeDashboard({ initialData }: TrumpOgeDashboardProps) {
  const [bootstrap, setBootstrap] = useState<TrumpOgeBootstrap | null>(initialData ? bootstrapFromInitialData(initialData) : null);
  const [initialFullData] = useState<DashboardData | null>(() =>
    initialData && isFullApiResponse(initialData) ? dashboardDataFromFullResponse(initialData) : null
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (initialData || bootstrap) return;
    let cancelled = false;
    loadDashboardBootstrap()
      .then((data) => {
        if (!cancelled) setBootstrap(data);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [bootstrap, initialData]);

  if (!bootstrap) {
    return <DashboardLoading error={loadError} />;
  }

  return <TrumpOgeDashboardLoaded bootstrap={bootstrap} initialFullData={initialFullData} />;
}

function TrumpOgeDashboardLoaded({
  bootstrap,
  initialFullData,
}: {
  bootstrap: TrumpOgeBootstrap;
  initialFullData: DashboardData | null;
}) {
  const mounted = useClientReady();
  const [filters, setFilters] = useState<TrumpOgeFilters>(FILTER_DEFAULTS);
  const [activePage, setActivePage] = useState<PageKey>('ask');
  const [pageResponses, setPageResponses] = useState<Record<string, TrumpOgePageResponse>>({});
  const [pageErrors, setPageErrors] = useState<Record<string, string>>({});
  const inflightPageKeys = useRef(new Set<string>());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [activeEventCategories, setActiveEventCategories] = useState<EventCategory[]>(EVENT_CATEGORIES);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [timingRangePreset, setTimingRangePreset] = useState<TimingRangePreset>('visible');
  const [timingCustomStartDate, setTimingCustomStartDate] = useState('');
  const [timingCustomEndDate, setTimingCustomEndDate] = useState('');
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [selectedIndexIds, setSelectedIndexIds] = useState<string[]>([]);
  const activePageDefinition = PAGE_DEFINITIONS.find((page) => page.key === activePage) || PAGE_DEFINITIONS[0];
  const pageName = pageNameForPageKey(activePage);
  const pageRequestFilters = useMemo(
    () => filtersForPageRequest(activePageDefinition, filters),
    [activePageDefinition, filters]
  );
  const pageCacheKey = useMemo(
    () => pageName ? buildPageCacheKey(pageName, pageRequestFilters, bootstrap.cacheMeta.generatedAt) : '',
    [bootstrap.cacheMeta.generatedAt, pageName, pageRequestFilters]
  );
  const activePageResponse = pageCacheKey ? pageResponses[pageCacheKey] || null : null;
  const activePageNeedsData = activePage !== 'ask';
  const activePageReady = !activePageNeedsData || Boolean(initialFullData || activePageResponse);
  const activePageError = pageCacheKey ? pageErrors[pageCacheKey] || null : null;
  const activePageLoading = activePageNeedsData && !activePageReady && !activePageError;
  const initialData = useMemo(
    () => mergeDashboardData(bootstrap, activePageResponse, initialFullData),
    [activePageResponse, bootstrap, initialFullData]
  );

  useEffect(() => {
    if (!pageName || initialFullData || pageResponses[pageCacheKey] || inflightPageKeys.current.has(pageCacheKey)) return;
    let cancelled = false;
    inflightPageKeys.current.add(pageCacheKey);

    loadPageData(pageName, pageRequestFilters)
      .then((payload) => {
        if (cancelled) return;
        setPageResponses((current) => ({ ...current, [pageCacheKey]: payload }));
        setPageErrors((current) => {
          const next = { ...current };
          delete next[pageCacheKey];
          return next;
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setPageErrors((current) => ({
          ...current,
          [pageCacheKey]: error instanceof Error ? error.message : String(error),
        }));
      })
      .finally(() => {
        inflightPageKeys.current.delete(pageCacheKey);
      });

    return () => {
      cancelled = true;
    };
  }, [initialFullData, pageCacheKey, pageName, pageRequestFilters, pageResponses]);

  const pageFilters = pageRequestFilters;

  const baseFilteredTransactions = useMemo(
    () => filterTransactions(initialData.transactions, pageFilters),
    [pageFilters, initialData.transactions]
  );
  const filteredTransactions = useMemo(
    () => activePageDefinition.assetType
      ? baseFilteredTransactions.filter((tx) => tx.assetType === activePageDefinition.assetType)
      : baseFilteredTransactions,
    [activePageDefinition.assetType, baseFilteredTransactions]
  );
  const kpis = initialData.kpis;
  const sectorSummaries = initialData.sectorSummaries;
  const holdings = initialData.holdingsEstimates;
  const instrumentIdentities = initialData.instrumentIdentities;
  const identifierReview = activePageResponse?.identifierReview || instrumentIdentities.filter((identity) =>
    identity.referenceStatus === 'needs_identifier' || identity.reviewStatus === 'needs_review'
  );
  const trumpIndexEntries = useMemo(
    () => initialData.trumpIndex,
    [initialData.trumpIndex]
  );
  const trumpIndexRollups = initialData.trumpIndexRollups;
  const indexLeaders = useMemo(() => ({
    exposures: [...trumpIndexEntries].sort((a, b) => b.currentMidpoint - a.currentMidpoint).slice(0, 5),
    movers: [...trumpIndexEntries].sort((a, b) => Math.abs(b.changeMidpoint) - Math.abs(a.changeMidpoint)).slice(0, 5),
    netBuys: trumpIndexEntries.filter((entry) => entry.netFlowMidpoint > 0).sort((a, b) => b.netFlowMidpoint - a.netFlowMidpoint).slice(0, 5),
    netSells: trumpIndexEntries.filter((entry) => entry.netFlowMidpoint < 0).sort((a, b) => a.netFlowMidpoint - b.netFlowMidpoint).slice(0, 5),
  }), [trumpIndexEntries]);
  const displayIndexCount = Math.max(trumpIndexEntries.length, kpis.uniqueSecurities);
  const filteredHistoricalSources = useMemo(
    () => initialData.historicalSources.filter((source) => {
      if (filters.year && filters.year !== 'All' && source.reportYear !== Number(filters.year) && !source.filedDate.startsWith(String(filters.year))) return false;
      if (filters.sourceReliability && filters.sourceReliability !== 'All' && source.sourceReliability !== filters.sourceReliability) return false;
      return true;
    }),
    [filters.sourceReliability, filters.year, initialData.historicalSources]
  );
  const equityStocks = useMemo(
    () => buildEquityStockSummaries(filteredTransactions),
    [filteredTransactions]
  );

  const timingDateBounds = useMemo(
    () => buildTimingDateBounds(initialData.transactions, initialData.events, initialData.historicalSources, initialData.cacheMeta),
    [initialData.cacheMeta, initialData.events, initialData.historicalSources, initialData.transactions]
  );
  const timingDateRange = useMemo(
    () => resolveTimingDateRange({
      preset: timingRangePreset,
      filters,
      customStartDate: timingCustomStartDate,
      customEndDate: timingCustomEndDate,
      bounds: timingDateBounds,
      visibleTransactions: filteredTransactions,
    }),
    [filteredTransactions, filters, timingCustomEndDate, timingCustomStartDate, timingDateBounds, timingRangePreset]
  );
  const timingFilters = useMemo<TrumpOgeFilters>(
    () => ({
      ...pageFilters,
      year: 'All',
      startDate: timingDateRange.startDate,
      endDate: timingDateRange.endDate,
    }),
    [pageFilters, timingDateRange.endDate, timingDateRange.startDate]
  );
  const timingTransactions = useMemo(
    () => filterTransactions(initialData.transactions, timingFilters),
    [initialData.transactions, timingFilters]
  );
  const monthlyFlow = useMemo(() => buildMonthlyFlow(timingTransactions), [timingTransactions]);
  const monthlyActivity = useMemo(() => buildMonthlyActivity(timingTransactions), [timingTransactions]);
  const dateScopedEvents = useMemo(
    () => filterEventsForTiming(initialData.events, timingFilters, timingTransactions, initialData.cacheMeta.generatedAt.slice(0, 10)),
    [timingFilters, timingTransactions, initialData.cacheMeta.generatedAt, initialData.events]
  );
  const timingMonthlyFlow = useMemo(
    () => buildTimingMonthlyFlow(monthlyFlow, dateScopedEvents, activeEventCategories, timingDateRange),
    [activeEventCategories, dateScopedEvents, monthlyFlow, timingDateRange]
  );
  const timelineEvents = useMemo(
    () => buildTimelineEvents(dateScopedEvents, timingMonthlyFlow, activeEventCategories),
    [activeEventCategories, dateScopedEvents, timingMonthlyFlow]
  );
  const eventWindows = useMemo(
    () => buildEventWindows(timelineEvents, timingTransactions),
    [timingTransactions, timelineEvents]
  );
  const chartMaxY = useMemo(() => buildChartMaxY(timingMonthlyFlow), [timingMonthlyFlow]);
  const transactionMarkers = useMemo(
    () => buildTransactionMarkers(timingTransactions, timingMonthlyFlow, chartMaxY),
    [chartMaxY, timingTransactions, timingMonthlyFlow]
  );
  const eventMarkers = useMemo(() => buildEventMarkers(timelineEvents, timingMonthlyFlow, chartMaxY), [chartMaxY, timelineEvents, timingMonthlyFlow]);
  const selectedEvent = timelineEvents.find((event) => event.id === selectedEventId) || timelineEvents[0] || null;
  const selectedEventWindows = selectedEvent
    ? eventWindows.filter((window) => window.eventId === selectedEvent.id)
    : [];
  const availableEventCategories = EVENT_CATEGORIES.filter((category) =>
    initialData.events.some((event) => event.category === category)
  );
  const allSectorSummaries = useMemo(
    () => sectorSummaries.filter((summary) => summary.assetType === 'All').slice(0, 12),
    [sectorSummaries]
  );
  const sectorTiles = useMemo(() => buildSectorTiles(allSectorSummaries), [allSectorSummaries]);
  const strongestNetBuys = allSectorSummaries
    .filter((summary) => summary.net.midpoint > 0)
    .sort((a, b) => b.net.midpoint - a.net.midpoint)
    .slice(0, 4);
  const strongestNetSells = allSectorSummaries
    .filter((summary) => summary.net.midpoint < 0)
    .sort((a, b) => a.net.midpoint - b.net.midpoint)
    .slice(0, 4);
  const assetSummary = filteredTransactions.length > 0
    ? buildAssetSummary(filteredTransactions)
    : buildAssetSummaryFromSectorSummaries(sectorSummaries);
  const enrichedTransactionCount = filteredTransactions.length > 0
    ? filteredTransactions.filter((tx) => tx.resolvedTicker).length
    : initialData.cacheMeta.enrichedTransactionCount;
  const issuerContextCount = filteredTransactions.length > 0
    ? filteredTransactions.filter((tx) => !tx.resolvedTicker && (tx.issuerContextTicker || tx.instrumentReferenceLabel)).length
    : initialData.cacheMeta.instrumentContextCount;
  const availableYears = initialData.availableYears;

  const exportWorkbook = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const response = await loadFullApiResponse(filters);
      const workbook = buildTrumpOgeWorkbook(response);
      const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = trumpOgeWorkbookFilename(response);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  };

  const updateFilter = (key: keyof TrumpOgeFilters, value: string | boolean | number | null) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const toggleIndexSelection = (id: string) => {
    setSelectedIndexIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  };

  const toggleEventCategory = (category: EventCategory) => {
    setActiveEventCategories((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category]
    );
  };
  const selectAllEventCategories = () => {
    setActiveEventCategories(EVENT_CATEGORIES);
  };
  const clearEventCategories = () => {
    setActiveEventCategories([]);
  };

  const applyEventWindowFilter = (event: OgeEvent, windowDays: 7 | 30) => {
    const bounds = eventWindowBounds(event, windowDays);
    setFilters((current) => ({
      ...current,
      startDate: bounds.startDate,
      endDate: bounds.endDate,
    }));
  };

  return (
    <main className="liquid-app min-h-screen text-[var(--text-primary)]">
      <header className="liquid-header sticky top-0 z-30">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="liquid-icon flex h-10 w-10 items-center justify-center text-[var(--text-primary)]">
              <Database className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold tracking-tight">Trump Index</h1>
              <div className="text-xs text-slate-300">OGE financial disclosure signal | data through {initialData.cacheMeta.dataThrough || 'pending'} | refreshed {formatDateTime(initialData.cacheMeta.generatedAt)}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="./api/trump-oge"
              className="liquid-button hidden h-9 items-center gap-2 px-3 text-xs font-semibold sm:flex"
            >
              <FileText className="h-3.5 w-3.5" />
              JSON
            </a>
            <button
              type="button"
              onClick={exportWorkbook}
              disabled={exporting}
              className="liquid-button-primary flex h-9 items-center gap-2 px-3 text-xs font-semibold"
            >
              <Download className="h-3.5 w-3.5" />
              {exporting ? 'Exporting...' : 'Export'}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-5 py-5">
        <section className="liquid-panel mb-5 grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-[1.35fr_0.55fr_0.75fr_0.75fr_0.75fr_0.75fr_auto]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-200" />
            <input
              value={filters.query || ''}
              onChange={(event) => updateFilter('query', event.target.value)}
              placeholder="Search security, ticker, issuer context, CIK, sector"
              className="liquid-input h-10 w-full pl-9 pr-3 text-sm outline-none"
            />
          </label>
          <select
            value={filters.year || 'All'}
            onChange={(event) => updateFilter('year', event.target.value)}
            className="liquid-input h-10 px-3 text-sm outline-none"
          >
            <option value="All">All years</option>
            {availableYears.map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
          <input
            value={filters.ticker || ''}
            onChange={(event) => updateFilter('ticker', event.target.value)}
            placeholder="Ticker"
            className="liquid-input h-10 px-3 text-sm uppercase outline-none"
          />
          <input
            value={filters.issuer || ''}
            onChange={(event) => updateFilter('issuer', event.target.value)}
            placeholder="Issuer"
            className="liquid-input h-10 px-3 text-sm outline-none"
          />
          <select
            value={filters.assetType || 'All'}
            onChange={(event) => updateFilter('assetType', event.target.value)}
            className="liquid-input h-10 px-3 text-sm outline-none"
          >
            <option value="All">All asset types</option>
            {initialData.availableAssetTypes.map((assetType) => (
              <option key={assetType} value={assetType}>{assetType}</option>
            ))}
          </select>
          <select
            value={filters.sector || 'All'}
            onChange={(event) => updateFilter('sector', event.target.value)}
            className="liquid-input h-10 px-3 text-sm outline-none"
          >
            <option value="All">All sectors</option>
            {initialData.availableSectors.map((sector) => (
              <option key={sector} value={sector}>{sector}</option>
            ))}
          </select>
          <button
            onClick={() => updateFilter('lateOnly', !filters.lateOnly)}
            className={`liquid-button flex h-10 items-center justify-center gap-2 px-3 text-xs font-semibold ${filters.lateOnly ? 'is-active-warn' : ''}`}
          >
            <Filter className="h-3.5 w-3.5" />
            Late only
          </button>
          <select
            value={filters.transactionType || 'All'}
            onChange={(event) => updateFilter('transactionType', event.target.value)}
            className="liquid-input h-10 px-3 text-sm outline-none xl:col-start-4"
          >
            <option value="All">All actions</option>
            <option value="Purchase">Purchases</option>
            <option value="Sale">Sales</option>
            <option value="Exchange">Exchanges</option>
          </select>
          <select
            value={filters.sourceReliability || 'All'}
            onChange={(event) => updateFilter('sourceReliability', event.target.value)}
            className="liquid-input h-10 px-3 text-sm outline-none"
          >
            <option value="All">All sources</option>
            <option value="official">Official</option>
            <option value="archived_copy">Archived copy</option>
            <option value="metadata_only">Metadata only</option>
          </select>
        </section>

        <nav className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {PAGE_DEFINITIONS.map((page) => (
            <button
              key={page.key}
              onClick={() => setActivePage(page.key)}
              className={`liquid-nav-tile ${activePage === page.key ? 'is-active' : ''}`}
            >
              <span className="flex items-center gap-2">
                {page.icon}
                <span>{page.label}</span>
              </span>
              <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide opacity-70">{page.eyebrow}</span>
            </button>
          ))}
        </nav>

        <PageIntro page={activePageDefinition} transactionCount={filteredTransactions.length || kpis.transactionCount} indexCount={displayIndexCount} />

        {exportError && (
          <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs leading-5 text-amber-900">
            Export failed: {exportError}
          </div>
        )}

        {activePage !== 'ask' && !activePageReady && (
          <Panel title="Loading Page Data" subtitle={activePageLoading ? 'Fetching the page-scoped cache payload' : 'Preparing the page-scoped cache payload'}>
            <div className="space-y-3">
              <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-highlight)]">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-[var(--accent-cyan)]" />
              </div>
              <div className="text-sm leading-6 text-slate-300">
                {activePageError
                  ? `Could not load this page: ${activePageError}`
                  : 'The first screen stays light; this tab loads its heavier cache only when opened.'}
              </div>
            </div>
          </Panel>
        )}

        {activePage !== 'ask' && activePageReady && (
          <>
            <section className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <KpiCard label="Index entries" value={formatInteger(displayIndexCount)} sub={`${formatInteger(kpis.uniqueSecurities)} securities; ${formatInteger(enrichedTransactionCount)} direct, ${formatInteger(issuerContextCount)} issuer/instrument refs`} icon={<Layers className="h-4 w-4" />} />
              <KpiCard label="Visible exposure" value={formatMoney(trumpIndexEntries.reduce((total, entry) => total + entry.currentMidpoint, 0))} sub={`Top score ${trumpIndexEntries[0]?.score.toFixed(1) || '0.0'} of 100`} icon={<RefreshCw className="h-4 w-4" />} />
              <KpiCard label="Purchases" value={formatInteger(kpis.purchaseCount)} sub={`${formatPct(kpis.purchaseCount, kpis.transactionCount)} of visible transactions`} icon={<ArrowUpRight className="h-4 w-4" />} tone="buy" />
              <KpiCard label="Sales" value={formatInteger(kpis.saleCount)} sub={`${formatPct(kpis.saleCount, kpis.transactionCount)} of visible transactions`} icon={<ArrowDownRight className="h-4 w-4" />} tone="sell" />
              <KpiCard label="Late filings" value={formatInteger(kpis.lateCount)} sub={`${formatPct(kpis.lateCount, kpis.transactionCount)} of visible transactions`} icon={<AlertTriangle className="h-4 w-4" />} tone="warn" />
            </section>

            <div className="mb-5 flex items-start gap-2 border border-sky-100 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-900">
              <BadgeInfo className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Visible transactions are the rows left after the active filters. Percentages on the KPI cards use that visible set as the denominator.
                Public matches use SEC and Nasdaq Trader reference data; sector labels from matches are broad SEC/SIC-derived sectors, not GICS.
                Issuer-context tickers explain bond/security issuers and are not direct bond identifiers.
              </span>
            </div>
          </>
        )}

        {activePage === 'ask' && (
          <AskInterviewPage
            filters={filters}
            selectedIndexIds={selectedIndexIds}
            topEntries={trumpIndexEntries.slice(0, 8)}
            sourceAudit={initialData.sourceAudit}
          />
        )}

        {activePageReady && activePageDefinition.assetType && (
          <AssetClassPage
            assetType={activePageDefinition.assetType}
            transactions={filteredTransactions}
            entries={trumpIndexEntries}
            holdings={holdings}
            sectorSummaries={allSectorSummaries}
            equityStocks={equityStocks}
            selectedIds={selectedIndexIds}
            onToggleSelected={toggleIndexSelection}
          />
        )}

        {activePageReady && activePage === 'index' && (
          <div className="space-y-5">
            <Panel
              title="Trump Index"
              subtitle={`Showing top ${formatInteger(trumpIndexEntries.length)} ranked exposures from ${formatInteger(displayIndexCount)} visible securities; score is calculated from exposure, change, and activity`}
            >
              <TrumpIndexTable
                entries={trumpIndexEntries.slice(0, 120)}
                selectedIds={selectedIndexIds}
                onToggleSelected={toggleIndexSelection}
              />
            </Panel>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <IndexLeaderPanel title="Top exposures" entries={indexLeaders.exposures} metric="current" />
              <IndexLeaderPanel title="Top movers" entries={indexLeaders.movers} metric="change" />
              <IndexLeaderPanel title="Net buys" entries={indexLeaders.netBuys} metric="net" tone="buy" />
              <IndexLeaderPanel title="Net sells" entries={indexLeaders.netSells} metric="net" tone="sell" />
            </div>

            <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
              <Panel title="Index Rollups" subtitle="Sector and asset-type exposure totals from visible index entries">
                <IndexRollupBars rollups={trumpIndexRollups} />
              </Panel>
              <Panel title="Source Coverage" subtitle={`${formatInteger(filteredHistoricalSources.length)} historical source records from Jan. 1, 2015 onward`}>
                <SourceCoverageTimeline sources={filteredHistoricalSources} />
              </Panel>
            </div>

            <div className="liquid-panel">
              <button
                type="button"
                onClick={() => setMethodologyOpen((value) => !value)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-bold"
              >
                <span>Index Methodology</span>
                <span className="text-xs font-semibold text-slate-300">{methodologyOpen ? 'Hide' : 'Show'}</span>
              </button>
              {methodologyOpen && (
                <div className="border-t border-white/35 px-4 py-3 text-xs leading-5 text-slate-300">
                  Score = 50% log-scaled current midpoint exposure rank + 30% absolute midpoint change rank + 20% gross transaction activity rank.
                  Confidence, source reliability, archived-copy badges, and metadata-only badges stay visible beside the score but do not reduce it.
                  Event dots are contextual only and are not scoring inputs.
                </div>
              )}
            </div>
          </div>
        )}

        {activePageReady && activePage === 'sectors' && (
          <div className="space-y-5">
            <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
              <Panel title="Sector Exposure Map" subtitle="Tile size is estimated midpoint volume; color is net buying vs selling">
                {mounted ? <SectorTreemap tiles={sectorTiles} /> : <ChartPlaceholder />}
              </Panel>

              <Panel title="Sector Reads" subtitle="Plain-English sector definitions and net direction">
                <div className="grid gap-3">
                  <SectorSignal title="Strongest net buying" tone="buy" summaries={strongestNetBuys} />
                  <SectorSignal title="Strongest net selling" tone="sell" summaries={strongestNetSells} />
                </div>
              </Panel>
            </div>

            <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
              <Panel title="Asset-Type Mix" subtitle="Visible rows by security class">
                <AssetTypeMix rows={assetSummary} total={filteredTransactions.length} />
              </Panel>

              <Panel title="Sector Flow Bars" subtitle="Diverging net flow by sector, with buy and sell context">
                <FlowDivergingBars summaries={allSectorSummaries.slice(0, 14)} />
              </Panel>
            </div>
          </div>
        )}

        {activePageReady && activePage === 'timing' && (
          <TimingPage
            mounted={mounted}
            monthlyFlow={timingMonthlyFlow}
            monthlyActivity={monthlyActivity}
            transactionMarkers={transactionMarkers}
            eventMarkers={eventMarkers}
            dateRange={timingDateRange}
            dateBounds={timingDateBounds}
            rangePreset={timingRangePreset}
            customStartDate={timingCustomStartDate}
            customEndDate={timingCustomEndDate}
            selectedEvent={selectedEvent}
            selectedEventWindows={selectedEventWindows}
            chartMaxY={chartMaxY}
            availableEventCategories={availableEventCategories}
            activeEventCategories={activeEventCategories}
            onRangePresetChange={(preset) => {
              setTimingRangePreset(preset);
              if (preset === 'custom') {
                setTimingCustomStartDate((current) => current || timingDateRange.startDate);
                setTimingCustomEndDate((current) => current || timingDateRange.endDate);
              }
            }}
            onCustomStartDateChange={setTimingCustomStartDate}
            onCustomEndDateChange={setTimingCustomEndDate}
            onSelectEvent={setSelectedEventId}
            onToggleCategory={toggleEventCategory}
            onSelectAllCategories={selectAllEventCategories}
            onClearCategories={clearEventCategories}
            onApplyWindow={applyEventWindowFilter}
            onClearWindow={() => setFilters((current) => ({ ...current, startDate: '', endDate: '' }))}
          />
        )}

        {activePageReady && activePage === 'holdings' && (
          <div className="space-y-5">
            <Panel title="Estimated Holdings" subtitle="Transaction-implied ranges with baseline flags">
              <HoldingsTable holdings={holdings.slice(0, 120)} />
            </Panel>
          </div>
        )}

        {activePageReady && activePage === 'transactions' && (
          <Panel title="Transactions" subtitle={`${formatInteger(filteredTransactions.length)} filtered rows`}>
            <TransactionTable transactions={filteredTransactions.slice(0, 250)} />
          </Panel>
        )}

        {activePageReady && activePage === 'filings' && (
          <div className="space-y-5">
            <Panel title="Source Completeness Audit" subtitle={`${sourceAuditStatusLabel(initialData.sourceAudit.completenessStatus)} | ${formatInteger(initialData.sourceAudit.gaps.length)} historical gaps flagged`}>
              <SourceAuditPanel audit={initialData.sourceAudit} />
            </Panel>

            <Panel title="Historical Source Registry" subtitle={`${filteredHistoricalSources.length} records after source filters; official PDFs, archived copies, and request-only metadata`}>
              <DataTable>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Report</Th>
                    <Th>Reliability</Th>
                    <Th>Title</Th>
                    <Th align="right">Bytes</Th>
                    <Th>SHA-256</Th>
                    <Th>Status</Th>
                    <Th align="right">Source</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistoricalSources.map((source) => (
                    <tr key={source.id}>
                      <Td mono>{source.filedDate}</Td>
                      <Td>
                        <div className="font-semibold">{source.filingType}</div>
                        <div className="text-[11px] text-slate-300">{source.reportYear || 'No report year'}</div>
                      </Td>
                      <Td><StatusPill tone={sourceReliabilityTone(source.sourceReliability)} label={sourceReliabilityLabel(source.sourceReliability)} /></Td>
                      <Td>
                        <div className="max-w-[360px] truncate font-semibold">{source.title}</div>
                        <div className="text-[11px] text-slate-300">{source.provenanceNote}</div>
                      </Td>
                      <Td align="right" mono>{source.bytes ? formatInteger(source.bytes) : 'N/A'}</Td>
                      <Td mono><span className="block max-w-[220px] truncate">{source.sha256 || 'N/A'}</span></Td>
                      <Td><StatusPill tone={source.fetchStatus === 'ok' ? 'ok' : source.fetchStatus === 'failed' ? 'warn' : 'neutral'} label={source.fetchStatus} /></Td>
                      <Td align="right">
                        {source.sourceUrl ? (
                          <a href={source.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-end gap-1 text-xs font-semibold text-sky-700 hover:text-sky-900">
                            Source <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : 'N/A'}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </Panel>

            <Panel title="Current OGE PDF Sources" subtitle={`${initialData.sourceFilings.length} direct OGE source documents`}>
              <DataTable>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Type</Th>
                    <Th>Filename</Th>
                    <Th align="right">Bytes</Th>
                    <Th>SHA-256</Th>
                    <Th>Status</Th>
                    <Th align="right">Source</Th>
                  </tr>
                </thead>
                <tbody>
                  {initialData.sourceFilings.map((filing) => (
                    <tr key={filing.id}>
                      <Td mono>{filing.filedDate}</Td>
                      <Td>{filing.documentType}{filing.isAmendment ? ' amended' : ''}</Td>
                      <Td>
                        <div className="max-w-[320px] truncate font-semibold">{filing.localFilename}</div>
                        <div className="text-[11px] text-slate-300">{filing.notes}</div>
                      </Td>
                      <Td align="right" mono>{filing.bytes ? formatInteger(filing.bytes) : 'N/A'}</Td>
                      <Td mono>
                        <span className="block max-w-[220px] truncate">{filing.sha256 || 'N/A'}</span>
                      </Td>
                      <Td><StatusPill tone={filing.parserStatus === 'failed' ? 'warn' : 'ok'} label={filing.parserStatus} /></Td>
                      <Td align="right">
                        <a href={filing.ogeUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-end gap-1 text-xs font-semibold text-sky-700 hover:text-sky-900">
                          OGE <ExternalLink className="h-3 w-3" />
                        </a>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </Panel>
          </div>
        )}

        {activePageReady && activePage === 'identifier-review' && (
          <IdentifierReviewPage
            identities={instrumentIdentities}
            reviewItems={identifierReview}
            cacheMeta={initialData.cacheMeta}
          />
        )}

        {activePageReady && activePage === 'conflicts' && (
          <ConflictsPage
            transactions={filteredTransactions}
            trumpIndexEntries={trumpIndexEntries}
            filters={filters}
          />
        )}

        {activePageReady && activePage === 'review' && (
          <Panel title="Review Queue" subtitle={`${initialData.reviewQueue.length} parser, baseline, and classification flags`}>
            <div className="grid gap-3 lg:grid-cols-2">
              {initialData.reviewQueue.slice(0, 120).map((item) => (
                <div key={item.id} className="liquid-surface p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <StatusPill tone={item.severity === 'high' ? 'warn' : item.severity === 'medium' ? 'neutral' : 'ok'} label={item.severity} />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">{item.kind}</span>
                  </div>
                  <div className="text-sm font-semibold">{item.title}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-300">{item.detail}</div>
                  {item.sourceUrl && (
                    <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-sky-700">
                      Source <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </main>
  );
}

function DashboardLoading({ error }: { error: string | null }) {
  return (
    <main className="liquid-app flex min-h-screen items-center justify-center px-5 text-[var(--text-primary)]">
      <section className="liquid-panel w-full max-w-lg p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className="liquid-icon flex h-9 w-9 items-center justify-center">
            <Database className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-base font-bold">Trump Index</h1>
            <div className="text-xs text-slate-300">Loading the dashboard bootstrap cache</div>
          </div>
        </div>
        {error ? (
          <div className="border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
            Could not load dashboard data: {error}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-highlight)]">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-[var(--accent-cyan)]" />
            </div>
            <div className="text-sm text-slate-300">Preparing the reporter dashboard...</div>
          </div>
        )}
      </section>
    </main>
  );
}

type DashboardData = TrumpOgeApiResponse & { availableYears: string[] };

async function loadDashboardBootstrap(): Promise<TrumpOgeBootstrap> {
  return fetchJson<TrumpOgeBootstrap>(apiUrl('/api/trump-oge/bootstrap'));
}

async function loadPageData(page: TrumpOgePageName, filters: TrumpOgeFilters): Promise<TrumpOgePageResponse> {
  const params = filtersToSearchParams(filters);
  params.set('name', page);
  return fetchJson<TrumpOgePageResponse>(apiUrl(`/api/trump-oge/page?${params.toString()}`));
}

async function loadFullApiResponse(filters: TrumpOgeFilters): Promise<TrumpOgeApiResponse> {
  const params = filtersToSearchParams(filters);
  params.set('full', 'true');
  return fetchJson<TrumpOgeApiResponse>(apiUrl(`/api/trump-oge?${params.toString()}`));
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message || `HTTP ${response.status}`);
  }
  return await response.json() as T;
}

function apiUrl(pathname: string): string {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
  return `${basePath}${pathname}`;
}

function filtersToSearchParams(filters: TrumpOgeFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    params.set(key, String(value));
  }
  return params;
}

function pageNameForPageKey(page: PageKey): TrumpOgePageName | null {
  return page === 'ask' ? null : page;
}

function filtersForPageRequest(page: PageDefinition, filters: TrumpOgeFilters): TrumpOgeFilters {
  const next = page.assetType ? { ...filters, assetType: page.assetType } : { ...filters };
  if (page.key === 'timing') {
    return {
      ...next,
      year: 'All',
      startDate: '',
      endDate: '',
    };
  }
  return next;
}

function buildPageCacheKey(page: TrumpOgePageName, filters: TrumpOgeFilters, cacheVersion: string): string {
  return `${cacheVersion}|${page}|${filtersToSearchParams(filters).toString()}`;
}

function isFullApiResponse(data: TrumpOgeBootstrap | TrumpOgeApiResponse): data is TrumpOgeApiResponse {
  return 'transactions' in data && Array.isArray(data.transactions);
}

function bootstrapFromInitialData(data: TrumpOgeBootstrap | TrumpOgeApiResponse): TrumpOgeBootstrap {
  if (!isFullApiResponse(data)) return data;
  return {
    cacheMeta: data.cacheMeta,
    kpis: data.kpis,
    filters: data.filters,
    availableSectors: data.availableSectors,
    availableAssetTypes: data.availableAssetTypes,
    availableYears: buildAvailableYearsFromData(data),
    sourceAudit: data.sourceAudit,
    yearlyExposureSummaries: data.yearlyExposureSummaries,
    trumpIndex: data.trumpIndex.slice(0, 80),
    trumpIndexRollups: data.trumpIndexRollups,
    instrumentIdentities: data.instrumentIdentities.slice(0, 80),
  };
}

function dashboardDataFromFullResponse(response: TrumpOgeApiResponse): DashboardData {
  return {
    ...response,
    availableYears: buildAvailableYearsFromData(response),
  };
}

function mergeDashboardData(
  bootstrap: TrumpOgeBootstrap,
  page: TrumpOgePageResponse | null,
  fullData: DashboardData | null
): DashboardData {
  if (fullData) return fullData;
  return {
    historicalSources: page?.historicalSources || [],
    sourceFilings: page?.sourceFilings || [],
    transactions: page?.transactions || [],
    baselineHoldings: page?.baselineHoldings || [],
    financialDisclosureReports: page?.financialDisclosureReports || [],
    assetIncomeHoldings: page?.assetIncomeHoldings || [],
    liabilities: page?.liabilities || [],
    yearlyExposureSummaries: page?.yearlyExposureSummaries || bootstrap.yearlyExposureSummaries,
    sourceAudit: page?.sourceAudit || bootstrap.sourceAudit,
    holdingsEstimates: page?.holdingsEstimates || [],
    sectorSummaries: page?.sectorSummaries || [],
    trumpIndex: page?.trumpIndex || bootstrap.trumpIndex,
    trumpIndexRollups: page?.trumpIndexRollups || bootstrap.trumpIndexRollups,
    instrumentIdentities: page?.instrumentIdentities || bootstrap.instrumentIdentities,
    reviewQueue: page?.reviewQueue || [],
    events: page?.events || [],
    eventWindows: page?.eventWindows || [],
    securityReference: EMPTY_SECURITY_REFERENCE,
    securityEnrichments: page?.securityEnrichments || [],
    fixedIncomeIdentifiers: EMPTY_FIXED_INCOME_IDENTIFIER_CACHE,
    cacheMeta: bootstrap.cacheMeta,
    kpis: page?.kpis || bootstrap.kpis,
    filters: page?.filters || bootstrap.filters,
    availableSectors: page?.availableSectors || bootstrap.availableSectors,
    availableAssetTypes: page?.availableAssetTypes || bootstrap.availableAssetTypes,
    availableYears: page?.availableYears || bootstrap.availableYears,
  };
}

function buildAvailableYearsFromData(data: Pick<TrumpOgeDataset, 'transactions' | 'historicalSources'>): string[] {
  return Array.from(new Set([
    ...data.transactions.map((tx) => tx.date.slice(0, 4)),
    ...data.historicalSources.map((source) => source.reportYear ? String(source.reportYear) : source.filedDate.slice(0, 4)),
  ].filter(Boolean))).sort((a, b) => b.localeCompare(a));
}

function useClientReady() {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false
  );
}

function ChartPlaceholder() {
  return <div className="liquid-empty h-full w-full" />;
}

function PageIntro({
  page,
  transactionCount,
  indexCount,
}: {
  page: PageDefinition;
  transactionCount: number;
  indexCount: number;
}) {
  return (
    <section className="liquid-hero mb-5 px-5 py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <div className="liquid-surface mb-2 inline-flex items-center gap-2 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-300">
            {page.icon}
            {page.eyebrow}
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">{page.label}</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{page.description}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <MiniStat label="Rows" value={formatInteger(transactionCount)} />
          <MiniStat label="Index" value={formatInteger(indexCount)} />
          <MiniStat label="Scope" value={page.assetType || 'All'} />
        </div>
      </div>
    </section>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="liquid-surface px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">{label}</div>
      <div className="mt-1 max-w-[160px] truncate font-mono text-sm font-bold text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

function AskInterviewPage({
  filters,
  selectedIndexIds,
  topEntries,
  sourceAudit,
}: {
  filters: TrumpOgeFilters;
  selectedIndexIds: string[];
  topEntries: TrumpIndexEntry[];
  sourceAudit: SourceAudit;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
      <AskTrumpIndexPanel
        filters={filters}
        selectedIndexIds={selectedIndexIds}
        topEntries={topEntries}
        interview
      />
      <div className="space-y-5">
        <Panel title="Briefing Context" subtitle="What the assistant receives as deterministic facts">
          <div className="space-y-3 text-sm leading-6 text-slate-300">
            <div className="liquid-surface p-3">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-300">Current facts packet</div>
              <div className="mt-2 text-sm">
                {formatInteger(selectedIndexIds.length || topEntries.length)} selected or top-ranked index entries, active filters, cache version, citations, and caveats.
              </div>
            </div>
            <div className="liquid-surface p-3">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-300">Completeness</div>
              <div className="mt-2">
                {sourceAuditStatusLabel(sourceAudit.completenessStatus)}; {formatInteger(sourceAudit.gaps.length)} historical gap{sourceAudit.gaps.length === 1 ? '' : 's'} flagged.
              </div>
            </div>
          </div>
        </Panel>
        <Panel title="Starter Questions" subtitle="Fast prompts for story framing">
          <div className="space-y-2 text-sm leading-5 text-slate-700">
            {[
              'Which index entries have the strongest net-buy signal and usable citations?',
              'Which corporate bond issuers need the most review before publication?',
              'What changed most after applying the current filters?',
              'Where does the source audit limit the story claim?',
            ].map((prompt) => (
              <div key={prompt} className="liquid-surface px-3 py-2">{prompt}</div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function AssetClassPage({
  assetType,
  transactions,
  entries,
  holdings,
  sectorSummaries,
  equityStocks,
  selectedIds,
  onToggleSelected,
}: {
  assetType: AssetType;
  transactions: OgeTransaction[];
  entries: TrumpIndexEntry[];
  holdings: EstimatedHolding[];
  sectorSummaries: SectorSummary[];
  equityStocks: EquityStockSummary[];
  selectedIds: string[];
  onToggleSelected: (id: string) => void;
}) {
  const purchaseMidpoint = transactions.filter((tx) => tx.type === 'Purchase').reduce((total, tx) => total + tx.amount.midpoint, 0);
  const saleMidpoint = transactions.filter((tx) => tx.type === 'Sale').reduce((total, tx) => total + tx.amount.midpoint, 0);
  const assetHoldings = holdings.filter((holding) => holding.assetType === assetType);
  const assetSectors = sectorSummaries.filter((summary) => summary.assetType === 'All' || summary.assetType === assetType);
  const title = `${assetType} Index`;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <Panel title={`${assetType} Signal Cloud`} subtitle="Score versus current exposure; bubble size reflects transaction activity">
          <IndexSignalCloud entries={entries.slice(0, 80)} />
        </Panel>
        <Panel title={`${assetType} Flow`} subtitle="Purchase and sale midpoints in the current filters">
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard label="Purchases" value={formatMoney(purchaseMidpoint)} tone="buy" />
            <MetricCard label="Sales" value={formatMoney(saleMidpoint)} tone="sell" />
            <MetricCard label="Net" value={formatSignedMoney(purchaseMidpoint - saleMidpoint)} tone={purchaseMidpoint >= saleMidpoint ? 'buy' : 'sell'} />
          </div>
          <div className="mt-5">
            <FlowDivergingBars summaries={assetSectors.slice(0, 10)} />
          </div>
        </Panel>
      </div>

      {assetType === 'Equity' && (
        <Panel title="Equity Stocks Bought" subtitle="Resolved public-company stocks with net buy, net sale, or hold status">
          <EquityStockTable stocks={equityStocks.slice(0, 160)} />
        </Panel>
      )}

      <Panel title={title} subtitle={`${formatInteger(entries.length)} ranked ${assetType.toLowerCase()} entries`}>
        <TrumpIndexTable entries={entries.slice(0, 120)} selectedIds={selectedIds} onToggleSelected={onToggleSelected} />
      </Panel>

      <Panel title={`${assetType} Holdings`} subtitle={`${formatInteger(assetHoldings.length)} estimated holding bands`}>
        <HoldingsTable holdings={assetHoldings.slice(0, 100)} />
      </Panel>
    </div>
  );
}

function IdentifierReviewPage({
  identities,
  reviewItems,
  cacheMeta,
}: {
  identities: InstrumentIdentity[];
  reviewItems: InstrumentIdentity[];
  cacheMeta: CacheMeta;
}) {
  const exactCount = identities.filter((identity) => identity.referenceStatus === 'exact' && identity.instrumentReferenceUrl).length;
  const needsIdentifierCount = identities.filter((identity) => identity.referenceStatus === 'needs_identifier').length;
  const needsReviewCount = identities.filter((identity) => identity.reviewStatus === 'needs_review').length;
  const baselineMatched = cacheMeta.annualBaselineMatchedCount || 0;
  const baselineMissing = cacheMeta.annualBaselineMissingCount || 0;
  const baselineTotal = baselineMatched + baselineMissing;

  return (
    <div className="space-y-5">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <KpiCard label="Exact links" value={formatInteger(exactCount || cacheMeta.exactInstrumentReferenceCount)} sub={`${formatPct(exactCount || cacheMeta.exactInstrumentReferenceCount, identities.length || cacheMeta.instrumentIdentityCount)} of instrument identities`} icon={<ExternalLink className="h-4 w-4" />} tone="buy" />
        <KpiCard label="FIGI matches" value={formatInteger(cacheMeta.fixedIncomeFigiMatchCount || identities.filter((identity) => identity.figi).length)} sub={`${formatInteger(cacheMeta.fixedIncomeIdentifierAmbiguousCount || 0)} ambiguous OpenFIGI candidate sets`} icon={<Database className="h-4 w-4" />} tone="buy" />
        <KpiCard label="Need identifiers" value={formatInteger(needsIdentifierCount || cacheMeta.identifierReviewCount)} sub="CUSIP, ISIN, or FIGI required before exact links" icon={<AlertTriangle className="h-4 w-4" />} tone="warn" />
        <KpiCard label="Need review" value={formatInteger(needsReviewCount)} sub="Parsed IDs or evidence not yet publication-reviewed" icon={<BadgeInfo className="h-4 w-4" />} />
        <KpiCard label="Baseline matched" value={formatInteger(baselineMatched)} sub={`${formatPct(baselineMatched, baselineTotal)} of holding estimates`} icon={<ShieldCheck className="h-4 w-4" />} tone="buy" />
        <KpiCard label="Baseline missing" value={formatInteger(baselineMissing)} sub="Still transaction-implied" icon={<RefreshCw className="h-4 w-4" />} tone="warn" />
      </section>

      <Panel title="Identifier Review" subtitle={`${formatInteger(reviewItems.length)} prioritized rows needing identifier or evidence review`}>
        <IdentifierReviewTable rows={reviewItems.slice(0, 250)} />
      </Panel>

      <Panel title="Instrument Identity Register" subtitle={`${formatInteger(identities.length)} exact, issuer-context, and unresolved instrument identity rows`}>
        <IdentifierReviewTable rows={identities.slice(0, 250)} showResolved />
      </Panel>
    </div>
  );
}

interface ConflictAnalysis {
  generatedAt: string;
  indicators: ConflictIndicator[];
  summary: ConflictSummary;
}

interface ConflictIndicator {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  title: string;
  summary: string;
  holdingTicker: string | null;
  holdingName: string;
  holdingValue: number;
  eventId: string | null;
  eventDate: string | null;
  eventTitle: string | null;
  transactionIds: string[];
  transactionDates: string[];
  windowDays: number | null;
  timelinePosition: 'before' | 'after' | 'during' | null;
  evidenceStrength: number;
  sourceUrls: string[];
  tags: string[];
}

interface ConflictSummary {
  totalIndicators: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  totalExposureAtRisk: number;
  uniqueHoldings: number;
  uniqueEvents: number;
  dateRange: { start: string; end: string } | null;
}

function ConflictsPage({
  transactions,
  trumpIndexEntries,
  filters,
}: {
  transactions: OgeTransaction[];
  trumpIndexEntries: TrumpIndexEntry[];
  filters: TrumpOgeFilters;
}) {
  const [analysis, setAnalysis] = useState<ConflictAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = filtersToSearchParams(filters);
    const endpoint = apiUrl(`/api/trump-oge/conflicts?${params.toString()}`);

    fetch(endpoint)
      .then(async (response) => {
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(text || `HTTP ${response.status}`);
        }
        return response.json() as Promise<ConflictAnalysis>;
      })
      .then((data) => {
        if (!cancelled) setAnalysis(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filters]);

  const filteredIndicators = useMemo(() => {
    if (!analysis) return [];
    return analysis.indicators.filter((indicator) => {
      if (selectedSeverity !== 'all' && indicator.severity !== selectedSeverity) return false;
      if (selectedCategory !== 'all' && indicator.category !== selectedCategory) return false;
      return true;
    });
  }, [analysis, selectedCategory, selectedSeverity]);

  const categories = useMemo(() => {
    if (!analysis) return [];
    return Array.from(new Set(analysis.indicators.map((indicator) => indicator.category))).sort();
  }, [analysis]);

  if (loading) {
    return (
      <Panel title="Conflict Analysis" subtitle="Analyzing potential conflicts of interest">
        <div className="space-y-3">
          <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-highlight)]">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-[var(--accent-cyan)]" />
          </div>
          <div className="text-sm text-slate-300">Cross-referencing holdings with policy decisions and events...</div>
        </div>
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel title="Conflict Analysis" subtitle="Error loading analysis">
        <div className="border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
          {error}
        </div>
      </Panel>
    );
  }

  if (!analysis || analysis.indicators.length === 0) {
    return (
      <Panel title="Conflict Analysis" subtitle="No conflict indicators found">
        <div className="liquid-empty p-6 text-center text-sm text-slate-300">
          No potential conflicts of interest detected in the current filter scope.
          <div className="mt-2 text-xs">This may change as more events and policy decisions are catalogued.</div>
        </div>
      </Panel>
    );
  }

  const { summary } = analysis;

  return (
    <div className="space-y-5">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          label="Critical conflicts"
          value={formatInteger(summary.criticalCount)}
          sub="Highest severity indicators"
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={summary.criticalCount > 0 ? 'warn' : 'neutral'}
        />
        <KpiCard
          label="High severity"
          value={formatInteger(summary.highCount)}
          sub="Strong evidence conflicts"
          icon={<Scale className="h-4 w-4" />}
          tone={summary.highCount > 0 ? 'warn' : 'neutral'}
        />
        <KpiCard
          label="Total indicators"
          value={formatInteger(summary.totalIndicators)}
          sub={`${formatInteger(summary.uniqueHoldings)} holdings, ${formatInteger(summary.uniqueEvents)} events`}
          icon={<Layers className="h-4 w-4" />}
        />
        <KpiCard
          label="Exposure at risk"
          value={formatMoney(summary.totalExposureAtRisk)}
          sub="Combined holding value in conflicts"
          icon={<BriefcaseBusiness className="h-4 w-4" />}
        />
        <KpiCard
          label="Date range"
          value={summary.dateRange ? `${summary.dateRange.start.slice(0, 7)}` : 'N/A'}
          sub={summary.dateRange ? `through ${summary.dateRange.end.slice(0, 7)}` : 'No date range'}
          icon={<CalendarDays className="h-4 w-4" />}
        />
      </section>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 backdrop-blur-xl">
        <span className="text-xs font-semibold text-[var(--text-tertiary)]">Filter:</span>
        <select
          value={selectedSeverity}
          onChange={(event) => setSelectedSeverity(event.target.value)}
          className="liquid-input h-9 px-3 text-sm"
        >
          <option value="all">All severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          value={selectedCategory}
          onChange={(event) => setSelectedCategory(event.target.value)}
          className="liquid-input h-9 px-3 text-sm"
        >
          <option value="all">All categories</option>
          {categories.map((category) => (
            <option key={category} value={category}>{conflictCategoryLabel(category)}</option>
          ))}
        </select>
        <span className="ml-auto text-xs text-slate-300">
          Showing {formatInteger(filteredIndicators.length)} of {formatInteger(analysis.indicators.length)} indicators
        </span>
      </div>

      <Panel
        title="Conflict Indicators"
        subtitle={`${formatInteger(filteredIndicators.length)} potential conflicts of interest flagged for review`}
      >
        <div className="space-y-3">
          {filteredIndicators.slice(0, 50).map((indicator) => (
            <ConflictIndicatorCard key={indicator.id} indicator={indicator} />
          ))}
        </div>
      </Panel>

      <div className="liquid-panel p-4">
        <div className="flex items-start gap-3">
          <BadgeInfo className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" />
          <div className="text-xs leading-5 text-slate-300">
            <strong className="font-bold text-slate-800">Methodology note:</strong> Conflict indicators are generated algorithmically by cross-referencing disclosed holdings with public policy events, statements, and market-moving announcements.
            The presence of a conflict indicator does not imply wrongdoing, insider trading, or ethical violations.
            These flags are intended for journalistic review and further investigation.
            Evidence strength scores reflect data completeness, not certainty of impropriety.
          </div>
        </div>
      </div>
    </div>
  );
}

function ConflictIndicatorCard({ indicator }: { indicator: ConflictIndicator }) {
  const severityTone = (severity: string): 'warn' | 'neutral' | 'ok' => {
    if (severity === 'critical' || severity === 'high') return 'warn';
    if (severity === 'medium') return 'neutral';
    return 'ok';
  };

  return (
    <div className="liquid-surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <StatusPill tone={severityTone(indicator.severity)} label={indicator.severity} />
        <StatusPill tone="neutral" label={conflictCategoryLabel(indicator.category)} />
        {indicator.timelinePosition && (
          <span className="rounded-full bg-[var(--bg-interactive)] px-2 py-1 text-[11px] font-semibold text-[var(--text-secondary)] ring-1 ring-[var(--border-subtle)]">
            {indicator.timelinePosition === 'before' ? 'Traded before event' : indicator.timelinePosition === 'after' ? 'Traded after event' : 'Traded during event'}
          </span>
        )}
        <span className="ml-auto font-mono text-xs text-slate-300">
          Evidence: {(indicator.evidenceStrength * 100).toFixed(0)}%
        </span>
      </div>

      <h3 className="text-sm font-bold text-[var(--text-primary)]">{indicator.title}</h3>
      <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{indicator.summary}</p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="liquid-surface p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-300">Holding</div>
          <div className="mt-1 font-semibold">{indicator.holdingName}</div>
          {indicator.holdingTicker && (
            <div className="text-xs font-semibold text-sky-800">{indicator.holdingTicker}</div>
          )}
          <div className="mt-1 font-mono text-xs text-slate-300">{formatMoney(indicator.holdingValue)} exposure</div>
        </div>

        {indicator.eventTitle && (
          <div className="liquid-surface p-3">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-300">Related Event</div>
            <div className="mt-1 font-semibold">{indicator.eventTitle}</div>
            {indicator.eventDate && (
              <div className="font-mono text-xs text-slate-300">{indicator.eventDate}</div>
            )}
            {indicator.windowDays && (
              <div className="text-xs text-slate-300">Within {indicator.windowDays} day window</div>
            )}
          </div>
        )}
      </div>

      {indicator.transactionDates.length > 0 && (
        <div className="mt-3 text-xs text-slate-300">
          <span className="font-semibold">Related transactions:</span> {indicator.transactionDates.slice(0, 5).join(', ')}
          {indicator.transactionDates.length > 5 && ` and ${indicator.transactionDates.length - 5} more`}
        </div>
      )}

      {indicator.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {indicator.tags.slice(0, 6).map((tag) => (
            <span key={tag} className="rounded-full bg-[var(--bg-highlight)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-tertiary)]">
              {tag}
            </span>
          ))}
        </div>
      )}

      {indicator.sourceUrls.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {indicator.sourceUrls.slice(0, 3).map((url, index) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700"
            >
              Source {index + 1} <ExternalLink className="h-3 w-3" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function conflictCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    'tariff-holding': 'Tariff Policy',
    'regulatory-holding': 'Regulatory',
    'government-contract': 'Gov. Contract',
    'suspicious-timing': 'Suspicious Timing',
    'market-moving-statement': 'Market Statement',
    'cabinet-connection': 'Cabinet Connection',
    'foreign-policy': 'Foreign Policy',
    'fed-rate-sensitive': 'Fed Rate Sensitive',
  };
  return labels[category] || category.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function IdentifierReviewTable({ rows, showResolved = false }: { rows: InstrumentIdentity[]; showResolved?: boolean }) {
  if (rows.length === 0) {
    return <div className="liquid-empty p-6 text-sm text-slate-300">No instrument identity rows match the current filters.</div>;
  }

  return (
    <DataTable>
      <thead>
        <tr>
          <Th>Priority</Th>
          <Th>Instrument</Th>
          <Th>Identifiers</Th>
          <Th>Status</Th>
          <Th>Evidence</Th>
          <Th align="right">Exposure</Th>
          <Th align="right">Rows</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((identity) => (
          <tr key={identity.id}>
            <Td align="right" mono>{identity.reviewPriority.toFixed(1)}</Td>
            <Td>
              <div className="max-w-[360px] truncate font-semibold">{identity.displayName}</div>
              <div className="text-[11px] leading-4 text-slate-300">{identity.assetType} | {identity.sector}</div>
              {(identity.parsedIssuerName || identity.coupon || identity.maturityDate) && (
                <div className="max-w-[420px] text-[11px] leading-4 text-slate-300">
                  {[identity.parsedIssuerName, identity.coupon !== null ? `${identity.coupon}%` : '', identity.maturityDate].filter(Boolean).join(' | ')}
                </div>
              )}
              {(identity.issuerState || identity.issuerCategory) && (
                <div className="text-[11px] leading-4 text-slate-300">{[identity.issuerState, identity.issuerCategory].filter(Boolean).join(' | ')}</div>
              )}
            </Td>
            <Td>
              <div className="space-y-1 font-mono text-[11px]">
                <div>CUSIP {identity.cusip || 'needed'}</div>
                <div>ISIN {identity.isin || 'needed'}</div>
                <div>FIGI {identity.figi || 'needed'}</div>
              </div>
            </Td>
            <Td>
              <div className="space-y-1">
                <StatusPill tone={identity.referenceStatus === 'exact' ? 'ok' : identity.referenceStatus === 'needs_identifier' ? 'warn' : 'neutral'} label={referenceStatusLabel(identity.referenceStatus)} />
                <StatusPill tone={identity.reviewStatus === 'verified' ? 'ok' : identity.reviewStatus === 'rejected' ? 'warn' : 'neutral'} label={identity.reviewStatus.replace(/_/g, ' ')} />
                {showResolved && <div className="text-[11px] leading-4 text-slate-300">{identity.reviewReason}</div>}
              </div>
            </Td>
            <Td>
              {identity.instrumentReferenceUrl ? (
                <a href={identity.instrumentReferenceUrl} target="_blank" rel="noreferrer" className="inline-flex max-w-[260px] items-center gap-1 truncate text-xs font-semibold text-sky-700">
                  {identity.instrumentReferenceLabel || 'Instrument'} <ExternalLink className="h-3 w-3" />
                </a>
              ) : identity.instrumentReferenceLabel ? (
                <div className="max-w-[260px] truncate text-xs font-semibold text-slate-700">{identity.instrumentReferenceLabel}</div>
              ) : (
                <div className="text-xs font-semibold text-amber-700">Needs CUSIP/FIGI</div>
              )}
              {identity.evidenceSourceUrl && (
                <a href={identity.evidenceSourceUrl} target="_blank" rel="noreferrer" className="mt-1 block max-w-[260px] truncate text-[11px] font-semibold text-sky-700">
                  Evidence source <ExternalLink className="inline h-3 w-3" />
                </a>
              )}
              <div className="max-w-[320px] text-[11px] leading-4 text-slate-300">{identity.evidenceNote || identity.reviewReason}</div>
            </Td>
            <Td align="right" mono>{formatMoney(identity.currentMidpoint)}</Td>
            <Td align="right">
              <div className="font-mono text-xs">{formatInteger(identity.transactionCount)}</div>
              <div className="text-[11px] text-slate-300">{formatInteger(identity.filingCount)} filings</div>
            </Td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: 'buy' | 'sell' | 'neutral' }) {
  const color = tone === 'buy' ? 'text-emerald-700' : tone === 'sell' ? 'text-rose-700' : 'text-slate-800';
  return (
    <div className="liquid-surface p-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-300">{label}</div>
      <div className={`mt-2 font-mono text-xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function AssetTypeMix({ rows, total }: { rows: Array<{ assetType: AssetType; count: number }>; total: number }) {
  return (
    <div className="space-y-4">
      {rows.map((row, index) => (
        <div key={`${row.assetType}-${index}`}>
          <div className="mb-1 flex items-center justify-between gap-3 text-xs">
            <span className="font-semibold">{row.assetType}</span>
            <span className="font-mono text-slate-300">{formatInteger(row.count)} rows</span>
          </div>
          <div className="h-2.5 rounded-full bg-[var(--bg-highlight)]">
            <div
              className="h-2.5 rounded-full"
              style={{
                width: `${Math.max(3, (row.count / Math.max(1, total)) * 100)}%`,
                backgroundColor: ASSET_COLORS[row.assetType] || '#64748b',
              }}
            />
          </div>
          <div className="mt-1 text-[11px] leading-4 text-slate-300">{describeAssetType(row.assetType)}</div>
        </div>
      ))}
    </div>
  );
}

function FlowDivergingBars({ summaries }: { summaries: SectorSummary[] }) {
  const maxNet = Math.max(1, ...summaries.map((summary) => Math.abs(summary.net.midpoint)));
  return (
    <div className="space-y-3">
      {summaries.length === 0 && <div className="liquid-empty p-4 text-sm text-slate-300">No sector flow for this page.</div>}
      {summaries.map((summary) => {
        const isBuy = summary.net.midpoint >= 0;
        const width = Math.max(4, (Math.abs(summary.net.midpoint) / maxNet) * 50);
        return (
          <div key={`${summary.key}-${summary.assetType}`} className="grid grid-cols-[minmax(110px,0.7fr)_minmax(180px,1.3fr)_92px] items-center gap-3 text-xs">
            <div className="truncate font-semibold">{summary.sector}</div>
            <div className="relative h-7 rounded-full bg-[var(--bg-highlight)]">
              <div className="absolute left-1/2 top-1 h-5 w-px bg-slate-300" />
              <div
                className={`absolute top-1 h-5 rounded-full ${isBuy ? 'left-1/2 bg-emerald-500' : 'right-1/2 bg-rose-500'}`}
                style={{ width: `${width}%` }}
              />
            </div>
            <div className={`text-right font-mono font-semibold ${isBuy ? 'text-emerald-700' : 'text-rose-700'}`}>{formatSignedMoney(summary.net.midpoint)}</div>
          </div>
        );
      })}
    </div>
  );
}

function IndexSignalCloud({ entries }: { entries: TrumpIndexEntry[] }) {
  const width = 760;
  const height = 340;
  if (entries.length === 0) {
    return <div className="liquid-empty flex h-[340px] items-center justify-center text-sm text-slate-300">No index entries for this asset class.</div>;
  }

  const maxExposure = Math.max(1, ...entries.map((entry) => entry.currentMidpoint));
  const maxActivity = Math.max(1, ...entries.map((entry) => entry.purchaseMidpoint + entry.saleMidpoint));
  const xScale = scaleLinear().domain([0, Math.log10(maxExposure + 1)]).range([58, width - 28]);
  const yScale = scaleLinear().domain([0, 100]).range([height - 42, 22]);
  const rScale = scaleLinear().domain([0, Math.sqrt(maxActivity)]).range([4, 18]);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Trump Index signal cloud" className="h-[340px] w-full">
      <rect x={0} y={0} width={width} height={height} rx={24} fill="rgba(255,255,255,0.28)" />
      {[25, 50, 75].map((score) => (
        <g key={score}>
          <line x1={52} x2={width - 22} y1={yScale(score)} y2={yScale(score)} stroke="rgba(100,116,139,0.22)" />
          <text x={16} y={yScale(score) + 4} fontSize={11} fill="#64748b">{score}</text>
        </g>
      ))}
      {entries.map((entry) => {
        const x = xScale(Math.log10(entry.currentMidpoint + 1));
        const y = yScale(entry.score);
        const activity = Math.sqrt(entry.purchaseMidpoint + entry.saleMidpoint);
        const fill = entry.netFlowMidpoint >= 0 ? '#10b981' : '#f43f5e';
        return (
          <g key={entry.id}>
            <circle cx={x} cy={y} r={rScale(activity)} fill={fill} opacity={0.68} stroke="rgba(255,255,255,0.9)" strokeWidth={1.5}>
              <title>{`${entry.displayName}: score ${entry.score.toFixed(1)}, current ${formatMoney(entry.currentMidpoint)}, net ${formatSignedMoney(entry.netFlowMidpoint)}`}</title>
            </circle>
          </g>
        );
      })}
      <text x={58} y={height - 12} fontSize={11} fill="#64748b">lower exposure</text>
      <text x={width - 118} y={height - 12} fontSize={11} fill="#64748b">higher exposure</text>
      <text x={14} y={18} fontSize={11} fill="#64748b">score</text>
    </svg>
  );
}

function TimingPage({
  mounted,
  monthlyFlow,
  monthlyActivity,
  transactionMarkers,
  eventMarkers,
  dateRange,
  dateBounds,
  rangePreset,
  customStartDate,
  customEndDate,
  selectedEvent,
  selectedEventWindows,
  chartMaxY,
  availableEventCategories,
  activeEventCategories,
  onRangePresetChange,
  onCustomStartDateChange,
  onCustomEndDateChange,
  onSelectEvent,
  onToggleCategory,
  onSelectAllCategories,
  onClearCategories,
  onApplyWindow,
  onClearWindow,
}: {
  mounted: boolean;
  monthlyFlow: TimingFlowRow[];
  monthlyActivity: MonthActivityRow[];
  transactionMarkers: TransactionMarker[];
  eventMarkers: EventMarker[];
  dateRange: DateRange;
  dateBounds: DateRange;
  rangePreset: TimingRangePreset;
  customStartDate: string;
  customEndDate: string;
  selectedEvent: OgeEvent | null;
  selectedEventWindows: EventWindowSummary[];
  chartMaxY: number;
  availableEventCategories: EventCategory[];
  activeEventCategories: EventCategory[];
  onRangePresetChange: (preset: TimingRangePreset) => void;
  onCustomStartDateChange: (value: string) => void;
  onCustomEndDateChange: (value: string) => void;
  onSelectEvent: (id: string) => void;
  onToggleCategory: (category: EventCategory) => void;
  onSelectAllCategories: () => void;
  onClearCategories: () => void;
  onApplyWindow: (event: OgeEvent, windowDays: 7 | 30) => void;
  onClearWindow: () => void;
}) {
  const chartRows = useMemo<TimingChartRow[]>(
    () => monthlyFlow.map((row, index) => ({ ...row, monthIndex: index })),
    [monthlyFlow]
  );
  const monthLabelByIndex = useMemo(
    () => new Map(chartRows.map((row) => [row.monthIndex, row.month])),
    [chartRows]
  );
  const xAxisTicks = useMemo(
    () => selectTimelineTicks(chartRows.map((row) => row.monthIndex)),
    [chartRows]
  );
  const eventCounts = useMemo(
    () => availableEventCategories
      .map((category) => ({
        category,
        count: eventMarkers.filter((marker) => marker.category === category).length,
        active: activeEventCategories.includes(category),
      }))
      .filter((row) => row.count > 0 || row.active),
    [activeEventCategories, availableEventCategories, eventMarkers]
  );
  const visibleEventCount = eventMarkers.length;
  const chartEventPins = useMemo(
    () => buildChartEventPins(eventMarkers, selectedEvent?.id || null),
    [eventMarkers, selectedEvent?.id]
  );
  const transactionTypeOptions = useMemo(
    () => buildTransactionTypeOptions(transactionMarkers),
    [transactionMarkers]
  );
  const transactionSectorOptions = useMemo(
    () => buildTransactionSectorOptions(transactionMarkers),
    [transactionMarkers]
  );
  const [activeTransactionTypes, setActiveTransactionTypes] = useState<TransactionType[]>(['Purchase', 'Sale']);
  const [activeTransactionSectors, setActiveTransactionSectors] = useState<string[]>([]);
  const visibleTransactionMarkers = useMemo(
    () => transactionMarkers.filter((marker) =>
      activeTransactionTypes.includes(marker.type) &&
      activeTransactionSectors.includes(marker.sector)
    ),
    [activeTransactionSectors, activeTransactionTypes, transactionMarkers]
  );
  const transactionCounts = useMemo(
    () => ({
      purchases: visibleTransactionMarkers.filter((marker) => marker.type === 'Purchase').length,
      sales: visibleTransactionMarkers.filter((marker) => marker.type === 'Sale').length,
      other: visibleTransactionMarkers.filter((marker) => marker.type !== 'Purchase' && marker.type !== 'Sale').length,
    }),
    [visibleTransactionMarkers]
  );
  const toggleTransactionType = (type: TransactionType) => {
    setActiveTransactionTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type]
    );
  };
  const toggleTransactionSector = (sector: string) => {
    setActiveTransactionSectors((current) =>
      current.includes(sector) ? current.filter((item) => item !== sector) : [...current, sector]
    );
  };
  const selectTopTransactionSectors = () => {
    setActiveTransactionSectors(transactionSectorOptions.slice(0, 5).map((option) => option.sector));
  };
  const selectAllTransactionSectors = () => {
    setActiveTransactionSectors(transactionSectorOptions.map((option) => option.sector));
  };

  return (
    <div className="space-y-5">
      <Panel title="Transaction Timing" subtitle={`Transaction-date flow from ${dateRange.startDate} to ${dateRange.endDate}`}>
        <TimelineRangeControl
          preset={rangePreset}
          range={dateRange}
          bounds={dateBounds}
          customStartDate={customStartDate}
          customEndDate={customEndDate}
          onPresetChange={onRangePresetChange}
          onCustomStartDateChange={onCustomStartDateChange}
          onCustomEndDateChange={onCustomEndDateChange}
        />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-interactive)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-secondary)] shadow-sm">
            {formatInteger(visibleEventCount)} visible events
          </span>
          <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-tertiary)] shadow-sm">
            {formatInteger(chartEventPins.length)} chart pins
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-interactive)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-secondary)] shadow-sm">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-600 ring-2 ring-[var(--bg-elevated)]" />
            {formatInteger(transactionCounts.purchases)} buy dots
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-interactive)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-secondary)] shadow-sm">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-600 ring-2 ring-[var(--bg-elevated)]" />
            {formatInteger(transactionCounts.sales)} sale dots
          </span>
          {transactionCounts.other > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-interactive)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-secondary)] shadow-sm">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-500 ring-2 ring-[var(--bg-elevated)]" />
              {formatInteger(transactionCounts.other)} other dots
            </span>
          )}
          {eventCounts.map(({ category, count, active }) => (
            <button
              key={category}
              type="button"
              onClick={() => onToggleCategory(category)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-sm backdrop-blur-xl ${
                active ? 'border-[var(--accent-cyan)] bg-[var(--bg-interactive)] text-[var(--text-primary)]' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)]'
              }`}
              title={`${eventCategoryLabel(category)}: ${formatInteger(count)} visible event dots`}
            >
              <span
                className="h-2.5 w-2.5 rounded-full ring-2 ring-white/70"
                style={{ backgroundColor: active ? EVENT_CATEGORY_COLORS[category] : '#cbd5e1' }}
              />
              {eventCategoryLabel(category)}
              <span className="font-mono text-[10px] text-slate-300">{formatInteger(count)}</span>
            </button>
          ))}
        </div>
        <TransactionDotFilterPanel
          totalCount={transactionMarkers.length}
          visibleCount={visibleTransactionMarkers.length}
          typeOptions={transactionTypeOptions}
          sectorOptions={transactionSectorOptions}
          activeTypes={activeTransactionTypes}
          activeSectors={activeTransactionSectors}
          onToggleType={toggleTransactionType}
          onToggleSector={toggleTransactionSector}
          onSelectTopSectors={selectTopTransactionSectors}
          onSelectAllSectors={selectAllTransactionSectors}
          onClearSectors={() => setActiveTransactionSectors([])}
        />
        <div className="h-[430px] w-full min-w-0">
          {mounted ? (
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <ComposedChart data={chartRows} margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(100, 116, 139, 0.24)" />
                <XAxis
                  dataKey="monthIndex"
                  type="number"
                  domain={[-0.45, Math.max(0, chartRows.length - 1) + 0.45]}
                  ticks={xAxisTicks}
                  tickFormatter={(value) => monthLabelByIndex.get(Number(value)) || ''}
                  tick={{ fontSize: 11 }}
                  interval="preserveStartEnd"
                />
                <YAxis domain={[0, chartMaxY]} tickFormatter={(value) => formatMoney(Number(value))} width={78} />
                <Tooltip content={<TimingChartTooltip />} cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} />
                <Line
                  type="monotone"
                  dataKey="purchaseMidpoint"
                  name="Purchases"
                  stroke="#059669"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="saleMidpoint"
                  name="Sales"
                  stroke="#dc2626"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
                <Scatter
                  name="Transactions"
                  data={visibleTransactionMarkers}
                  dataKey="y"
                  isAnimationActive={false}
                  shape={(props: unknown) => (
                    <TimingTransactionDot {...(props as TransactionDotShapeProps)} />
                  )}
                />
                <Scatter
                  name="Representative events"
                  data={chartEventPins}
                  dataKey="y"
                  isAnimationActive={false}
                  shape={(props: unknown) => (
                    <TimingEventDot
                      {...(props as TimingDotShapeProps)}
                      selectedEventId={selectedEvent?.id || null}
                      onSelectEvent={onSelectEvent}
                    />
                  )}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <ChartPlaceholder />}
        </div>
        <div className="mt-2 text-[11px] leading-4 text-slate-300">
          Pins show the highest-signal event for each month/category, plus the selected event. The grid below accounts for every visible event without turning the flow chart into static.
        </div>
        <EventDensityMatrix
          markers={eventMarkers}
          months={chartRows.map((row) => row.month)}
          categories={availableEventCategories}
          activeCategories={activeEventCategories}
          selectedEventId={selectedEvent?.id || null}
          onSelectEvent={onSelectEvent}
          onToggleCategory={onToggleCategory}
        />
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
        <Panel title="Late-Filing Density" subtitle="Monthly late share using transaction dates as the time axis">
          <MonthActivityHeatmap rows={monthlyActivity} />
        </Panel>
        <Panel title="Event Context" subtitle="Filter the dot categories and inspect nearby transaction windows">
          <EventOverlayPanel
            categories={availableEventCategories}
            activeCategories={activeEventCategories}
            onToggleCategory={onToggleCategory}
            onSelectAllCategories={onSelectAllCategories}
            onClearCategories={onClearCategories}
          />
          <EventWindowDetail
            event={selectedEvent}
            windows={selectedEventWindows}
            onApplyWindow={onApplyWindow}
            onClearWindow={onClearWindow}
          />
        </Panel>
      </div>
    </div>
  );
}

interface TimingDotShapeProps {
  cx?: number;
  cy?: number;
  payload?: EventMarker;
}

function TimingEventDot({
  cx,
  cy,
  payload,
  selectedEventId,
  onSelectEvent,
}: TimingDotShapeProps & {
  selectedEventId: string | null;
  onSelectEvent: (id: string) => void;
}) {
  if (typeof cx !== 'number' || typeof cy !== 'number' || !payload) return null;

  const color = EVENT_CATEGORY_COLORS[payload.category];
  const selected = selectedEventId === payload.eventId;
  const radius = selected ? 6 : Math.max(2.4, Math.min(4.4, 2.3 + payload.importance * 0.55));

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${eventCategoryLabel(payload.category)} event: ${payload.title}`}
      onClick={() => onSelectEvent(payload.eventId)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelectEvent(payload.eventId);
        }
      }}
      style={{ cursor: 'pointer', outline: 'none' }}
    >
      <title>{`${payload.date} | ${eventCategoryLabel(payload.category)} | ${payload.title}`}</title>
      <circle cx={cx} cy={cy} r={radius + 5} fill={color} opacity={selected ? 0.24 : 0.1} />
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill={color}
        opacity={selected ? 1 : 0.82}
        stroke={selected ? '#0f172a' : 'rgba(255,255,255,0.92)'}
        strokeWidth={selected ? 2.4 : 1.4}
      />
    </g>
  );
}

interface TransactionDotShapeProps {
  cx?: number;
  cy?: number;
  payload?: TransactionMarker;
}

function TimingTransactionDot({ cx, cy, payload }: TransactionDotShapeProps) {
  if (typeof cx !== 'number' || typeof cy !== 'number' || !payload) return null;

  const color = transactionColor(payload.type);
  const radius = Math.max(2, Math.min(5.4, 2 + Math.log10(payload.amountMidpoint + 10_000) * 0.52));

  return (
    <g style={{ pointerEvents: 'all' }}>
      <title>{`${payload.date} | ${payload.type} | ${payload.displayName} | ${formatMoney(payload.amountMidpoint)} midpoint`}</title>
      <circle cx={cx} cy={cy} r={radius + 3.5} fill={color} opacity={0.08} />
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill={color}
        opacity={0.46}
        stroke="rgba(255,255,255,0.82)"
        strokeWidth={0.9}
      />
    </g>
  );
}

interface TimingTooltipPayload {
  name?: string;
  value?: number;
  color?: string;
  dataKey?: string;
  payload?: unknown;
}

function TimingChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TimingTooltipPayload[];
}) {
  if (!active || !payload?.length) return null;

  const transactionPayload = payload.map((item) => item.payload).find(isTransactionMarker);
  if (transactionPayload) {
    const color = transactionColor(transactionPayload.type);
    return (
      <div className="max-w-[340px] rounded-2xl border border-white/60 bg-white/85 p-3 text-xs shadow-xl shadow-slate-900/10 backdrop-blur-2xl">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ backgroundColor: color }} />
          <span className="font-bold text-slate-900">{transactionPayload.type}</span>
          <span className="font-mono text-[11px] text-slate-300">{transactionPayload.date}</span>
          {transactionPayload.lateFilingFlag && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200">
              reported late
            </span>
          )}
        </div>
        <div className="font-semibold leading-4 text-slate-900">{transactionPayload.displayName}</div>
        <div className="mt-2 grid gap-1.5">
          <div className="flex items-center justify-between gap-5">
            <span className="text-slate-300">Range</span>
            <span className="font-mono font-semibold text-slate-800">{transactionPayload.amountLabel}</span>
          </div>
          <div className="flex items-center justify-between gap-5">
            <span className="text-slate-300">Midpoint</span>
            <span className="font-mono font-semibold text-slate-800">{formatMoney(transactionPayload.amountMidpoint)}</span>
          </div>
        </div>
        <div className="mt-2 text-[11px] leading-4 text-slate-300">
          {transactionPayload.assetType} | {transactionPayload.sector}
          {transactionPayload.ticker ? ` | ${transactionPayload.ticker}` : ''}
        </div>
      </div>
    );
  }

  const eventPayload = payload.map((item) => item.payload).find(isEventMarker);
  if (eventPayload) {
    return (
      <div className="max-w-[320px] rounded-2xl border border-white/60 bg-white/85 p-3 text-xs shadow-xl shadow-slate-900/10 backdrop-blur-2xl">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full ring-2 ring-white"
            style={{ backgroundColor: EVENT_CATEGORY_COLORS[eventPayload.category] }}
          />
          <span className="font-bold text-slate-900">{eventCategoryLabel(eventPayload.category)}</span>
          <span className="font-mono text-[11px] text-slate-300">{eventPayload.date}</span>
        </div>
        <div className="font-semibold leading-4 text-slate-900">{eventPayload.title}</div>
        <div className="mt-1 text-[11px] leading-4 text-slate-300">
          {eventPayload.sourceName} | importance {eventPayload.importance}/3
        </div>
        {eventPayload.summary && (
          <div className="mt-2 line-clamp-3 text-[11px] leading-4 text-slate-300">{eventPayload.summary}</div>
        )}
        <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-200">Click for nearby transaction windows</div>
      </div>
    );
  }

  const rowPayload = payload.map((item) => item.payload).find(isTimingChartRow);
  if (!rowPayload) return null;

  return (
    <div className="rounded-2xl border border-white/60 bg-white/85 p-3 text-xs shadow-xl shadow-slate-900/10 backdrop-blur-2xl">
      <div className="mb-2 font-mono text-[11px] font-semibold text-slate-300">{rowPayload.month}</div>
      {rowPayload.hasTransactionFlow ? (
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-5">
            <span className="text-slate-300">Purchases</span>
            <span className="font-mono font-semibold text-emerald-700">{formatMoney(rowPayload.purchaseMidpoint || 0)}</span>
          </div>
          <div className="flex items-center justify-between gap-5">
            <span className="text-slate-300">Sales</span>
            <span className="font-mono font-semibold text-rose-700">{formatMoney(rowPayload.saleMidpoint || 0)}</span>
          </div>
          <div className="flex items-center justify-between gap-5">
            <span className="text-slate-300">Rows</span>
            <span className="font-mono font-semibold text-slate-700">{formatInteger(rowPayload.count)}</span>
          </div>
        </div>
      ) : (
        <div className="text-[11px] leading-4 text-slate-300">No disclosed transaction rows in this month; shown because context events exist.</div>
      )}
    </div>
  );
}

function TimelineRangeControl({
  preset,
  range,
  bounds,
  customStartDate,
  customEndDate,
  onPresetChange,
  onCustomStartDateChange,
  onCustomEndDateChange,
}: {
  preset: TimingRangePreset;
  range: DateRange;
  bounds: DateRange;
  customStartDate: string;
  customEndDate: string;
  onPresetChange: (preset: TimingRangePreset) => void;
  onCustomStartDateChange: (value: string) => void;
  onCustomEndDateChange: (value: string) => void;
}) {
  return (
    <div className="mb-3 rounded-2xl border border-white/55 bg-white/35 p-3 shadow-inner shadow-white/30 backdrop-blur-2xl">
      <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300">Timeline range</div>
          <div className="text-xs leading-5 text-slate-300">
            Showing {range.label}. The date range affects this timing visualization only; the dashboard filters still control tables and cards.
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-[180px_145px_145px]">
          <label className="grid gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-200">
            Preset
            <select
              value={preset}
              onChange={(event) => onPresetChange(event.target.value as TimingRangePreset)}
              className="liquid-input h-9 min-w-0 text-xs font-semibold normal-case tracking-normal text-slate-800"
            >
              <option value="visible">Visible filters</option>
              <option value="full">Full source history</option>
              <option value="since2025">2025 to present</option>
              <option value="last24">Last 24 months</option>
              <option value="last12">Last 12 months</option>
              <option value="custom">Custom dates</option>
            </select>
          </label>
          <label className="grid gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-200">
            Start
            <input
              type="date"
              value={preset === 'custom' ? customStartDate : range.startDate}
              min={bounds.startDate}
              max={bounds.endDate}
              disabled={preset !== 'custom'}
              onChange={(event) => onCustomStartDateChange(event.target.value)}
              className="liquid-input h-9 min-w-0 text-xs font-semibold normal-case tracking-normal text-slate-800 disabled:opacity-60"
            />
          </label>
          <label className="grid gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-200">
            End
            <input
              type="date"
              value={preset === 'custom' ? customEndDate : range.endDate}
              min={bounds.startDate}
              max={bounds.endDate}
              disabled={preset !== 'custom'}
              onChange={(event) => onCustomEndDateChange(event.target.value)}
              className="liquid-input h-9 min-w-0 text-xs font-semibold normal-case tracking-normal text-slate-800 disabled:opacity-60"
            />
          </label>
        </div>
      </div>
    </div>
  );
}

function TransactionDotFilterPanel({
  totalCount,
  visibleCount,
  typeOptions,
  sectorOptions,
  activeTypes,
  activeSectors,
  onToggleType,
  onToggleSector,
  onSelectTopSectors,
  onSelectAllSectors,
  onClearSectors,
}: {
  totalCount: number;
  visibleCount: number;
  typeOptions: TransactionTypeOption[];
  sectorOptions: TransactionSectorOption[];
  activeTypes: TransactionType[];
  activeSectors: string[];
  onToggleType: (type: TransactionType) => void;
  onToggleSector: (sector: string) => void;
  onSelectTopSectors: () => void;
  onSelectAllSectors: () => void;
  onClearSectors: () => void;
}) {
  const needsType = activeTypes.length === 0;
  const needsSector = activeSectors.length === 0;

  return (
    <div className="mb-3 rounded-2xl border border-white/45 bg-white/28 p-3 shadow-inner shadow-white/35 backdrop-blur-2xl">
      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">Transaction dot filters</div>
          <div className="text-xs leading-5 text-slate-300">
            {needsType || needsSector
              ? 'Select at least one action and one sector to draw transaction row dots.'
              : `${formatInteger(visibleCount)} of ${formatInteger(totalCount)} transaction row dots plotted.`}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={onSelectTopSectors} className="liquid-button px-2.5 py-1 text-[11px] font-semibold text-slate-700">
            Top 5 sectors
          </button>
          <button type="button" onClick={onSelectAllSectors} className="liquid-button px-2.5 py-1 text-[11px] font-semibold text-slate-700">
            All sectors
          </button>
          <button type="button" onClick={onClearSectors} className="liquid-button px-2.5 py-1 text-[11px] font-semibold text-slate-700">
            Clear sectors
          </button>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[0.7fr_1.3fr]">
        <div>
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-200">Action</div>
          <div className="flex flex-wrap gap-1.5">
            {typeOptions.map((option) => {
              const active = activeTypes.includes(option.type);
              return (
                <button
                  key={option.type}
                  type="button"
                  onClick={() => onToggleType(option.type)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-sm backdrop-blur-xl ${
                    active ? 'border-white/65 bg-white/60 text-slate-800' : 'border-white/35 bg-white/15 text-slate-200'
                  }`}
                  title={`${transactionTypeLabel(option.type)}: ${formatInteger(option.count)} rows`}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full ring-2 ring-white/70"
                    style={{ backgroundColor: active ? transactionColor(option.type) : '#cbd5e1' }}
                  />
                  {transactionTypeLabel(option.type)}
                  <span className="font-mono text-[10px] text-slate-300">{formatInteger(option.count)}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-200">Sector</div>
            <div className="text-[10px] font-semibold text-slate-200">{formatInteger(activeSectors.length)} selected</div>
          </div>
          <div className="flex max-h-[118px] flex-wrap gap-1.5 overflow-y-auto pr-1">
            {sectorOptions.map((option) => {
              const active = activeSectors.includes(option.sector);
              return (
                <button
                  key={option.sector}
                  type="button"
                  onClick={() => onToggleSector(option.sector)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-sm backdrop-blur-xl ${
                    active ? 'border-white/65 bg-white/60 text-slate-800' : 'border-white/35 bg-white/15 text-slate-200'
                  }`}
                  title={`${option.sector}: ${formatInteger(option.count)} rows (${formatInteger(option.purchaseCount)} buys, ${formatInteger(option.saleCount)} sales)`}
                >
                  <span className={`h-2 w-2 rounded-full ${active ? 'bg-slate-700' : 'bg-slate-300'}`} />
                  <span>{option.sector}</span>
                  <span className="font-mono text-[10px] text-slate-300">{formatInteger(option.count)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function EventDensityMatrix({
  markers,
  months,
  categories,
  activeCategories,
  selectedEventId,
  onSelectEvent,
  onToggleCategory,
}: {
  markers: EventMarker[];
  months: string[];
  categories: EventCategory[];
  activeCategories: EventCategory[];
  selectedEventId: string | null;
  onSelectEvent: (id: string) => void;
  onToggleCategory: (category: EventCategory) => void;
}) {
  const monthSet = new Set(months);
  const categoryRows = categories
    .map((category) => {
      const categoryMarkers = markers.filter((marker) => marker.category === category && monthSet.has(marker.month));
      return {
        category,
        markers: categoryMarkers,
        count: categoryMarkers.length,
        active: activeCategories.includes(category),
      };
    })
    .filter((row) => row.count > 0 || row.active);
  const grouped = new Map<string, EventMarker[]>();
  for (const marker of markers) {
    if (!monthSet.has(marker.month)) continue;
    const key = eventDensityKey(marker.category, marker.month);
    grouped.set(key, [...(grouped.get(key) || []), marker]);
  }
  const maxCount = Math.max(1, ...Array.from(grouped.values()).map((group) => group.length));
  const busiest = Array.from(grouped.entries())
    .map(([key, group]) => {
      const [category, month] = key.split('|') as [EventCategory, string];
      return { category, month, group };
    })
    .sort((a, b) => b.group.length - a.group.length || b.month.localeCompare(a.month))[0];
  const gridTemplateColumns = `minmax(190px, 1.55fr) repeat(${Math.max(1, months.length)}, minmax(32px, 1fr))`;

  if (categoryRows.length === 0 || months.length === 0) {
    return <div className="liquid-empty mt-4 p-4 text-sm text-slate-300">No context events in the visible timing range.</div>;
  }

  return (
    <div className="mt-4 rounded-2xl border border-white/45 bg-white/28 p-3 shadow-inner shadow-white/35 backdrop-blur-2xl">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">All-event density</div>
          <div className="text-xs leading-5 text-slate-300">Every visible event is counted here; darker cells mean more context in that month/category.</div>
        </div>
        {busiest && (
          <div className="rounded-full border border-white/55 bg-white/45 px-2.5 py-1 text-[11px] font-semibold text-slate-300 shadow-sm">
            Busiest: {shortMonthLabel(busiest.month)} / {eventCategoryLabel(busiest.category)} ({formatInteger(busiest.group.length)})
          </div>
        )}
      </div>
      <div className="overflow-x-auto pb-1">
        <div className="min-w-[900px]">
          <div className="grid items-center gap-1.5" style={{ gridTemplateColumns }}>
            <div />
            {months.map((month, index) => (
              <div key={month} className="text-center font-mono text-[10px] font-semibold text-slate-200">
                {monthAxisLabel(month, index, months.length)}
              </div>
            ))}
            {categoryRows.map(({ category, count, active }) => {
              const color = EVENT_CATEGORY_COLORS[category];
              return (
                <div key={category} className="contents">
                  <button
                    type="button"
                    onClick={() => onToggleCategory(category)}
                    className={`flex min-h-8 items-center justify-between gap-2 rounded-xl border px-2 text-left text-[11px] font-semibold shadow-sm backdrop-blur-xl ${
                      active ? 'border-white/65 bg-white/55 text-slate-800' : 'border-white/35 bg-white/15 text-slate-200'
                    }`}
                    title={`Toggle ${eventCategoryLabel(category)}`}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white/70" style={{ backgroundColor: active ? color : '#cbd5e1' }} />
                      <span className="truncate">{eventCategoryLabel(category)}</span>
                    </span>
                    <span className="font-mono text-[10px] text-slate-300">{formatInteger(count)}</span>
                  </button>
                  {months.map((month) => {
                    const cellMarkers = grouped.get(eventDensityKey(category, month)) || [];
                    const leadMarker = selectLeadEventMarker(cellMarkers);
                    const selected = Boolean(selectedEventId && cellMarkers.some((marker) => marker.eventId === selectedEventId));
                    const intensity = cellMarkers.length ? Math.min(0.86, 0.14 + Math.log1p(cellMarkers.length) / Math.log1p(maxCount) * 0.72) : 0;
                    const size = cellMarkers.length ? Math.min(22, 5 + Math.sqrt(cellMarkers.length) * 2.8) : 0;
                    const title = cellMarkers.length
                      ? `${formatInteger(cellMarkers.length)} ${eventCategoryLabel(category)} event${cellMarkers.length === 1 ? '' : 's'} in ${month}; lead: ${leadMarker?.title || 'N/A'}`
                      : `${eventCategoryLabel(category)}: no events in ${month}`;
                    return (
                      <button
                        key={`${category}-${month}`}
                        type="button"
                        disabled={!leadMarker}
                        onClick={() => leadMarker && onSelectEvent(leadMarker.eventId)}
                        className={`relative flex h-8 items-center justify-center rounded-lg border transition ${
                          selected
                            ? 'border-slate-900 bg-white/70 shadow-md'
                            : cellMarkers.length
                              ? 'border-white/55 bg-white/35 hover:bg-white/65'
                              : 'border-white/20 bg-white/10'
                        }`}
                        title={title}
                      >
                        {cellMarkers.length > 0 && (
                          <>
                            <span
                              className="absolute inset-0 rounded-lg"
                              style={{ backgroundColor: hexToRgba(color, intensity) }}
                            />
                            <span
                              className="relative rounded-full ring-2 ring-white/80"
                              style={{ width: size, height: size, backgroundColor: color, opacity: active ? 0.95 : 0.28 }}
                            />
                            {cellMarkers.length >= 10 && (
                              <span className="absolute bottom-0.5 right-1 font-mono text-[9px] font-bold text-slate-700">
                                {cellMarkers.length > 99 ? '99+' : cellMarkers.length}
                              </span>
                            )}
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function HoldingsTable({ holdings }: { holdings: EstimatedHolding[] }) {
  return (
    <DataTable>
      <thead>
        <tr>
          <Th>Security & Read</Th>
          <Th>Classification</Th>
          <Th align="right">Estimated</Th>
          <Th align="right">Net Flow</Th>
          <Th align="right">Purchases</Th>
          <Th align="right">Sales</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {holdings.map((holding) => (
          <tr key={holding.id}>
            <Td>
              <div className="max-w-[420px] truncate font-semibold">{holding.description}</div>
              {holding.instrumentSummary && (
                <div className="max-w-[460px] text-[11px] leading-4 text-slate-300">{holding.instrumentSummary}</div>
              )}
              <div className="text-[11px] leading-4 text-slate-300">
                {holding.transactionCount} transactions; last seen {holding.lastTransactionDate || 'no transaction date'}.
              </div>
              {holding.resolvedTicker && (
                <div className="text-[11px] font-semibold text-sky-800">
                  Public match: {holding.resolvedTicker}{holding.resolvedExchange ? ` | ${holding.resolvedExchange}` : ''}
                </div>
              )}
              {!holding.resolvedTicker && holding.issuerContextTicker && (
                <div className="text-[11px] font-semibold text-sky-800">
                  Issuer context: {holding.issuerContextTicker}{holding.issuerContextExchange ? ` | ${holding.issuerContextExchange}` : ''}{holding.issuerContextIssuerName ? ` | ${holding.issuerContextIssuerName}` : ''}
                </div>
              )}
              <InstrumentLookupLink row={holding} />
            </Td>
            <Td>
              <div className="font-semibold">{holding.assetType}</div>
              <div className="text-[11px] leading-4 text-slate-300">{holding.sector}</div>
              {holding.resolvedSicDescription && (
                <div className="text-[11px] leading-4 text-slate-300">{holding.resolvedSicDescription}</div>
              )}
            </Td>
            <Td align="right" mono>{formatRange(holding.estimatedCurrent)}</Td>
            <Td align="right" mono>{formatSignedMoney(holding.purchases.midpoint - holding.sales.midpoint)}</Td>
            <Td align="right" mono>{formatMoney(holding.purchases.midpoint)}</Td>
            <Td align="right" mono>{formatMoney(holding.sales.midpoint)}</Td>
            <Td>
              <div className="space-y-1">
                <StatusPill tone={holding.missingBaseline ? 'warn' : 'ok'} label={holding.missingBaseline ? 'No annual baseline' : 'Baseline match'} />
                <div className="text-[11px] text-slate-300">{confidenceLabel(holding.confidence)} confidence</div>
                <EnrichmentBadges flags={[...holding.enrichmentFlags, ...(holding.instrumentContextFlags || []), ...(holding.issuerContextFlags || [])]} />
              </div>
            </Td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

function SourceAuditPanel({ audit }: { audit: SourceAudit }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-5">
        <MiniStat label="Status" value={sourceAuditStatusLabel(audit.completenessStatus)} />
        <MiniStat label="OGE API" value={formatInteger(audit.ogeApiRecordCount)} />
        <MiniStat label="Registry" value={formatInteger(audit.registrySourceCount)} />
        <MiniStat label="Official PDFs" value={formatInteger(audit.officialPdfCount)} />
        <MiniStat label="Gaps" value={formatInteger(audit.gaps.length)} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <SourceAuditTimeline audit={audit} />
        <div className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-300">Priority gaps</div>
          {audit.gaps.slice(0, 8).map((gap) => (
            <div key={`${gap.year}-${gap.issue}`} className="liquid-surface p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="font-bold">{gap.year}</div>
                <StatusPill tone={gap.severity === 'high' ? 'warn' : 'neutral'} label={gap.severity} />
              </div>
              <div className="mt-1 text-slate-700">{gap.issue}</div>
              <div className="mt-1 text-xs leading-5 text-slate-300">{gap.suggestedAction}</div>
            </div>
          ))}
          {audit.gaps.length === 0 && <div className="liquid-empty p-4 text-sm text-slate-300">No source gaps flagged by the latest audit.</div>}
        </div>
      </div>
      <div className="liquid-surface p-3 text-xs leading-5 text-slate-300">
        {audit.notes.join(' ')}
      </div>
    </div>
  );
}

function SourceAuditTimeline({ audit }: { audit: SourceAudit }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-300">2015-present coverage</div>
      {audit.coverageByYear.map((row) => (
        <div key={row.year} className="grid grid-cols-[54px_1fr_68px] items-center gap-3 text-xs">
          <div className="font-mono text-slate-300">{row.year}</div>
          <div className="flex h-5 overflow-hidden rounded-full bg-white/45">
            <div className="bg-emerald-500" style={{ width: `${Math.max(0, row.officialCount) * 18}%` }} title={`${row.officialCount} official`} />
            <div className="bg-amber-400" style={{ width: `${Math.max(0, row.archivedCount) * 18}%` }} title={`${row.archivedCount} archived`} />
            <div className="bg-slate-400" style={{ width: `${Math.max(0, row.metadataOnlyCount) * 18}%` }} title={`${row.metadataOnlyCount} metadata-only`} />
            {row.registryCount === 0 && <div className="w-full bg-rose-200" />}
          </div>
          <StatusPill tone={row.status === 'covered' ? 'ok' : row.status === 'partial' ? 'neutral' : 'warn'} label={row.status} />
        </div>
      ))}
    </div>
  );
}

interface SectorTile {
  sector: string;
  description: string;
  value: number;
  netMidpoint: number;
  purchaseMidpoint: number;
  saleMidpoint: number;
  count: number;
  lateCount: number;
  publicCompanyCount: number;
  confidence: number;
}

interface TreeRoot {
  name: string;
  children: SectorTile[];
}

function SectorTreemap({ tiles }: { tiles: SectorTile[] }) {
  const width = 1000;
  const height = 430;
  const maxNet = Math.max(1, ...tiles.map((tile) => Math.abs(tile.netMidpoint)));
  const color = scaleLinear<string>()
    .domain([-maxNet, 0, maxNet])
    .range(['#dc2626', '#e2e8f0', '#059669']);
  const root = treemap<SectorTile | TreeRoot>()
    .size([width, height])
    .paddingOuter(2)
    .paddingInner(5)
    .round(true)(
      hierarchy<SectorTile | TreeRoot>({ name: 'Sectors', children: tiles })
        .sum((datum) => ('value' in datum ? datum.value : 0))
        .sort((a, b) => (b.value || 0) - (a.value || 0))
    );
  const leaves = root.leaves().filter((leaf) => isSectorTile(leaf.data));

  if (tiles.length === 0) {
    return <div className="liquid-empty flex h-[430px] items-center justify-center text-sm text-slate-300">No sector data for the current filters.</div>;
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Sector exposure treemap" className="h-[430px] w-full">
      {leaves.map((leaf) => {
        const tile = leaf.data as SectorTile;
        const tileWidth = leaf.x1 - leaf.x0;
        const tileHeight = leaf.y1 - leaf.y0;
        const showTitle = tileWidth > 115 && tileHeight > 54;
        const showDetails = tileWidth > 170 && tileHeight > 96;
        const textColor = Math.abs(tile.netMidpoint) > maxNet * 0.35 ? '#ffffff' : '#0f172a';
        return (
          <g key={tile.sector} transform={`translate(${leaf.x0},${leaf.y0})`}>
            <rect
              width={tileWidth}
              height={tileHeight}
              rx={3}
              fill={color(tile.netMidpoint)}
              stroke="#ffffff"
              strokeWidth={1}
            />
            <title>{`${tile.sector}: ${formatSignedMoney(tile.netMidpoint)} net midpoint, ${formatInteger(tile.count)} transactions, ${formatInteger(tile.publicCompanyCount)} public-company matches. ${tile.description}`}</title>
            {showTitle && (
              <>
                <text x={10} y={20} fill={textColor} fontSize={14} fontWeight={700}>
                  {truncateSvgText(tile.sector, tileWidth)}
                </text>
                <text x={10} y={40} fill={textColor} fontSize={12} opacity={0.9}>
                  {formatSignedMoney(tile.netMidpoint)} net
                </text>
              </>
            )}
            {showDetails && (
              <>
                <text x={10} y={64} fill={textColor} fontSize={11} opacity={0.85}>
                  Buy {formatMoney(tile.purchaseMidpoint)} | Sell {formatMoney(tile.saleMidpoint)}
                </text>
                <text x={10} y={82} fill={textColor} fontSize={11} opacity={0.85}>
                  {formatInteger(tile.count)} rows | {formatInteger(tile.lateCount)} late | {formatInteger(tile.publicCompanyCount)} matched
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function SectorSignal({ title, tone, summaries }: { title: string; tone: 'buy' | 'sell'; summaries: SectorSummary[] }) {
  const toneClass = tone === 'buy' ? 'text-emerald-700' : 'text-red-700';
  return (
    <div className="liquid-surface p-3">
      <div className={`mb-2 text-xs font-bold uppercase tracking-wide ${toneClass}`}>{title}</div>
      <div className="space-y-3">
        {summaries.length === 0 && <div className="text-xs text-slate-300">No visible sector with this direction.</div>}
        {summaries.map((summary) => (
          <div key={`${title}-${summary.sector}`}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">{summary.sector}</span>
              <span className={`font-mono text-xs ${summary.net.midpoint >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {formatSignedMoney(summary.net.midpoint)}
              </span>
            </div>
            <div className="mt-1 text-[11px] leading-4 text-slate-300">{summarizeSector(summary)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface MonthActivityRow {
  month: string;
  count: number;
  lateCount: number;
  purchaseCount: number;
  saleCount: number;
  lateShare: number;
}

function MonthActivityHeatmap({ rows }: { rows: MonthActivityRow[] }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[76px_1fr_64px] items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
        <span>Month</span>
        <span>Late density</span>
        <span className="text-right">Rows</span>
      </div>
      <div className="max-h-[250px] space-y-1 overflow-auto pr-1">
        {rows.map((row) => {
          const tone = lateDensityTone(row.lateShare);
          return (
            <div key={row.month} className="grid grid-cols-[76px_1fr_64px] items-center gap-2 text-xs">
              <span className="font-mono text-slate-300">{row.month}</span>
              <div
                className="grid grid-cols-[48px_1fr] items-center gap-2"
                title={`${formatPct(row.lateCount, row.count)} late; ${formatInteger(row.purchaseCount)} purchases; ${formatInteger(row.saleCount)} sales`}
              >
                <span className={`text-right font-mono text-[11px] font-semibold ${tone.textClass}`}>
                  {formatPct(row.lateCount, row.count)}
                </span>
                <div className="h-2.5 overflow-hidden rounded-full bg-white/45">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(2, row.lateShare * 100)}%`,
                      backgroundColor: tone.fill,
                    }}
                  />
                </div>
              </div>
              <span className="text-right font-mono text-slate-300">{formatInteger(row.count)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function lateDensityTone(share: number): { fill: string; textClass: string } {
  if (share >= 0.9) return { fill: '#e11d48', textClass: 'text-rose-700' };
  if (share >= 0.7) return { fill: '#f59e0b', textClass: 'text-amber-700' };
  if (share >= 0.35) return { fill: '#0ea5e9', textClass: 'text-sky-700' };
  return { fill: '#64748b', textClass: 'text-slate-300' };
}

function EventOverlayPanel({
  categories,
  activeCategories,
  onToggleCategory,
  onSelectAllCategories,
  onClearCategories,
}: {
  categories: EventCategory[];
  activeCategories: EventCategory[];
  onToggleCategory: (category: EventCategory) => void;
  onSelectAllCategories: () => void;
  onClearCategories: () => void;
}) {
  return (
    <div className="space-y-3 border-t border-white/35 pt-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">Database event categories</div>
          <div className="text-xs text-slate-300">Toggle context categories in the chart pins and density grid.</div>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={onSelectAllCategories} className="liquid-button px-2.5 py-1 text-[11px] font-semibold text-slate-700">
            All
          </button>
          <button type="button" onClick={onClearCategories} className="liquid-button px-2.5 py-1 text-[11px] font-semibold text-slate-700">
            Clear
          </button>
          <CalendarDays className="h-4 w-4 text-slate-200" />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {categories.map((category) => {
          const active = activeCategories.includes(category);
          return (
            <button
              key={category}
              type="button"
              onClick={() => onToggleCategory(category)}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold backdrop-blur-xl ${
                active ? 'border-white/70 bg-white/55 text-slate-800 shadow-sm' : 'border-white/35 bg-white/20 text-slate-200'
              }`}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: active ? EVENT_CATEGORY_COLORS[category] : '#cbd5e1' }}
              />
              {eventCategoryLabel(category)}
            </button>
          );
        })}
      </div>
      <div className="liquid-surface p-3 text-xs leading-5 text-slate-300">
        The main chart shows representative pins; the density grid counts every visible public event by month and category. Click a pin or dense cell to inspect the lead event below.
      </div>
    </div>
  );
}

function EventWindowDetail({
  event,
  windows,
  onApplyWindow,
  onClearWindow,
}: {
  event: OgeEvent | null;
  windows: EventWindowSummary[];
  onApplyWindow: (event: OgeEvent, windowDays: 7 | 30) => void;
  onClearWindow: () => void;
}) {
  if (!event) {
    return (
      <div className="liquid-empty mt-4 p-4 text-sm text-slate-300">
        Select an event to inspect nearby transaction activity.
      </div>
    );
  }

  const sortedWindows = [...windows].sort((a, b) => a.windowDays - b.windowDays);

  return (
    <div className="mt-4 border-t border-white/35 pt-4">
      <div className="grid gap-4 xl:grid-cols-[1fr_1.1fr]">
        <div className="space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">Selected chart event</div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-white"
              style={{ backgroundColor: EVENT_CATEGORY_COLORS[event.category] }}
            >
              {eventCategoryLabel(event.category)}
            </span>
            <span className="font-mono text-xs text-slate-300">{eventDateLabel(event)}</span>
            <span className="rounded-full bg-white/45 px-2 py-1 text-[11px] font-semibold text-slate-300 ring-1 ring-white/55">
              importance {event.importance}/3
            </span>
          </div>
          <div>
            <h3 className="text-sm font-bold leading-5">{event.title}</h3>
            <p className="mt-1 text-xs leading-5 text-slate-300">{event.summary}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onApplyWindow(event, 7)}
              className="liquid-button px-3 py-2 text-xs font-semibold text-slate-700"
            >
              Filter +/-7d
            </button>
            <button
              type="button"
              onClick={() => onApplyWindow(event, 30)}
              className="liquid-button px-3 py-2 text-xs font-semibold text-slate-700"
            >
              Filter +/-30d
            </button>
            <button
              type="button"
              onClick={onClearWindow}
              className="liquid-button px-3 py-2 text-xs font-semibold text-slate-700"
            >
              Clear dates
            </button>
            <a
              href={event.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="liquid-button inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-sky-700"
            >
              {event.sourceName} <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <div className="text-[11px] leading-4 text-slate-300">
            Proximity analysis is a reporting prompt only; it does not imply motive, coordination, or causation.
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {sortedWindows.map((window) => (
            <div key={`${window.eventId}-${window.windowDays}`} className="liquid-surface p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-xs font-bold">+/-{window.windowDays} days</div>
                <div className="font-mono text-xs text-slate-300">{formatInteger(window.transactionCount)} rows</div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <Metric label="Buys" value={formatMoney(window.purchaseMidpoint)} tone="buy" />
                <Metric label="Sales" value={formatMoney(window.saleMidpoint)} tone="sell" />
                <Metric label="Net" value={formatSignedMoney(window.netMidpoint)} tone={window.netMidpoint >= 0 ? 'buy' : 'sell'} />
              </div>
              <div className="mt-3 text-[11px] leading-4 text-slate-300">
                {window.firstTransactionDate && window.lastTransactionDate
                  ? `${window.firstTransactionDate} to ${window.lastTransactionDate}`
                  : 'No matching transaction dates.'}
              </div>
              {window.matchedTickers.length > 0 && (
                <div className="mt-2 truncate text-[11px] font-semibold text-sky-800">
                  Tickers: {window.matchedTickers.slice(0, 8).join(', ')}
                </div>
              )}
              {window.matchedSectors.length > 0 && (
                <div className="mt-1 line-clamp-2 text-[11px] text-slate-300">
                  Sectors: {window.matchedSectors.slice(0, 6).join(', ')}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: 'buy' | 'sell' | 'neutral' }) {
  const toneClass = tone === 'buy' ? 'text-emerald-700' : tone === 'sell' ? 'text-red-700' : 'text-slate-700';
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-300">{label}</div>
      <div className={`font-mono text-xs font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function KpiCard({ label, value, sub, icon, tone = 'neutral' }: { label: string; value: string; sub: string; icon: React.ReactNode; tone?: 'neutral' | 'buy' | 'sell' | 'warn' }) {
  const toneClass = tone === 'buy'
    ? 'text-emerald-700 bg-emerald-50/70 ring-emerald-200/60'
    : tone === 'sell'
      ? 'text-rose-700 bg-rose-50/70 ring-rose-200/60'
      : tone === 'warn'
        ? 'text-amber-800 bg-amber-50/75 ring-amber-200/60'
        : 'text-slate-700 bg-white/55 ring-white/70';
  return (
    <div className="liquid-panel p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-300">{label}</div>
        <div className={`rounded-full p-2 ring-1 backdrop-blur-xl ${toneClass}`}>{icon}</div>
      </div>
      <div className="font-mono text-2xl font-bold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-slate-300">{sub}</div>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="liquid-panel min-w-0">
      <div className="flex items-start justify-between gap-3 border-b border-white/35 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold">{title}</h2>
          <div className="mt-0.5 text-xs text-slate-300">{subtitle}</div>
        </div>
        <ShieldCheck className="h-4 w-4 text-slate-200" />
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function TrumpIndexTable({
  entries,
  selectedIds,
  onToggleSelected,
}: {
  entries: TrumpIndexEntry[];
  selectedIds: string[];
  onToggleSelected: (id: string) => void;
}) {
  if (entries.length === 0) {
    return <div className="liquid-empty p-6 text-sm text-slate-300">No index entries match the current filters.</div>;
  }

  return (
    <DataTable>
      <thead>
        <tr>
          <Th>Focus</Th>
          <Th align="right">Score</Th>
          <Th>Exposure</Th>
          <Th>Public Reference</Th>
          <Th align="right">Current</Th>
          <Th align="right">Change</Th>
          <Th align="right">Net Flow</Th>
          <Th>Signal</Th>
          <Th>Source</Th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.id}>
            <Td>
              <input
                type="checkbox"
                checked={selectedIds.includes(entry.id)}
                onChange={() => onToggleSelected(entry.id)}
                className="h-4 w-4 rounded border-slate-300"
                aria-label={`Select ${entry.displayName}`}
              />
            </Td>
            <Td align="right">
              <div className="font-mono text-lg font-bold">{entry.score.toFixed(1)}</div>
              <div className="font-mono text-[11px] text-slate-300">
                E {entry.exposureComponent.toFixed(0)} / C {entry.changeComponent.toFixed(0)} / A {entry.activityComponent.toFixed(0)}
              </div>
            </Td>
            <Td>
              <div className="max-w-[320px] truncate font-semibold">{entry.displayName}</div>
              {entry.instrumentSummary && (
                <div className="max-w-[360px] text-[11px] leading-4 text-slate-300">{entry.instrumentSummary}</div>
              )}
              <div className="text-[11px] leading-4 text-slate-300">{entry.assetType} | {entry.sector}</div>
              <div className="text-[11px] leading-4 text-slate-300">
                {entry.transactionCount} transactions; {entry.filingCount} filing source{entry.filingCount === 1 ? '' : 's'}
              </div>
            </Td>
            <Td>
              <ReferenceLabel row={entry} />
              <div className="max-w-[260px] text-[11px] leading-4 text-slate-300">
                {referenceDetail(entry)}
              </div>
              {entry.issuerContextSector && entry.issuerContextSector !== entry.sector && (
                <div className="max-w-[260px] text-[11px] leading-4 text-slate-300">{entry.issuerContextSector}</div>
              )}
              {(entry.instrumentIssuerState || entry.instrumentIssuerCategory) && (
                <div className="max-w-[260px] text-[11px] leading-4 text-slate-300">
                  {[entry.instrumentIssuerState, entry.instrumentIssuerCategory].filter(Boolean).join(' | ')}
                </div>
              )}
            </Td>
            <Td align="right">
              <div className="font-mono text-xs">{formatRange(entry.currentRange)}</div>
              <div className="font-mono text-[11px] text-slate-300">{formatMoney(entry.currentMidpoint)} midpoint</div>
            </Td>
            <Td align="right">
              <div className={`font-mono text-xs font-semibold ${entry.changeMidpoint >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {formatSignedMoney(entry.changeMidpoint)}
              </div>
              <div className="font-mono text-[11px] text-slate-300">{entry.changePct === null ? 'N/A' : `${entry.changePct.toFixed(1)}%`}</div>
            </Td>
            <Td align="right">
              <div className={`font-mono text-xs font-semibold ${entry.netFlowMidpoint >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {formatSignedMoney(entry.netFlowMidpoint)}
              </div>
              <div className="font-mono text-[11px] text-slate-300">Buy {formatMoney(entry.purchaseMidpoint)} | Sell {formatMoney(entry.saleMidpoint)}</div>
            </Td>
            <Td>
              <div className="space-y-1">
                <StatusPill tone={entry.netDirection === 'Net buy' ? 'buy' : entry.netDirection === 'Net sale' ? 'sell' : 'neutral'} label={entry.netDirection} />
                <StatusPill tone={entry.confidence >= 0.7 ? 'ok' : 'warn'} label={`${confidenceLabel(entry.confidence)} confidence`} />
                <StatusPill tone={sourceReliabilityTone(entry.sourceReliability)} label={sourceReliabilityLabel(entry.sourceReliability)} />
              </div>
            </Td>
            <Td>
              <div className="space-y-1">
                {entry.citations.slice(0, 2).map((citation) => (
                  citation.sourceUrl ? (
                    <a key={citation.sourceUrl} href={citation.sourceUrl} target="_blank" rel="noreferrer" className="block max-w-[220px] truncate text-xs font-semibold text-sky-700">
                      {citation.label} <ExternalLink className="inline h-3 w-3" />
                    </a>
                  ) : (
                    <div key={citation.label} className="max-w-[220px] truncate text-xs text-slate-300">{citation.label}</div>
                  )
                ))}
                {(entry.reviewFlags.length > 0 || (entry.instrumentContextFlags || []).length > 0 || (entry.issuerContextFlags || []).length > 0) && (
                  <EnrichmentBadges flags={[...entry.reviewFlags, ...(entry.instrumentContextFlags || []), ...(entry.issuerContextFlags || [])]} />
                )}
              </div>
            </Td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

function ReferenceLabel({ row }: { row: TrumpIndexEntry }) {
  const primaryLabel = row.resolvedTicker || row.issuerContextTicker;
  if (!primaryLabel && row.instrumentReferenceLabel && row.instrumentReferenceUrl) {
    return (
      <a href={row.instrumentReferenceUrl} target="_blank" rel="noreferrer" className="inline-flex max-w-[220px] items-center gap-1 truncate font-semibold text-sky-800">
        {row.instrumentReferenceLabel} <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
    );
  }
  return (
    <div>
      <div className="font-semibold text-sky-800">{primaryLabel || 'No ticker'}</div>
      {!primaryLabel && !row.instrumentReferenceLabel && row.instrumentKind && (
        <div className="text-[11px] font-semibold text-amber-700">Needs CUSIP/FIGI</div>
      )}
      <InstrumentLookupLink row={row} compact />
    </div>
  );
}

function referenceDetail(row: TrumpIndexEntry): string {
  if (row.resolvedTicker) {
    return [
      'Direct public match:',
      row.resolvedExchange ? `${row.resolvedExchange};` : '',
      row.resolvedCik ? `CIK ${row.resolvedCik}` : row.resolvedIssuerName || '',
    ].filter(Boolean).join(' ');
  }
  if (row.issuerContextTicker) {
    return [
      'Issuer context:',
      row.issuerContextExchange ? `${row.issuerContextExchange};` : '',
      row.issuerContextCik ? `CIK ${row.issuerContextCik}` : row.issuerContextIssuerName || '',
    ].filter(Boolean).join(' ');
  }
  if (row.instrumentReferenceLabel) {
    return [
      row.instrumentReferenceSource || 'Instrument reference',
      row.instrumentIssuerName ? `for ${row.instrumentIssuerName}` : '',
    ].filter(Boolean).join(' ');
  }
  if (row.instrumentKind) {
    return [
      row.instrumentIssuerName || row.instrumentKind,
      'needs a CUSIP, ISIN, or FIGI before linking to an exact instrument page',
    ].filter(Boolean).join(' ');
  }
  return row.instrumentIssuerName || 'No public issuer match';
}

function InstrumentLookupLink({
  row,
  compact = false,
}: {
  row: Pick<TrumpIndexEntry | OgeTransaction | EstimatedHolding, 'instrumentReferenceLabel' | 'instrumentReferenceSource' | 'instrumentReferenceUrl'>;
  compact?: boolean;
}) {
  if (!row.instrumentReferenceLabel || !row.instrumentReferenceUrl) return null;
  return (
    <a
      href={row.instrumentReferenceUrl}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex max-w-[260px] items-center gap-1 truncate font-semibold text-sky-800 ${compact ? 'text-[11px]' : 'text-[11px]'}`}
      title={row.instrumentReferenceSource || row.instrumentReferenceLabel}
    >
      {compact ? 'Instrument lookup: ' : ''}
      {row.instrumentReferenceLabel}
      <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  );
}

interface AskResponse {
  answer: string;
  citations: TrumpIndexCitation[];
  caveats: string[];
  openArenaStatus?: string;
  openArenaError?: string | null;
  cacheVersion: string;
}

interface AskExchange {
  question: string;
  response: AskResponse;
}

function AskTrumpIndexPanel({
  filters,
  selectedIndexIds,
  topEntries,
  interview = false,
}: {
  filters: TrumpOgeFilters;
  selectedIndexIds: string[];
  topEntries: TrumpIndexEntry[];
  interview?: boolean;
}) {
  const [question, setQuestion] = useState('What are the strongest Trump Index signals in the current filters?');
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [history, setHistory] = useState<AskExchange[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apiBase = (process.env.NEXT_PUBLIC_OPENARENA_API_BASE || '').replace(/\/$/, '');

  const submit = async () => {
    setError(null);
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      setError('Ask a question first.');
      return;
    }
    const askEndpoint = apiBase ? `${apiBase}/api/ask` : '/api/ask';
    setLoading(true);
    try {
      const response = await fetch(askEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: trimmedQuestion,
          filters,
          selectedIndexIds,
          includeSourceDocuments: false,
        }),
      });
      const json = await readJsonResponse(response);
      if (!response.ok) {
        const fallbackError = !apiBase && response.status === 404
          ? 'Ask API route was not found on this host. For GitHub Pages, set NEXT_PUBLIC_OPENARENA_API_BASE to the Vercel API host.'
          : `HTTP ${response.status}`;
        throw new Error(typeof json.error === 'string' ? json.error : fallbackError);
      }
      const nextAnswer = json as unknown as AskResponse;
      setAnswer(nextAnswer);
      setHistory((current) => [{ question: trimmedQuestion, response: nextAnswer }, ...current].slice(0, 6));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Panel title={interview ? 'Ask The Trump Index' : 'Ask The Index'} subtitle={`${selectedIndexIds.length || topEntries.length} focused entries sent as deterministic facts`}>
      <div className={`space-y-4 ${interview ? 'min-h-[620px]' : ''}`}>
        {interview && (
          <div className="grid gap-2 md:grid-cols-2">
            {[
              'What is the strongest cited story signal right now?',
              'Which entries are high score but low confidence?',
              'Summarize municipal bond exposure with source caveats.',
              'What filing gaps limit a 2015-present claim?',
            ].map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => setQuestion(prompt)}
                className="liquid-surface px-3 py-2 text-left text-xs font-semibold text-slate-700 transition hover:-translate-y-0.5"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          rows={interview ? 6 : 4}
          className="liquid-input w-full resize-none p-4 text-sm leading-6 outline-none"
        />
        <button
          type="button"
          onClick={submit}
          disabled={loading}
          className="liquid-button-primary flex h-11 w-full items-center justify-center gap-2 px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
        >
          {interview ? <Send className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
          {loading ? 'Asking...' : 'Ask'}
        </button>
        {error && <div className="border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">{error}</div>}
        {answer && (
          <div className="liquid-surface space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={answer.openArenaStatus === 'openarena' ? 'ok' : 'neutral'} label={answer.openArenaStatus || 'fallback'} />
              <span className="text-[11px] font-mono text-slate-300">{formatDateTime(answer.cacheVersion)}</span>
            </div>
            {answer.openArenaError && <div className="text-[11px] leading-4 text-amber-800">{answer.openArenaError}</div>}
            <MarkdownAnswer text={answer.answer} />
            {answer.citations.length > 0 && (
              <div className="space-y-1 border-t border-slate-200 pt-2">
                {answer.citations.slice(0, 5).map((citation) => (
                  citation.sourceUrl ? (
                    <a key={citation.sourceUrl} href={citation.sourceUrl} target="_blank" rel="noreferrer" className="block truncate text-xs font-semibold text-sky-700">
                      {citation.label} <ExternalLink className="inline h-3 w-3" />
                    </a>
                  ) : (
                    <div key={citation.label} className="truncate text-xs text-slate-300">{citation.label}</div>
                  )
                ))}
              </div>
            )}
          </div>
        )}
        {interview && history.length > 1 && (
          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-300">Recent exchanges</div>
            {history.slice(1).map((exchange, index) => (
              <details key={`${exchange.question}-${index}`} className="liquid-surface p-3">
                <summary className="cursor-pointer text-sm font-semibold text-slate-800">{exchange.question}</summary>
                <div className="mt-3">
                  <MarkdownAnswer text={exchange.response.answer} compact />
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function MarkdownAnswer({ text, compact = false }: { text: string; compact?: boolean }) {
  const blocks = parseMarkdownBlocks(text);
  return (
    <div className={`${compact ? 'space-y-2' : 'space-y-3'} text-sm leading-6 text-slate-800`}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return <h3 key={index} className="text-sm font-bold text-slate-950">{renderInlineMarkdown(block.text)}</h3>;
        }
        if (block.type === 'list') {
          return (
            <ul key={index} className="space-y-1 pl-4">
              {block.items.map((item) => (
                <li key={item} className="list-disc">{renderInlineMarkdown(item)}</li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{renderInlineMarkdown(block.text)}</p>;
      })}
    </div>
  );
}

type MarkdownBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] };

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length > 0) {
      blocks.push({ type: 'list', items: list });
      list = [];
    }
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', text: heading[1] });
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }
    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks.length > 0 ? blocks : [{ type: 'paragraph', text }];
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).filter(Boolean);
  return parts.map((part, index) => {
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    if (bold) return <strong key={index}>{bold[1]}</strong>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      return (
        <a key={index} href={link[2]} target="_blank" rel="noreferrer" className="font-semibold text-sky-700">
          {link[1]}
        </a>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text.slice(0, 240) };
  }
}

function IndexLeaderPanel({
  title,
  entries,
  metric,
  tone = 'neutral',
}: {
  title: string;
  entries: TrumpIndexEntry[];
  metric: 'current' | 'change' | 'net';
  tone?: 'buy' | 'sell' | 'neutral';
}) {
  return (
    <div className="liquid-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold">{title}</h3>
        <StatusPill tone={tone} label={metric} />
      </div>
      <div className="space-y-3">
        {entries.length === 0 && <div className="text-xs text-slate-300">No visible entry.</div>}
        {entries.map((entry) => (
          <div key={`${title}-${entry.id}`}>
            <div className="flex items-center justify-between gap-3">
              <span className="max-w-[190px] truncate text-sm font-semibold">{entry.displayName}</span>
              <span className="font-mono text-xs text-slate-300">
                {metric === 'current' ? formatMoney(entry.currentMidpoint) : metric === 'change' ? formatSignedMoney(entry.changeMidpoint) : formatSignedMoney(entry.netFlowMidpoint)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-slate-300">
              <span>{entry.resolvedTicker || entry.issuerContextTicker || entry.instrumentReferenceLabel || entry.assetType} | score {entry.score.toFixed(1)}</span>
              <span>{sourceReliabilityLabel(entry.sourceReliability)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IndexRollupBars({ rollups }: { rollups: TrumpOgeApiResponse['trumpIndexRollups'] }) {
  const sectorRollups = rollups.filter((rollup) => rollup.rollupType === 'sector').slice(0, 8);
  const assetRollups = rollups.filter((rollup) => rollup.rollupType === 'assetType');
  const maxValue = Math.max(1, ...rollups.map((rollup) => rollup.currentMidpoint));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <RollupGroup title="Sectors" rows={sectorRollups} maxValue={maxValue} />
      <RollupGroup title="Asset Types" rows={assetRollups} maxValue={maxValue} />
    </div>
  );
}

function RollupGroup({
  title,
  rows,
  maxValue,
}: {
  title: string;
  rows: TrumpOgeApiResponse['trumpIndexRollups'];
  maxValue: number;
}) {
  return (
    <div className="space-y-3">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-300">{title}</div>
      {rows.map((row) => (
        <div key={row.id}>
          <div className="mb-1 flex items-center justify-between gap-3 text-xs">
            <span className="max-w-[260px] truncate font-semibold">{row.key}</span>
            <span className="font-mono text-slate-300">{formatMoney(row.currentMidpoint)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/45">
            <div
              className="h-full rounded-full bg-slate-800/85"
              style={{ width: `${Math.max(3, (row.currentMidpoint / maxValue) * 100)}%` }}
            />
          </div>
          <div className="mt-1 text-[11px] text-slate-300">
            {formatInteger(row.entryCount)} entries | avg score {row.averageScore.toFixed(1)} | net {formatSignedMoney(row.netFlowMidpoint)}
          </div>
        </div>
      ))}
    </div>
  );
}

function SourceCoverageTimeline({ sources }: { sources: HistoricalSource[] }) {
  const rows = buildSourceCoverageRows(sources);
  if (rows.length === 0) {
    return <div className="liquid-empty p-6 text-sm text-slate-300">No historical sources match the current filters.</div>;
  }

  const maxCount = Math.max(1, ...rows.map((row) => row.total));
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.year} className="grid grid-cols-[58px_1fr_54px] items-center gap-3">
          <div className="font-mono text-xs text-slate-300">{row.year}</div>
          <div className="flex h-4 overflow-hidden rounded-full bg-white/45">
            <div className="bg-emerald-600" style={{ width: `${(row.official / maxCount) * 100}%` }} title={`${row.official} official`} />
            <div className="bg-amber-500" style={{ width: `${(row.archived / maxCount) * 100}%` }} title={`${row.archived} archived`} />
            <div className="bg-slate-500" style={{ width: `${(row.metadata / maxCount) * 100}%` }} title={`${row.metadata} metadata-only`} />
          </div>
          <div className="text-right font-mono text-xs text-slate-300">{row.total}</div>
        </div>
      ))}
      <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-3 text-[11px] font-semibold text-slate-300">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-600" /> Official PDF</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" /> Archived copy</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-500" /> Metadata only</span>
      </div>
    </div>
  );
}

function buildSourceCoverageRows(sources: HistoricalSource[]) {
  const rows = new Map<number, { year: number; official: number; archived: number; metadata: number; total: number }>();
  for (const source of sources) {
    const year = source.reportYear || Number(source.filedDate.slice(0, 4));
    if (!Number.isFinite(year)) continue;
    const row = rows.get(year) || { year, official: 0, archived: 0, metadata: 0, total: 0 };
    if (source.sourceReliability === 'official') row.official += 1;
    if (source.sourceReliability === 'archived_copy') row.archived += 1;
    if (source.sourceReliability === 'metadata_only') row.metadata += 1;
    row.total += 1;
    rows.set(year, row);
  }
  return Array.from(rows.values()).sort((a, b) => a.year - b.year);
}

function sourceReliabilityTone(reliability: SourceReliability): 'ok' | 'warn' | 'neutral' {
  if (reliability === 'official') return 'ok';
  if (reliability === 'archived_copy') return 'warn';
  return 'neutral';
}

function sourceReliabilityLabel(reliability: SourceReliability): string {
  if (reliability === 'official') return 'Official';
  if (reliability === 'archived_copy') return 'Archived copy';
  return 'Metadata only';
}

function sourceAuditStatusLabel(status: SourceAudit['completenessStatus']): string {
  if (status === 'complete_for_current_oge_api') return 'Complete for current OGE API';
  if (status === 'needs_historical_review') return 'Needs historical review';
  return 'Incomplete';
}

function TransactionTable({ transactions }: { transactions: OgeTransaction[] }) {
  return (
    <DataTable>
      <thead>
        <tr>
          <Th>Date</Th>
          <Th>Action</Th>
          <Th>Security & Interpretation</Th>
          <Th>Exposure Bucket</Th>
          <Th align="right">Range / Midpoint</Th>
          <Th>Disclosure</Th>
          <Th align="right">Source</Th>
        </tr>
      </thead>
      <tbody>
        {transactions.map((tx) => (
          <tr key={tx.id}>
            <Td mono>{tx.date}</Td>
            <Td><StatusPill tone={tx.type === 'Purchase' ? 'buy' : tx.type === 'Sale' ? 'sell' : 'neutral'} label={tx.type} /></Td>
            <Td>
              <div className="max-w-[520px] truncate font-semibold">{tx.description}</div>
              {tx.assetType === 'Equity' && (
                <div className="text-[11px] font-semibold text-slate-700">Stock: {deriveEquityStockName(tx.description)}</div>
              )}
              {tx.resolvedTicker && (
                <div className="text-[11px] font-semibold text-sky-800">
                  Public match: {tx.resolvedTicker}{tx.resolvedExchange ? ` | ${tx.resolvedExchange}` : ''}{tx.resolvedIssuerName ? ` | ${tx.resolvedIssuerName}` : ''}
                </div>
              )}
              {!tx.resolvedTicker && tx.issuerContextTicker && (
                <div className="text-[11px] font-semibold text-sky-800">
                  Issuer context: {tx.issuerContextTicker}{tx.issuerContextExchange ? ` | ${tx.issuerContextExchange}` : ''}{tx.issuerContextIssuerName ? ` | ${tx.issuerContextIssuerName}` : ''}
                </div>
              )}
              <InstrumentLookupLink row={tx} />
              {tx.instrumentSummary && (
                <div className="max-w-[560px] text-[11px] leading-4 text-slate-300">{tx.instrumentSummary}</div>
              )}
              <div className="text-[11px] leading-4 text-slate-300">{describeTransaction(tx)}</div>
            </Td>
            <Td>
              <div className="font-semibold">{tx.assetType}</div>
              <div className="max-w-[260px] text-[11px] leading-4 text-slate-300">{tx.sector}</div>
              {tx.resolvedSector && (
                <div className="max-w-[260px] text-[11px] leading-4 text-slate-300">
                  SEC/SIC: {tx.resolvedSector}{tx.resolvedSic ? ` (${tx.resolvedSic})` : ''}
                </div>
              )}
            </Td>
            <Td align="right">
              <div className="font-mono text-xs">{tx.amount.label}</div>
              <div className="font-mono text-[11px] text-slate-300">{formatMoney(tx.amount.midpoint)} midpoint</div>
            </Td>
            <Td>
              <div className="space-y-1">
                {tx.lateFilingFlag ? <StatusPill tone="warn" label="Reported late" /> : <StatusPill tone="ok" label="On-time flag" />}
                <div className="text-[11px] text-slate-300">{confidenceLabel(tx.classificationConfidence)} classifier confidence</div>
                <div className="text-[11px] text-slate-300">{confidenceLabel(tx.enrichmentConfidence)} enrichment confidence</div>
                {tx.instrumentMatchConfidence > 0 && (
                  <div className="text-[11px] text-slate-300">{confidenceLabel(tx.instrumentMatchConfidence)} instrument read</div>
                )}
                <EnrichmentBadges flags={[...tx.enrichmentFlags, ...(tx.instrumentContextFlags || []), ...(tx.issuerContextFlags || [])]} />
              </div>
            </Td>
            <Td align="right">
              {tx.sourceUrl ? (
                <a href={tx.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-end gap-1 text-xs font-semibold text-sky-700">
                  PDF <ExternalLink className="h-3 w-3" />
                </a>
              ) : 'N/A'}
            </Td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

function EquityStockTable({ stocks }: { stocks: EquityStockSummary[] }) {
  if (stocks.length === 0) {
    return <div className="liquid-empty p-6 text-sm text-slate-300">No equity purchases in the visible transaction set.</div>;
  }

  return (
    <DataTable>
      <thead>
        <tr>
          <Th>Stock</Th>
          <Th>Public Reference</Th>
          <Th>Sector</Th>
          <Th align="right">Purchase Range</Th>
          <Th align="right">Purchase Midpoint</Th>
          <Th align="right">Sale Midpoint</Th>
          <Th align="right">Net Midpoint</Th>
          <Th>Net Direction</Th>
          <Th align="right">Buys</Th>
          <Th>Last Buy</Th>
          <Th>Confidence</Th>
        </tr>
      </thead>
      <tbody>
        {stocks.map((stock) => (
          <tr key={stock.id}>
            <Td>
              <div className="max-w-[360px] truncate font-semibold">{stock.stockName}</div>
              <div className="text-[11px] leading-4 text-slate-300">
                {stock.ticker ? `Source ticker ${stock.ticker}; ` : 'Source ticker not parsed; '}
                {formatInteger(stock.transactionCount)} equity rows, {formatInteger(stock.lateCount)} late.
              </div>
            </Td>
            <Td>
              <div className="font-semibold text-sky-800">{stock.resolvedTicker || 'No public match'}</div>
              <div className="max-w-[280px] text-[11px] leading-4 text-slate-300">
                {stock.resolvedExchange ? `${stock.resolvedExchange}; ` : ''}
                {stock.resolvedCik ? `CIK ${stock.resolvedCik}` : 'No SEC CIK'}
              </div>
              {stock.resolvedSicDescription && (
                <div className="max-w-[280px] text-[11px] leading-4 text-slate-300">{stock.resolvedSicDescription}</div>
              )}
              <EnrichmentBadges flags={stock.enrichmentFlags} />
            </Td>
            <Td>
              <div className="font-semibold">{stock.sector}</div>
              <div className="max-w-[260px] text-[11px] leading-4 text-slate-300">{describeSector(stock.sector)}</div>
            </Td>
            <Td align="right" mono>{formatRange(stock.purchases)}</Td>
            <Td align="right" mono>{formatMoney(stock.purchases.midpoint)}</Td>
            <Td align="right" mono>{formatMoney(stock.sales.midpoint)}</Td>
            <Td align="right" mono>{formatSignedMoney(stock.net.midpoint)}</Td>
            <Td>
              <div className="space-y-1">
                <StatusPill tone={netDirectionTone(stock.netDirection)} label={stock.netDirection} />
                <div className="max-w-[180px] text-[11px] leading-4 text-slate-300">{stock.netDirectionNote}</div>
              </div>
            </Td>
            <Td align="right" mono>{formatInteger(stock.purchaseCount)}</Td>
            <Td mono>{stock.lastPurchaseDate || 'N/A'}</Td>
            <Td>
              <div className="space-y-1">
                <StatusPill tone={stock.confidence >= 0.7 ? 'ok' : 'warn'} label={`${confidenceLabel(stock.confidence)} classifier`} />
                <StatusPill tone={stock.enrichmentConfidence >= 0.82 ? 'ok' : 'warn'} label={`${confidenceLabel(stock.enrichmentConfidence)} enrichment`} />
              </div>
            </Td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

function DataTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="liquid-table max-h-[70vh] overflow-y-auto rounded-[20px] border">
      <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
        {children}
      </table>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`sticky top-0 bg-white/80 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-300 backdrop-blur-xl ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}

function Td({ children, align = 'left', mono = false }: { children: React.ReactNode; align?: 'left' | 'right'; mono?: boolean }) {
  return (
    <td className={`border-t border-white/35 px-3 py-2 align-top ${align === 'right' ? 'text-right' : 'text-left'} ${mono ? 'font-mono text-xs' : ''}`}>
      {children}
    </td>
  );
}

function StatusPill({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'neutral' | 'buy' | 'sell' }) {
  const classes = {
    ok: 'bg-emerald-50/80 text-emerald-700 ring-emerald-200/70',
    warn: 'bg-amber-50/85 text-amber-800 ring-amber-200/80',
    neutral: 'bg-white/55 text-slate-300 ring-white/70',
    buy: 'bg-emerald-50/80 text-emerald-700 ring-emerald-200/70',
    sell: 'bg-rose-50/80 text-rose-700 ring-rose-200/70',
  }[tone];
  return <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ${classes}`}>{label}</span>;
}

function EnrichmentBadges({ flags }: { flags: string[] }) {
  const visibleFlags = Array.from(new Set(flags.filter(Boolean)));
  if (visibleFlags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {visibleFlags.slice(0, 3).map((flag) => (
        <StatusPill key={flag} tone={reviewFlagTone(flag)} label={flag} />
      ))}
    </div>
  );
}

function reviewFlagTone(flag: string): 'warn' | 'neutral' {
  if (flag === 'No public match') return 'neutral';
  if (flag.includes('Issuer context only')) return 'neutral';
  if (flag === 'No CUSIP/ISIN parsed') return 'neutral';
  return 'warn';
}

function referenceStatusLabel(status: InstrumentIdentity['referenceStatus']): string {
  if (status === 'exact') return 'Exact link';
  if (status === 'needs_identifier') return 'Needs ID';
  if (status === 'issuer_context_only') return 'Issuer only';
  return 'Not applicable';
}

function netDirectionTone(direction: EquityStockSummary['netDirection']): 'buy' | 'sell' | 'neutral' {
  if (direction === 'Net buy') return 'buy';
  if (direction === 'Net sale') return 'sell';
  return 'neutral';
}

interface EventMarker {
  month: string;
  monthIndex: number;
  eventId: string;
  date: string;
  title: string;
  summary: string;
  sourceName: string;
  category: EventCategory;
  importance: number;
  y: number;
}

interface TransactionMarker {
  month: string;
  monthIndex: number;
  transactionId: string;
  date: string;
  type: TransactionType;
  displayName: string;
  amountLabel: string;
  amountMidpoint: number;
  assetType: AssetType;
  sector: string;
  ticker: string | null;
  lateFilingFlag: boolean;
  y: number;
}

interface TransactionTypeOption {
  type: TransactionType;
  count: number;
}

interface TransactionSectorOption {
  sector: string;
  count: number;
  purchaseCount: number;
  saleCount: number;
}

interface TimingChartRow {
  month: string;
  monthIndex: number;
  purchaseMidpoint: number | null;
  saleMidpoint: number | null;
  count: number;
  hasTransactionFlow: boolean;
}

interface TimingFlowRow {
  month: string;
  purchaseMidpoint: number | null;
  saleMidpoint: number | null;
  count: number;
  hasTransactionFlow: boolean;
}

function buildTimingDateBounds(
  transactions: OgeTransaction[],
  events: OgeEvent[],
  historicalSources: HistoricalSource[],
  cacheMeta: CacheMeta
): DateRange {
  const candidateDates = [
    ...transactions.map((tx) => tx.date),
    ...events.flatMap((event) => [event.date, event.endDate || event.date]),
    ...historicalSources.map((source) => source.filedDate),
  ].filter(isIsoDate);
  const sortedDates = candidateDates.sort();
  const earliestDate = sortedDates[0] || '2015-01-01';
  const startDate = earliestDate < '2015-01-01' ? earliestDate : '2015-01-01';
  const endDate = [
    cacheMeta.dataThrough || '',
    cacheMeta.generatedAt.slice(0, 10),
    ...sortedDates,
  ].filter(isIsoDate).sort().at(-1) || new Date().toISOString().slice(0, 10);

  return {
    startDate,
    endDate,
    label: `${startDate} to ${endDate}`,
  };
}

function resolveTimingDateRange({
  preset,
  filters,
  customStartDate,
  customEndDate,
  bounds,
  visibleTransactions,
}: {
  preset: TimingRangePreset;
  filters: TrumpOgeFilters;
  customStartDate: string;
  customEndDate: string;
  bounds: DateRange;
  visibleTransactions: OgeTransaction[];
}): DateRange {
  const transactionDates = visibleTransactions.map((tx) => tx.date).filter(isIsoDate).sort();
  const clampRange = (startDate: string, endDate: string, label: string): DateRange => {
    const clampedStart = clampIsoDate(startDate || bounds.startDate, bounds.startDate, bounds.endDate);
    const clampedEnd = clampIsoDate(endDate || bounds.endDate, bounds.startDate, bounds.endDate);
    const orderedStart = clampedStart <= clampedEnd ? clampedStart : clampedEnd;
    const orderedEnd = clampedStart <= clampedEnd ? clampedEnd : clampedStart;
    return { startDate: orderedStart, endDate: orderedEnd, label };
  };

  if (preset === 'full') {
    return clampRange(bounds.startDate, bounds.endDate, 'full source history');
  }
  if (preset === 'since2025') {
    return clampRange('2025-01-01', bounds.endDate, '2025 to present');
  }
  if (preset === 'last24') {
    return clampRange(addMonths(bounds.endDate, -23), bounds.endDate, 'last 24 months');
  }
  if (preset === 'last12') {
    return clampRange(addMonths(bounds.endDate, -11), bounds.endDate, 'last 12 months');
  }
  if (preset === 'custom') {
    return clampRange(customStartDate || bounds.startDate, customEndDate || bounds.endDate, 'custom range');
  }

  const visibleStart = filters.startDate ||
    (filters.year && filters.year !== 'All' ? `${filters.year}-01-01` : transactionDates[0] || bounds.startDate);
  const visibleEnd = filters.endDate ||
    (filters.year && filters.year !== 'All' ? `${filters.year}-12-31` : bounds.endDate);
  return clampRange(visibleStart, visibleEnd, 'visible filters');
}

function filterEventsForTiming(
  events: OgeEvent[],
  filters: TrumpOgeFilters,
  transactions: OgeTransaction[],
  cacheDate: string
): OgeEvent[] {
  const transactionDates = transactions.map((tx) => tx.date).sort();
  const defaultStartDate = filters.startDate || (filters.year && filters.year !== 'All' ? `${filters.year}-01-01` : transactionDates[0] || '');
  const defaultEndDate = filters.endDate || cacheDate;

  return events.filter((event) => {
    if (filters.year && filters.year !== 'All' && !event.date.startsWith(String(filters.year))) return false;
    if (defaultStartDate && (event.endDate || event.date) < defaultStartDate) return false;
    if (defaultEndDate && event.date > defaultEndDate) return false;
    return true;
  });
}

function buildTimingMonthlyFlow(
  transactionMonths: TimingFlowRow[],
  events: OgeEvent[],
  activeCategories: EventCategory[],
  dateRange?: DateRange
): TimingFlowRow[] {
  const byMonth = new Map(transactionMonths.map((row) => [row.month, { ...row }]));
  if (dateRange?.startDate && dateRange.endDate) {
    for (const month of monthsBetween(dateRange.startDate, dateRange.endDate)) {
      if (!byMonth.has(month)) {
        byMonth.set(month, { month, purchaseMidpoint: null, saleMidpoint: null, count: 0, hasTransactionFlow: false });
      }
    }
  }
  for (const event of events) {
    if (!activeCategories.includes(event.category)) continue;
    const month = eventMonth(event);
    if (!byMonth.has(month)) {
      byMonth.set(month, { month, purchaseMidpoint: null, saleMidpoint: null, count: 0, hasTransactionFlow: false });
    }
  }
  return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
}

function buildTimelineEvents(
  events: OgeEvent[],
  monthlyFlow: Array<{ month: string }>,
  activeCategories: EventCategory[]
): OgeEvent[] {
  const visibleMonths = new Set(monthlyFlow.map((row) => row.month));
  if (visibleMonths.size === 0) return [];

  return events
    .filter((event) => activeCategories.includes(event.category))
    .filter((event) => visibleMonths.has(eventMonth(event)))
    .sort((a, b) =>
      b.date.localeCompare(a.date) ||
      b.importance - a.importance ||
      a.title.localeCompare(b.title)
    );
}

function buildTransactionMarkers(
  transactions: OgeTransaction[],
  monthlyFlow: TimingFlowRow[],
  chartMaxY: number
): TransactionMarker[] {
  const monthOrder = new Map(monthlyFlow.map((row, index) => [row.month, index]));
  const stackedByPoint = new Map<string, number>();

  return transactions
    .flatMap((tx) => {
      const month = tx.date.slice(0, 7);
      const monthIndex = monthOrder.get(month);
      if (monthIndex === undefined) return [];

      const pointKey = `${tx.date}|${tx.type}|${tx.amount.midpoint}|${tx.assetType}`;
      const stackedIndex = stackedByPoint.get(pointKey) || 0;
      stackedByPoint.set(pointKey, stackedIndex + 1);
      const baseX = monthIndex + (eventDateFraction(tx.date) - 0.5) * 0.78;
      const xJitter = deterministicSignedJitter(tx.id, 0.09);
      const yJitter = deterministicSignedJitter(`${tx.id}|y`, chartMaxY * 0.006);
      const minX = monthIndex - 0.42;
      const maxX = monthIndex + 0.42;

      return {
        month,
        monthIndex: Math.min(maxX, Math.max(minX, baseX + xJitter)),
        transactionId: tx.id,
        date: tx.date,
        type: tx.type,
        displayName: transactionDisplayName(tx),
        amountLabel: tx.amount.label,
        amountMidpoint: tx.amount.midpoint,
        assetType: tx.assetType,
        sector: tx.sector,
        ticker: tx.resolvedTicker || tx.ticker,
        lateFilingFlag: tx.lateFilingFlag,
        y: Math.max(0, tx.amount.midpoint + yJitter + stackedIndex * chartMaxY * 0.0012),
      };
    })
    .sort((a, b) => a.monthIndex - b.monthIndex || b.amountMidpoint - a.amountMidpoint || a.displayName.localeCompare(b.displayName));
}

function buildTransactionTypeOptions(markers: TransactionMarker[]): TransactionTypeOption[] {
  const order: TransactionType[] = ['Purchase', 'Sale', 'Exchange', 'Other'];
  return order
    .map((type) => ({
      type,
      count: markers.filter((marker) => marker.type === type).length,
    }))
    .filter((option) => option.count > 0);
}

function buildTransactionSectorOptions(markers: TransactionMarker[]): TransactionSectorOption[] {
  const bySector = new Map<string, TransactionSectorOption>();
  for (const marker of markers) {
    const row = bySector.get(marker.sector) || {
      sector: marker.sector,
      count: 0,
      purchaseCount: 0,
      saleCount: 0,
    };
    row.count += 1;
    if (marker.type === 'Purchase') row.purchaseCount += 1;
    if (marker.type === 'Sale') row.saleCount += 1;
    bySector.set(marker.sector, row);
  }

  return Array.from(bySector.values()).sort((a, b) => b.count - a.count || a.sector.localeCompare(b.sector));
}

function buildChartEventPins(markers: EventMarker[], selectedEventId: string | null): EventMarker[] {
  const byBucket = new Map<string, EventMarker>();
  for (const marker of markers) {
    const key = eventDensityKey(marker.category, marker.month);
    const current = byBucket.get(key);
    if (!current || compareEventMarkerSignal(marker, current) < 0) {
      byBucket.set(key, marker);
    }
  }

  const pins = Array.from(byBucket.values());
  if (selectedEventId && !pins.some((marker) => marker.eventId === selectedEventId)) {
    const selected = markers.find((marker) => marker.eventId === selectedEventId);
    if (selected) pins.push(selected);
  }

  return pins.sort((a, b) => a.monthIndex - b.monthIndex || compareEventMarkerSignal(a, b));
}

function buildEventMarkers(
  events: OgeEvent[],
  monthlyFlow: TimingFlowRow[],
  chartMaxY: number
): EventMarker[] {
  const monthOrder = new Map(monthlyFlow.map((row, index) => [row.month, index]));
  const stackedByLane = new Map<string, number>();
  const laneCount = Math.max(1, EVENT_CATEGORIES.length);
  const laneStep = Math.min(0.045, 0.39 / Math.max(1, laneCount - 1));

  return [...events]
    .sort((a, b) =>
      a.date.localeCompare(b.date) ||
      EVENT_CATEGORIES.indexOf(a.category) - EVENT_CATEGORIES.indexOf(b.category) ||
      b.importance - a.importance ||
      a.title.localeCompare(b.title)
    )
    .flatMap((event) => {
      const month = eventMonth(event);
      const monthIndex = monthOrder.get(month);
      if (monthIndex === undefined) return [];

      const categoryIndex = Math.max(0, EVENT_CATEGORIES.indexOf(event.category));
      const laneKey = `${month}|${event.date}|${event.category}`;
      const stackedIndex = stackedByLane.get(laneKey) || 0;
      stackedByLane.set(laneKey, stackedIndex + 1);
      const laneY = chartMaxY * (0.95 - categoryIndex * laneStep);
      const collisionOffset = chartMaxY * 0.006 * (stackedIndex % 6);

      return {
        month,
        monthIndex: monthIndex + (eventDateFraction(event.date) - 0.5) * 0.78,
        eventId: event.id,
        date: event.date,
        title: event.title,
        summary: event.summary,
        sourceName: event.sourceName,
        category: event.category,
        importance: event.importance,
        y: Math.max(chartMaxY * 0.5, laneY - collisionOffset),
      };
    })
    .sort((a, b) => a.monthIndex - b.monthIndex || b.importance - a.importance || a.title.localeCompare(b.title));
}

function selectLeadEventMarker(markers: EventMarker[]): EventMarker | null {
  return [...markers].sort(compareEventMarkerSignal)[0] || null;
}

function compareEventMarkerSignal(a: EventMarker, b: EventMarker): number {
  return (
    b.importance - a.importance ||
    b.date.localeCompare(a.date) ||
    a.title.localeCompare(b.title)
  );
}

function eventDensityKey(category: EventCategory, month: string): string {
  return `${category}|${month}`;
}

function transactionDisplayName(tx: OgeTransaction): string {
  return (
    tx.resolvedIssuerName ||
    tx.instrumentIssuerName ||
    tx.instrumentReferenceLabel ||
    tx.description
  );
}

function transactionColor(type: TransactionType): string {
  if (type === 'Purchase') return '#059669';
  if (type === 'Sale') return '#dc2626';
  return '#64748b';
}

function transactionTypeLabel(type: TransactionType): string {
  if (type === 'Purchase') return 'Buys';
  if (type === 'Sale') return 'Sells';
  return type;
}

function deterministicSignedJitter(seed: string, amplitude: number): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  const normalized = (hash % 10_000) / 10_000;
  return (normalized - 0.5) * 2 * amplitude;
}

function eventDateFraction(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) || month < 1 || month > 12) {
    return 0.5;
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  if (daysInMonth <= 1) return 0.5;
  return Math.min(1, Math.max(0, (day - 1) / (daysInMonth - 1)));
}

function isEventMarker(value: unknown): value is EventMarker {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'eventId' in value &&
    'category' in value &&
    'date' in value
  );
}

function isTransactionMarker(value: unknown): value is TransactionMarker {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'transactionId' in value &&
    'amountMidpoint' in value &&
    'assetType' in value
  );
}

function isTimingChartRow(value: unknown): value is TimingChartRow {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'month' in value &&
    'purchaseMidpoint' in value &&
    'saleMidpoint' in value
  );
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortMonthLabel(month: string): string {
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const year = month.slice(2, 4);
  return `${MONTH_LABELS[monthIndex] || month.slice(5, 7)} '${year}`;
}

function monthAxisLabel(month: string, index: number, total: number): string {
  if (total > 24 && index % 2 !== 0) return '';
  const monthNumber = month.slice(5, 7);
  if (monthNumber === '01' || index === 0) return shortMonthLabel(month);
  return MONTH_LABELS[Number(monthNumber) - 1] || monthNumber;
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const full = value.length === 3
    ? value.split('').map((char) => `${char}${char}`).join('')
    : value;
  const numeric = Number.parseInt(full, 16);
  if (!Number.isFinite(numeric)) return `rgba(100, 116, 139, ${alpha})`;
  const red = (numeric >> 16) & 255;
  const green = (numeric >> 8) & 255;
  const blue = numeric & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function isIsoDate(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function clampIsoDate(value: string, min: string, max: string): string {
  if (!isIsoDate(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function addMonths(date: string, monthDelta: number): string {
  if (!isIsoDate(date)) return date;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return date;

  const next = new Date(Date.UTC(year, month - 1 + monthDelta, 1));
  const daysInMonth = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, daysInMonth));
  return next.toISOString().slice(0, 10);
}

function monthsBetween(startDate: string, endDate: string): string[] {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return [];
  const startYear = Number(startDate.slice(0, 4));
  const startMonth = Number(startDate.slice(5, 7));
  const endYear = Number(endDate.slice(0, 4));
  const endMonth = Number(endDate.slice(5, 7));
  if (![startYear, startMonth, endYear, endMonth].every(Number.isFinite)) return [];

  const months: string[] = [];
  let cursor = new Date(Date.UTC(startYear, startMonth - 1, 1));
  const end = new Date(Date.UTC(endYear, endMonth - 1, 1));
  while (cursor <= end && months.length < 240) {
    months.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`);
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return months;
}

function selectTimelineTicks(indexes: number[]): number[] {
  if (indexes.length <= 30) return indexes;
  const maxTicks = 14;
  const step = Math.max(1, Math.ceil(indexes.length / maxTicks));
  const ticks = indexes.filter((_, index) => index === 0 || index === indexes.length - 1 || index % step === 0);
  const last = indexes.at(-1);
  return last !== undefined && !ticks.includes(last) ? [...ticks, last] : ticks;
}

function eventDateLabel(event: OgeEvent): string {
  return event.endDate && event.endDate !== event.date ? `${event.date} to ${event.endDate}` : event.date;
}

function buildChartMaxY(rows: Array<{ purchaseMidpoint: number | null; saleMidpoint: number | null }>): number {
  const maxValue = Math.max(
    1,
    ...rows.flatMap((row) => [row.purchaseMidpoint || 0, row.saleMidpoint || 0])
  );
  return maxValue * 1.18;
}

function buildMonthlyFlow(transactions: OgeTransaction[]): TimingFlowRow[] {
  const byMonth = new Map<string, TimingFlowRow>();
  for (const tx of transactions) {
    const month = tx.date.slice(0, 7);
    const row = byMonth.get(month) || { month, purchaseMidpoint: 0, saleMidpoint: 0, count: 0, hasTransactionFlow: true };
    if (tx.type === 'Purchase') row.purchaseMidpoint = (row.purchaseMidpoint || 0) + tx.amount.midpoint;
    if (tx.type === 'Sale') row.saleMidpoint = (row.saleMidpoint || 0) + tx.amount.midpoint;
    row.count += 1;
    byMonth.set(month, row);
  }
  return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
}

function buildMonthlyActivity(transactions: OgeTransaction[]): MonthActivityRow[] {
  const byMonth = new Map<string, MonthActivityRow>();
  for (const tx of transactions) {
    const month = tx.date.slice(0, 7);
    const row = byMonth.get(month) || {
      month,
      count: 0,
      lateCount: 0,
      purchaseCount: 0,
      saleCount: 0,
      lateShare: 0,
    };
    row.count += 1;
    if (tx.lateFilingFlag) row.lateCount += 1;
    if (tx.type === 'Purchase') row.purchaseCount += 1;
    if (tx.type === 'Sale') row.saleCount += 1;
    row.lateShare = row.count > 0 ? row.lateCount / row.count : 0;
    byMonth.set(month, row);
  }
  return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
}

function buildAssetSummary(transactions: OgeTransaction[]) {
  const byAsset = new Map<AssetType, number>();
  for (const tx of transactions) {
    byAsset.set(tx.assetType, (byAsset.get(tx.assetType) || 0) + 1);
  }
  return Array.from(byAsset.entries())
    .map(([assetType, count]) => ({ assetType, count }))
    .sort((a, b) => b.count - a.count);
}

function buildAssetSummaryFromSectorSummaries(summaries: SectorSummary[]) {
  return summaries
    .filter((summary) => summary.assetType !== 'All')
    .map((summary) => ({
      assetType: summary.assetType as AssetType,
      count: summary.transactionCount,
    }))
    .sort((a, b) => b.count - a.count);
}

function buildSectorTiles(summaries: SectorSummary[]): SectorTile[] {
  return summaries
    .map((summary) => ({
      sector: summary.sector,
      description: describeSector(summary.sector),
      value: Math.max(summary.purchases.midpoint + summary.sales.midpoint, Math.abs(summary.net.midpoint), 1),
      netMidpoint: summary.net.midpoint,
      purchaseMidpoint: summary.purchases.midpoint,
      saleMidpoint: summary.sales.midpoint,
      count: summary.transactionCount,
      lateCount: summary.lateCount,
      publicCompanyCount: summary.publicCompanyCount,
      confidence: summary.confidence,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 18);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'pending';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value || 0);
}

function formatSignedMoney(value: number): string {
  const prefix = value >= 0 ? '+' : '-';
  return `${prefix}${formatMoney(Math.abs(value))}`;
}

function formatPct(numerator: number, denominator: number): string {
  if (!denominator) return '0.0%';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function isSectorTile(value: SectorTile | TreeRoot): value is SectorTile {
  return 'sector' in value;
}

function truncateSvgText(value: string, width: number): string {
  const maxCharacters = Math.max(8, Math.floor(width / 8));
  return value.length <= maxCharacters ? value : `${value.slice(0, Math.max(0, maxCharacters - 1))}...`;
}
