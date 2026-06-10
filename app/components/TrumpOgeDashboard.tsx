"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
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
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { buildHoldingsEstimates, buildKpis, buildSectorSummaries } from '@/lib/oge/analytics';
import {
  buildEventWindows,
  EVENT_CATEGORY_COLORS,
  eventCategoryLabel,
  eventMonth,
  eventWindowBounds,
} from '@/lib/oge/events';
import { filterTransactions } from '@/lib/oge/filter';
import { buildTrumpIndex, buildTrumpIndexRollups } from '@/lib/oge/index';
import { EMPTY_SECURITY_REFERENCE } from '@/lib/oge/enrichment';
import { formatMoney, formatRange } from '@/lib/oge/amounts';
import { confidenceLabel, describeAssetType, describeSector, describeTransaction, summarizeSector } from '@/lib/oge/descriptions';
import { buildEquityStockSummaries, deriveEquityStockName, type EquityStockSummary } from '@/lib/oge/stocks';
import { buildTrumpOgeWorkbook, trumpOgeWorkbookFilename } from '@/lib/oge/workbook';
import type {
  AssetIncomeHolding,
  AssetType,
  BaselineHolding,
  CacheMeta,
  EstimatedHolding,
  EventCategory,
  EventWindowSummary,
  FinancialDisclosureReport,
  HistoricalSource,
  Liability,
  OgeEvent,
  OgeTransaction,
  ReviewQueueItem,
  SecurityEnrichment,
  SectorSummary,
  SourceAudit,
  SourceFiling,
  SourceReliability,
  TrumpIndexCitation,
  TrumpIndexEntry,
  TrumpOgeApiResponse,
  TrumpOgeDataset,
  TrumpOgeFilters,
  YearlyExposureSummary,
} from '@/lib/oge/types';

interface TrumpOgeDashboardProps {
  initialData?: TrumpOgeApiResponse | null;
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

export function TrumpOgeDashboard({ initialData }: TrumpOgeDashboardProps) {
  const [loadedData, setLoadedData] = useState<TrumpOgeApiResponse | null>(initialData || null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (initialData || loadedData) return;
    let cancelled = false;
    loadDashboardData()
      .then((data) => {
        if (!cancelled) setLoadedData(data);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [initialData, loadedData]);

  const data = initialData || loadedData;
  if (!data) {
    return <DashboardLoading error={loadError} />;
  }

  return <TrumpOgeDashboardLoaded initialData={data} />;
}

function TrumpOgeDashboardLoaded({ initialData }: { initialData: TrumpOgeApiResponse }) {
  const mounted = useClientReady();
  const [filters, setFilters] = useState<TrumpOgeFilters>(FILTER_DEFAULTS);
  const [activePage, setActivePage] = useState<PageKey>('ask');
  const [activeEventCategories, setActiveEventCategories] = useState<EventCategory[]>(EVENT_CATEGORIES);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [selectedIndexIds, setSelectedIndexIds] = useState<string[]>([]);
  const activePageDefinition = PAGE_DEFINITIONS.find((page) => page.key === activePage) || PAGE_DEFINITIONS[0];
  const pageFilters = useMemo(
    () => activePageDefinition.assetType ? { ...filters, assetType: 'All' } : filters,
    [activePageDefinition.assetType, filters]
  );

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
  const kpis = useMemo(
    () => buildKpis({
      sourceFilings: initialData.sourceFilings,
      transactions: filteredTransactions,
      reviewQueue: initialData.reviewQueue,
    }),
    [filteredTransactions, initialData.reviewQueue, initialData.sourceFilings]
  );
  const sectorSummaries = useMemo(
    () => buildSectorSummaries(filteredTransactions),
    [filteredTransactions]
  );
  const holdings = useMemo(
    () => buildHoldingsEstimates(filteredTransactions, initialData.baselineHoldings),
    [filteredTransactions, initialData.baselineHoldings]
  );
  const trumpIndexResult = useMemo(
    () => buildTrumpIndex({
      holdings,
      transactions: filteredTransactions,
      sourceFilings: initialData.sourceFilings,
      historicalSources: initialData.historicalSources,
    }),
    [filteredTransactions, holdings, initialData.historicalSources, initialData.sourceFilings]
  );
  const trumpIndexEntries = useMemo(
    () => trumpIndexResult.entries.filter((entry) => {
      if (filters.sourceReliability && filters.sourceReliability !== 'All' && entry.sourceReliability !== filters.sourceReliability) return false;
      if (filters.ticker) {
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
    }),
    [filters.issuer, filters.sourceReliability, filters.ticker, trumpIndexResult.entries]
  );
  const trumpIndexRollups = useMemo(
    () => buildTrumpIndexRollups(trumpIndexEntries),
    [trumpIndexEntries]
  );
  const indexLeaders = useMemo(() => ({
    exposures: [...trumpIndexEntries].sort((a, b) => b.currentMidpoint - a.currentMidpoint).slice(0, 5),
    movers: [...trumpIndexEntries].sort((a, b) => Math.abs(b.changeMidpoint) - Math.abs(a.changeMidpoint)).slice(0, 5),
    netBuys: trumpIndexEntries.filter((entry) => entry.netFlowMidpoint > 0).sort((a, b) => b.netFlowMidpoint - a.netFlowMidpoint).slice(0, 5),
    netSells: trumpIndexEntries.filter((entry) => entry.netFlowMidpoint < 0).sort((a, b) => a.netFlowMidpoint - b.netFlowMidpoint).slice(0, 5),
  }), [trumpIndexEntries]);
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

  const monthlyFlow = useMemo(() => buildMonthlyFlow(filteredTransactions), [filteredTransactions]);
  const monthlyActivity = useMemo(() => buildMonthlyActivity(filteredTransactions), [filteredTransactions]);
  const timelineEvents = useMemo(
    () => buildTimelineEvents(initialData.events, monthlyFlow, activeEventCategories),
    [activeEventCategories, initialData.events, monthlyFlow]
  );
  const eventWindows = useMemo(
    () => buildEventWindows(timelineEvents, filteredTransactions),
    [filteredTransactions, timelineEvents]
  );
  const chartMaxY = useMemo(() => buildChartMaxY(monthlyFlow), [monthlyFlow]);
  const eventMarkers = useMemo(() => buildEventMarkers(timelineEvents, monthlyFlow, chartMaxY), [chartMaxY, timelineEvents, monthlyFlow]);
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
  const assetSummary = buildAssetSummary(filteredTransactions);
  const enrichedTransactionCount = filteredTransactions.filter((tx) => tx.resolvedTicker).length;
  const issuerContextCount = filteredTransactions.filter((tx) =>
    !tx.resolvedTicker && (tx.issuerContextTicker || tx.instrumentReferenceLabel)
  ).length;
  const availableYears = useMemo(
    () => Array.from(new Set([
      ...initialData.transactions.map((tx) => tx.date.slice(0, 4)),
      ...initialData.historicalSources.map((source) => source.reportYear ? String(source.reportYear) : source.filedDate.slice(0, 4)),
    ].filter(Boolean))).sort((a, b) => b.localeCompare(a)),
    [initialData.historicalSources, initialData.transactions]
  );

  const exportWorkbook = () => {
    const response: TrumpOgeApiResponse = {
      ...initialData,
      transactions: filteredTransactions,
      holdingsEstimates: holdings,
      sectorSummaries,
      trumpIndex: trumpIndexEntries,
      trumpIndexRollups,
      eventWindows: buildEventWindows(initialData.events, filteredTransactions),
      kpis,
      filters: {
        ...filters,
        lateOnly: Boolean(filters.lateOnly),
      },
    };
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

  const applyEventWindowFilter = (event: OgeEvent, windowDays: 7 | 30) => {
    const bounds = eventWindowBounds(event, windowDays);
    setFilters((current) => ({
      ...current,
      startDate: bounds.startDate,
      endDate: bounds.endDate,
    }));
  };

  return (
    <main className="liquid-app min-h-screen text-slate-950">
      <header className="liquid-header sticky top-0 z-30">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="liquid-icon flex h-10 w-10 items-center justify-center text-slate-950">
              <Database className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold tracking-tight">Trump Index</h1>
              <div className="text-xs text-slate-600">OGE financial disclosure signal | data through {initialData.cacheMeta.dataThrough || 'pending'} | refreshed {formatDateTime(initialData.cacheMeta.generatedAt)}</div>
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
              className="liquid-button-primary flex h-9 items-center gap-2 px-3 text-xs font-semibold"
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-5 py-5">
        <section className="liquid-panel mb-5 grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-[1.35fr_0.55fr_0.75fr_0.75fr_0.75fr_0.75fr_auto]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
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

        <PageIntro page={activePageDefinition} transactionCount={filteredTransactions.length} indexCount={trumpIndexEntries.length} />

        {activePage !== 'ask' && (
          <>
            <section className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <KpiCard label="Index entries" value={formatInteger(trumpIndexEntries.length)} sub={`${formatInteger(kpis.uniqueSecurities)} securities; ${formatInteger(enrichedTransactionCount)} direct, ${formatInteger(issuerContextCount)} issuer/instrument refs`} icon={<Layers className="h-4 w-4" />} />
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

        {activePageDefinition.assetType && (
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

        {activePage === 'index' && (
          <div className="space-y-5">
            <Panel
              title="Trump Index"
              subtitle={`${formatInteger(trumpIndexEntries.length)} ranked issuer/security exposures; score is calculated from exposure, change, and activity`}
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
                <span className="text-xs font-semibold text-slate-500">{methodologyOpen ? 'Hide' : 'Show'}</span>
              </button>
              {methodologyOpen && (
                <div className="border-t border-white/35 px-4 py-3 text-xs leading-5 text-slate-600">
                  Score = 50% log-scaled current midpoint exposure rank + 30% absolute midpoint change rank + 20% gross transaction activity rank.
                  Confidence, source reliability, archived-copy badges, and metadata-only badges stay visible beside the score but do not reduce it.
                  Event dots are contextual only and are not scoring inputs.
                </div>
              )}
            </div>
          </div>
        )}

        {activePage === 'sectors' && (
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

        {activePage === 'timing' && (
          <TimingPage
            mounted={mounted}
            monthlyFlow={monthlyFlow}
            monthlyActivity={monthlyActivity}
            eventMarkers={eventMarkers}
            selectedEvent={selectedEvent}
            selectedEventWindows={selectedEventWindows}
            chartMaxY={chartMaxY}
            availableEventCategories={availableEventCategories}
            activeEventCategories={activeEventCategories}
            onSelectEvent={setSelectedEventId}
            onToggleCategory={toggleEventCategory}
            onApplyWindow={applyEventWindowFilter}
            onClearWindow={() => setFilters((current) => ({ ...current, startDate: '', endDate: '' }))}
          />
        )}

        {activePage === 'holdings' && (
          <div className="space-y-5">
            <Panel title="Estimated Holdings" subtitle="Transaction-implied ranges with baseline flags">
              <HoldingsTable holdings={holdings.slice(0, 120)} />
            </Panel>
          </div>
        )}

        {activePage === 'transactions' && (
          <Panel title="Transactions" subtitle={`${formatInteger(filteredTransactions.length)} filtered rows`}>
            <TransactionTable transactions={filteredTransactions.slice(0, 250)} />
          </Panel>
        )}

        {activePage === 'filings' && (
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
                        <div className="text-[11px] text-slate-500">{source.reportYear || 'No report year'}</div>
                      </Td>
                      <Td><StatusPill tone={sourceReliabilityTone(source.sourceReliability)} label={sourceReliabilityLabel(source.sourceReliability)} /></Td>
                      <Td>
                        <div className="max-w-[360px] truncate font-semibold">{source.title}</div>
                        <div className="text-[11px] text-slate-500">{source.provenanceNote}</div>
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
                        <div className="text-[11px] text-slate-500">{filing.notes}</div>
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

        {activePage === 'review' && (
          <Panel title="Review Queue" subtitle={`${initialData.reviewQueue.length} parser, baseline, and classification flags`}>
            <div className="grid gap-3 lg:grid-cols-2">
              {initialData.reviewQueue.slice(0, 120).map((item) => (
                <div key={item.id} className="liquid-surface p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <StatusPill tone={item.severity === 'high' ? 'warn' : item.severity === 'medium' ? 'neutral' : 'ok'} label={item.severity} />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{item.kind}</span>
                  </div>
                  <div className="text-sm font-semibold">{item.title}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-600">{item.detail}</div>
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
    <main className="liquid-app flex min-h-screen items-center justify-center px-5 text-slate-900">
      <section className="liquid-panel w-full max-w-lg p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className="liquid-icon flex h-9 w-9 items-center justify-center">
            <Database className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-base font-bold">Trump Index</h1>
            <div className="text-xs text-slate-500">Loading versioned OGE cache files</div>
          </div>
        </div>
        {error ? (
          <div className="border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
            Could not load dashboard data: {error}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="h-2 overflow-hidden rounded-full bg-white/45">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-slate-900/85" />
            </div>
            <div className="text-sm text-slate-600">Preparing the reporter dashboard...</div>
          </div>
        )}
      </section>
    </main>
  );
}

async function loadDashboardData(): Promise<TrumpOgeApiResponse> {
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
    reviewQueue,
    events,
    securityEnrichments,
    cacheMeta,
  ] = await Promise.all([
    importJson<HistoricalSource[]>(() => import('@/data/oge/trump/historical-sources.json')),
    importJson<SourceFiling[]>(() => import('@/data/oge/trump/source-filings.json')),
    importJson<OgeTransaction[]>(() => import('@/data/oge/trump/transactions.json')),
    importJson<BaselineHolding[]>(() => import('@/data/oge/trump/baseline-holdings.json')),
    importJson<FinancialDisclosureReport[]>(() => import('@/data/oge/trump/financial-disclosure-reports.json')),
    importJson<AssetIncomeHolding[]>(() => import('@/data/oge/trump/asset-income-holdings.json')),
    importJson<Liability[]>(() => import('@/data/oge/trump/liabilities.json')),
    importJson<YearlyExposureSummary[]>(() => import('@/data/oge/trump/yearly-exposure-summaries.json')),
    importJson<SourceAudit>(() => import('@/data/oge/trump/source-audit.json')),
    importJson<ReviewQueueItem[]>(() => import('@/data/oge/trump/review-queue.json')),
    importJson<OgeEvent[]>(() => import('@/data/oge/trump/events.json')),
    importJson<SecurityEnrichment[]>(() => import('@/data/oge/trump/security-enrichment.json')),
    importJson<CacheMeta>(() => import('@/data/oge/trump/cache-meta.json')),
  ]);

  const dataset: TrumpOgeDataset = {
    historicalSources,
    sourceFilings,
    transactions,
    baselineHoldings,
    financialDisclosureReports,
    assetIncomeHoldings,
    liabilities,
    yearlyExposureSummaries,
    sourceAudit,
    holdingsEstimates: [],
    sectorSummaries: [],
    trumpIndex: [],
    trumpIndexRollups: [],
    reviewQueue,
    events,
    eventWindows: [],
    securityReference: EMPTY_SECURITY_REFERENCE,
    securityEnrichments,
    cacheMeta,
  };

  return {
    ...dataset,
    kpis: buildKpis({
      sourceFilings,
      transactions,
      reviewQueue,
    }),
    filters: {
      lateOnly: false,
    },
    availableSectors: Array.from(new Set(transactions.map((tx) => tx.sector))).sort(),
    availableAssetTypes: Array.from(new Set(transactions.map((tx) => tx.assetType))).sort(),
  };
}

async function importJson<T>(loader: () => Promise<{ default: unknown }>): Promise<T> {
  return (await loader()).default as T;
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
          <div className="liquid-surface mb-2 inline-flex items-center gap-2 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-600">
            {page.icon}
            {page.eyebrow}
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-950">{page.label}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">{page.description}</p>
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
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 max-w-[160px] truncate font-mono text-sm font-bold text-slate-900">{value}</div>
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
          <div className="space-y-3 text-sm leading-6 text-slate-600">
            <div className="liquid-surface p-3">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Current facts packet</div>
              <div className="mt-2 text-sm">
                {formatInteger(selectedIndexIds.length || topEntries.length)} selected or top-ranked index entries, active filters, cache version, citations, and caveats.
              </div>
            </div>
            <div className="liquid-surface p-3">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Completeness</div>
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

function MetricCard({ label, value, tone }: { label: string; value: string; tone: 'buy' | 'sell' | 'neutral' }) {
  const color = tone === 'buy' ? 'text-emerald-700' : tone === 'sell' ? 'text-rose-700' : 'text-slate-800';
  return (
    <div className="liquid-surface p-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-2 font-mono text-xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function AssetTypeMix({ rows, total }: { rows: Array<{ assetType: AssetType; count: number }>; total: number }) {
  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <div key={row.assetType}>
          <div className="mb-1 flex items-center justify-between gap-3 text-xs">
            <span className="font-semibold">{row.assetType}</span>
            <span className="font-mono text-slate-500">{formatInteger(row.count)} rows</span>
          </div>
          <div className="h-2.5 rounded-full bg-white/45">
            <div
              className="h-2.5 rounded-full"
              style={{
                width: `${Math.max(3, (row.count / Math.max(1, total)) * 100)}%`,
                backgroundColor: ASSET_COLORS[row.assetType] || '#64748b',
              }}
            />
          </div>
          <div className="mt-1 text-[11px] leading-4 text-slate-500">{describeAssetType(row.assetType)}</div>
        </div>
      ))}
    </div>
  );
}

function FlowDivergingBars({ summaries }: { summaries: SectorSummary[] }) {
  const maxNet = Math.max(1, ...summaries.map((summary) => Math.abs(summary.net.midpoint)));
  return (
    <div className="space-y-3">
      {summaries.length === 0 && <div className="liquid-empty p-4 text-sm text-slate-500">No sector flow for this page.</div>}
      {summaries.map((summary) => {
        const isBuy = summary.net.midpoint >= 0;
        const width = Math.max(4, (Math.abs(summary.net.midpoint) / maxNet) * 50);
        return (
          <div key={`${summary.key}-${summary.assetType}`} className="grid grid-cols-[minmax(110px,0.7fr)_minmax(180px,1.3fr)_92px] items-center gap-3 text-xs">
            <div className="truncate font-semibold">{summary.sector}</div>
            <div className="relative h-7 rounded-full bg-white/45">
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
    return <div className="liquid-empty flex h-[340px] items-center justify-center text-sm text-slate-500">No index entries for this asset class.</div>;
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
  eventMarkers,
  selectedEvent,
  selectedEventWindows,
  chartMaxY,
  availableEventCategories,
  activeEventCategories,
  onSelectEvent,
  onToggleCategory,
  onApplyWindow,
  onClearWindow,
}: {
  mounted: boolean;
  monthlyFlow: Array<{ month: string; purchaseMidpoint: number; saleMidpoint: number; count: number }>;
  monthlyActivity: MonthActivityRow[];
  eventMarkers: EventMarker[];
  selectedEvent: OgeEvent | null;
  selectedEventWindows: EventWindowSummary[];
  chartMaxY: number;
  availableEventCategories: EventCategory[];
  activeEventCategories: EventCategory[];
  onSelectEvent: (id: string) => void;
  onToggleCategory: (category: EventCategory) => void;
  onApplyWindow: (event: OgeEvent, windowDays: 7 | 30) => void;
  onClearWindow: () => void;
}) {
  return (
    <div className="space-y-5">
      <Panel title="Transaction Timing" subtitle="Transaction dates from the filings, with public events shown as contextual dots">
        <div className="h-[430px] w-full min-w-0">
          {mounted ? (
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart data={monthlyFlow}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, chartMaxY]} tickFormatter={(value) => formatMoney(Number(value))} width={78} />
                <Tooltip formatter={(value) => formatMoney(Number(value))} />
                {eventMarkers.map((marker) => (
                  <ReferenceDot
                    key={`${marker.month}-${marker.leadEventId}`}
                    x={marker.month}
                    y={marker.y}
                    r={selectedEvent?.id === marker.leadEventId ? 8 : Math.min(8, 4 + marker.count)}
                    fill={EVENT_CATEGORY_COLORS[marker.category]}
                    stroke={selectedEvent?.id === marker.leadEventId ? '#0f172a' : '#ffffff'}
                    strokeWidth={2}
                    ifOverflow="visible"
                    cursor="pointer"
                    onClick={() => onSelectEvent(marker.leadEventId)}
                    label={{
                      value: marker.count > 1 ? `${marker.count}` : '',
                      position: 'top',
                      fill: EVENT_CATEGORY_COLORS[marker.category],
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  />
                ))}
                <Line type="monotone" dataKey="purchaseMidpoint" name="Purchases" stroke="#059669" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="saleMidpoint" name="Sales" stroke="#dc2626" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <ChartPlaceholder />}
        </div>
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
                <div className="max-w-[460px] text-[11px] leading-4 text-slate-600">{holding.instrumentSummary}</div>
              )}
              <div className="text-[11px] leading-4 text-slate-500">
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
              {!holding.resolvedTicker && !holding.issuerContextTicker && holding.instrumentReferenceLabel && (
                <a href={holding.instrumentReferenceUrl || 'https://emma.msrb.org/'} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-800">
                  {holding.instrumentReferenceLabel}{holding.instrumentReferenceSource ? ` | ${holding.instrumentReferenceSource}` : ''} <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </Td>
            <Td>
              <div className="font-semibold">{holding.assetType}</div>
              <div className="text-[11px] leading-4 text-slate-500">{holding.sector}</div>
              {holding.resolvedSicDescription && (
                <div className="text-[11px] leading-4 text-slate-500">{holding.resolvedSicDescription}</div>
              )}
            </Td>
            <Td align="right" mono>{formatRange(holding.estimatedCurrent)}</Td>
            <Td align="right" mono>{formatSignedMoney(holding.purchases.midpoint - holding.sales.midpoint)}</Td>
            <Td align="right" mono>{formatMoney(holding.purchases.midpoint)}</Td>
            <Td align="right" mono>{formatMoney(holding.sales.midpoint)}</Td>
            <Td>
              <div className="space-y-1">
                <StatusPill tone={holding.missingBaseline ? 'warn' : 'ok'} label={holding.missingBaseline ? 'No annual baseline' : 'Baseline match'} />
                <div className="text-[11px] text-slate-500">{confidenceLabel(holding.confidence)} confidence</div>
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
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Priority gaps</div>
          {audit.gaps.slice(0, 8).map((gap) => (
            <div key={`${gap.year}-${gap.issue}`} className="liquid-surface p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="font-bold">{gap.year}</div>
                <StatusPill tone={gap.severity === 'high' ? 'warn' : 'neutral'} label={gap.severity} />
              </div>
              <div className="mt-1 text-slate-700">{gap.issue}</div>
              <div className="mt-1 text-xs leading-5 text-slate-500">{gap.suggestedAction}</div>
            </div>
          ))}
          {audit.gaps.length === 0 && <div className="liquid-empty p-4 text-sm text-slate-600">No source gaps flagged by the latest audit.</div>}
        </div>
      </div>
      <div className="liquid-surface p-3 text-xs leading-5 text-slate-600">
        {audit.notes.join(' ')}
      </div>
    </div>
  );
}

function SourceAuditTimeline({ audit }: { audit: SourceAudit }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">2015-present coverage</div>
      {audit.coverageByYear.map((row) => (
        <div key={row.year} className="grid grid-cols-[54px_1fr_68px] items-center gap-3 text-xs">
          <div className="font-mono text-slate-600">{row.year}</div>
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
    return <div className="liquid-empty flex h-[430px] items-center justify-center text-sm text-slate-500">No sector data for the current filters.</div>;
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
        {summaries.length === 0 && <div className="text-xs text-slate-500">No visible sector with this direction.</div>}
        {summaries.map((summary) => (
          <div key={`${title}-${summary.sector}`}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">{summary.sector}</span>
              <span className={`font-mono text-xs ${summary.net.midpoint >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {formatSignedMoney(summary.net.midpoint)}
              </span>
            </div>
            <div className="mt-1 text-[11px] leading-4 text-slate-500">{summarizeSector(summary)}</div>
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
      <div className="grid grid-cols-[76px_1fr_64px] items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <span>Month</span>
        <span>Late density</span>
        <span className="text-right">Rows</span>
      </div>
      <div className="max-h-[250px] space-y-1 overflow-auto pr-1">
        {rows.map((row) => {
          const tone = lateDensityTone(row.lateShare);
          return (
            <div key={row.month} className="grid grid-cols-[76px_1fr_64px] items-center gap-2 text-xs">
              <span className="font-mono text-slate-600">{row.month}</span>
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
              <span className="text-right font-mono text-slate-600">{formatInteger(row.count)}</span>
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
  return { fill: '#64748b', textClass: 'text-slate-600' };
}

function EventOverlayPanel({
  categories,
  activeCategories,
  onToggleCategory,
}: {
  categories: EventCategory[];
  activeCategories: EventCategory[];
  onToggleCategory: (category: EventCategory) => void;
}) {
  return (
    <div className="space-y-3 border-t border-white/35 pt-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Event overlay</div>
          <div className="text-xs text-slate-500">Dots on the chart; click one for context below.</div>
        </div>
        <CalendarDays className="h-4 w-4 text-slate-400" />
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
                active ? 'border-white/70 bg-white/55 text-slate-800 shadow-sm' : 'border-white/35 bg-white/20 text-slate-400'
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
      <div className="liquid-surface p-3 text-xs leading-5 text-slate-600">
        Event dots are placed near that month&apos;s larger buy/sell flow, with numbered dots marking months that have multiple public events.
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
      <div className="liquid-empty mt-4 p-4 text-sm text-slate-500">
        Select an event to inspect nearby transaction activity.
      </div>
    );
  }

  const sortedWindows = [...windows].sort((a, b) => a.windowDays - b.windowDays);

  return (
    <div className="mt-4 border-t border-white/35 pt-4">
      <div className="grid gap-4 xl:grid-cols-[1fr_1.1fr]">
        <div className="space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Selected chart event</div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-white"
              style={{ backgroundColor: EVENT_CATEGORY_COLORS[event.category] }}
            >
              {eventCategoryLabel(event.category)}
            </span>
            <span className="font-mono text-xs text-slate-500">{eventDateLabel(event)}</span>
            <span className="rounded-full bg-white/45 px-2 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-white/55">
              importance {event.importance}/3
            </span>
          </div>
          <div>
            <h3 className="text-sm font-bold leading-5">{event.title}</h3>
            <p className="mt-1 text-xs leading-5 text-slate-600">{event.summary}</p>
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
          <div className="text-[11px] leading-4 text-slate-500">
            Proximity analysis is a reporting prompt only; it does not imply motive, coordination, or causation.
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {sortedWindows.map((window) => (
            <div key={`${window.eventId}-${window.windowDays}`} className="liquid-surface p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-xs font-bold">+/-{window.windowDays} days</div>
                <div className="font-mono text-xs text-slate-500">{formatInteger(window.transactionCount)} rows</div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <Metric label="Buys" value={formatMoney(window.purchaseMidpoint)} tone="buy" />
                <Metric label="Sales" value={formatMoney(window.saleMidpoint)} tone="sell" />
                <Metric label="Net" value={formatSignedMoney(window.netMidpoint)} tone={window.netMidpoint >= 0 ? 'buy' : 'sell'} />
              </div>
              <div className="mt-3 text-[11px] leading-4 text-slate-500">
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
                <div className="mt-1 line-clamp-2 text-[11px] text-slate-500">
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
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
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
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
        <div className={`rounded-full p-2 ring-1 backdrop-blur-xl ${toneClass}`}>{icon}</div>
      </div>
      <div className="font-mono text-2xl font-bold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="liquid-panel min-w-0">
      <div className="flex items-start justify-between gap-3 border-b border-white/35 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold">{title}</h2>
          <div className="mt-0.5 text-xs text-slate-500">{subtitle}</div>
        </div>
        <ShieldCheck className="h-4 w-4 text-slate-400" />
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
    return <div className="liquid-empty p-6 text-sm text-slate-500">No index entries match the current filters.</div>;
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
              <div className="font-mono text-[11px] text-slate-500">
                E {entry.exposureComponent.toFixed(0)} / C {entry.changeComponent.toFixed(0)} / A {entry.activityComponent.toFixed(0)}
              </div>
            </Td>
            <Td>
              <div className="max-w-[320px] truncate font-semibold">{entry.displayName}</div>
              {entry.instrumentSummary && (
                <div className="max-w-[360px] text-[11px] leading-4 text-slate-600">{entry.instrumentSummary}</div>
              )}
              <div className="text-[11px] leading-4 text-slate-500">{entry.assetType} | {entry.sector}</div>
              <div className="text-[11px] leading-4 text-slate-500">
                {entry.transactionCount} transactions; {entry.filingCount} filing source{entry.filingCount === 1 ? '' : 's'}
              </div>
            </Td>
            <Td>
              <ReferenceLabel row={entry} />
              <div className="max-w-[260px] text-[11px] leading-4 text-slate-500">
                {referenceDetail(entry)}
              </div>
              {entry.issuerContextSector && entry.issuerContextSector !== entry.sector && (
                <div className="max-w-[260px] text-[11px] leading-4 text-slate-500">{entry.issuerContextSector}</div>
              )}
              {(entry.instrumentIssuerState || entry.instrumentIssuerCategory) && (
                <div className="max-w-[260px] text-[11px] leading-4 text-slate-500">
                  {[entry.instrumentIssuerState, entry.instrumentIssuerCategory].filter(Boolean).join(' | ')}
                </div>
              )}
            </Td>
            <Td align="right">
              <div className="font-mono text-xs">{formatRange(entry.currentRange)}</div>
              <div className="font-mono text-[11px] text-slate-500">{formatMoney(entry.currentMidpoint)} midpoint</div>
            </Td>
            <Td align="right">
              <div className={`font-mono text-xs font-semibold ${entry.changeMidpoint >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {formatSignedMoney(entry.changeMidpoint)}
              </div>
              <div className="font-mono text-[11px] text-slate-500">{entry.changePct === null ? 'N/A' : `${entry.changePct.toFixed(1)}%`}</div>
            </Td>
            <Td align="right">
              <div className={`font-mono text-xs font-semibold ${entry.netFlowMidpoint >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {formatSignedMoney(entry.netFlowMidpoint)}
              </div>
              <div className="font-mono text-[11px] text-slate-500">Buy {formatMoney(entry.purchaseMidpoint)} | Sell {formatMoney(entry.saleMidpoint)}</div>
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
                    <div key={citation.label} className="max-w-[220px] truncate text-xs text-slate-500">{citation.label}</div>
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
  const label = row.resolvedTicker || row.issuerContextTicker || row.instrumentReferenceLabel || 'No ticker';
  if (row.instrumentReferenceUrl && !row.resolvedTicker && !row.issuerContextTicker) {
    return (
      <a href={row.instrumentReferenceUrl} target="_blank" rel="noreferrer" className="inline-flex max-w-[220px] items-center gap-1 truncate font-semibold text-sky-800">
        {label} <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
    );
  }
  return <div className="font-semibold text-sky-800">{label}</div>;
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
  return row.instrumentIssuerName || 'No public issuer match';
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
              <span className="text-[11px] font-mono text-slate-500">{formatDateTime(answer.cacheVersion)}</span>
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
                    <div key={citation.label} className="truncate text-xs text-slate-500">{citation.label}</div>
                  )
                ))}
              </div>
            )}
          </div>
        )}
        {interview && history.length > 1 && (
          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Recent exchanges</div>
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
        {entries.length === 0 && <div className="text-xs text-slate-500">No visible entry.</div>}
        {entries.map((entry) => (
          <div key={`${title}-${entry.id}`}>
            <div className="flex items-center justify-between gap-3">
              <span className="max-w-[190px] truncate text-sm font-semibold">{entry.displayName}</span>
              <span className="font-mono text-xs text-slate-600">
                {metric === 'current' ? formatMoney(entry.currentMidpoint) : metric === 'change' ? formatSignedMoney(entry.changeMidpoint) : formatSignedMoney(entry.netFlowMidpoint)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-slate-500">
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
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</div>
      {rows.map((row) => (
        <div key={row.id}>
          <div className="mb-1 flex items-center justify-between gap-3 text-xs">
            <span className="max-w-[260px] truncate font-semibold">{row.key}</span>
            <span className="font-mono text-slate-600">{formatMoney(row.currentMidpoint)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/45">
            <div
              className="h-full rounded-full bg-slate-800/85"
              style={{ width: `${Math.max(3, (row.currentMidpoint / maxValue) * 100)}%` }}
            />
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
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
    return <div className="liquid-empty p-6 text-sm text-slate-500">No historical sources match the current filters.</div>;
  }

  const maxCount = Math.max(1, ...rows.map((row) => row.total));
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.year} className="grid grid-cols-[58px_1fr_54px] items-center gap-3">
          <div className="font-mono text-xs text-slate-600">{row.year}</div>
          <div className="flex h-4 overflow-hidden rounded-full bg-white/45">
            <div className="bg-emerald-600" style={{ width: `${(row.official / maxCount) * 100}%` }} title={`${row.official} official`} />
            <div className="bg-amber-500" style={{ width: `${(row.archived / maxCount) * 100}%` }} title={`${row.archived} archived`} />
            <div className="bg-slate-500" style={{ width: `${(row.metadata / maxCount) * 100}%` }} title={`${row.metadata} metadata-only`} />
          </div>
          <div className="text-right font-mono text-xs text-slate-600">{row.total}</div>
        </div>
      ))}
      <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-3 text-[11px] font-semibold text-slate-500">
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
              {!tx.resolvedTicker && !tx.issuerContextTicker && tx.instrumentReferenceLabel && (
                <a href={tx.instrumentReferenceUrl || 'https://emma.msrb.org/'} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-800">
                  {tx.instrumentReferenceLabel}{tx.instrumentReferenceSource ? ` | ${tx.instrumentReferenceSource}` : ''} <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {tx.instrumentSummary && (
                <div className="max-w-[560px] text-[11px] leading-4 text-slate-600">{tx.instrumentSummary}</div>
              )}
              <div className="text-[11px] leading-4 text-slate-500">{describeTransaction(tx)}</div>
            </Td>
            <Td>
              <div className="font-semibold">{tx.assetType}</div>
              <div className="max-w-[260px] text-[11px] leading-4 text-slate-500">{tx.sector}</div>
              {tx.resolvedSector && (
                <div className="max-w-[260px] text-[11px] leading-4 text-slate-500">
                  SEC/SIC: {tx.resolvedSector}{tx.resolvedSic ? ` (${tx.resolvedSic})` : ''}
                </div>
              )}
            </Td>
            <Td align="right">
              <div className="font-mono text-xs">{tx.amount.label}</div>
              <div className="font-mono text-[11px] text-slate-500">{formatMoney(tx.amount.midpoint)} midpoint</div>
            </Td>
            <Td>
              <div className="space-y-1">
                {tx.lateFilingFlag ? <StatusPill tone="warn" label="Reported late" /> : <StatusPill tone="ok" label="On-time flag" />}
                <div className="text-[11px] text-slate-500">{confidenceLabel(tx.classificationConfidence)} classifier confidence</div>
                <div className="text-[11px] text-slate-500">{confidenceLabel(tx.enrichmentConfidence)} enrichment confidence</div>
                {tx.instrumentMatchConfidence > 0 && (
                  <div className="text-[11px] text-slate-500">{confidenceLabel(tx.instrumentMatchConfidence)} instrument read</div>
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
    return <div className="liquid-empty p-6 text-sm text-slate-500">No equity purchases in the visible transaction set.</div>;
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
              <div className="text-[11px] leading-4 text-slate-500">
                {stock.ticker ? `Source ticker ${stock.ticker}; ` : 'Source ticker not parsed; '}
                {formatInteger(stock.transactionCount)} equity rows, {formatInteger(stock.lateCount)} late.
              </div>
            </Td>
            <Td>
              <div className="font-semibold text-sky-800">{stock.resolvedTicker || 'No public match'}</div>
              <div className="max-w-[280px] text-[11px] leading-4 text-slate-500">
                {stock.resolvedExchange ? `${stock.resolvedExchange}; ` : ''}
                {stock.resolvedCik ? `CIK ${stock.resolvedCik}` : 'No SEC CIK'}
              </div>
              {stock.resolvedSicDescription && (
                <div className="max-w-[280px] text-[11px] leading-4 text-slate-500">{stock.resolvedSicDescription}</div>
              )}
              <EnrichmentBadges flags={stock.enrichmentFlags} />
            </Td>
            <Td>
              <div className="font-semibold">{stock.sector}</div>
              <div className="max-w-[260px] text-[11px] leading-4 text-slate-500">{describeSector(stock.sector)}</div>
            </Td>
            <Td align="right" mono>{formatRange(stock.purchases)}</Td>
            <Td align="right" mono>{formatMoney(stock.purchases.midpoint)}</Td>
            <Td align="right" mono>{formatMoney(stock.sales.midpoint)}</Td>
            <Td align="right" mono>{formatSignedMoney(stock.net.midpoint)}</Td>
            <Td>
              <div className="space-y-1">
                <StatusPill tone={netDirectionTone(stock.netDirection)} label={stock.netDirection} />
                <div className="max-w-[180px] text-[11px] leading-4 text-slate-500">{stock.netDirectionNote}</div>
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
    <div className="liquid-table max-h-[620px] overflow-auto rounded-[20px] border">
      <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
        {children}
      </table>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`sticky top-0 bg-white/80 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 backdrop-blur-xl ${align === 'right' ? 'text-right' : 'text-left'}`}>
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
    neutral: 'bg-white/55 text-slate-600 ring-white/70',
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

function netDirectionTone(direction: EquityStockSummary['netDirection']): 'buy' | 'sell' | 'neutral' {
  if (direction === 'Net buy') return 'buy';
  if (direction === 'Net sale') return 'sell';
  return 'neutral';
}

interface EventMarker {
  month: string;
  count: number;
  category: EventCategory;
  importance: number;
  leadEventId: string;
  y: number;
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

function buildEventMarkers(
  events: OgeEvent[],
  monthlyFlow: Array<{ month: string; purchaseMidpoint: number; saleMidpoint: number }>,
  chartMaxY: number
): EventMarker[] {
  const monthOrder = new Map(monthlyFlow.map((row, index) => [row.month, index]));
  const flowByMonth = new Map(monthlyFlow.map((row) => [row.month, row]));
  const byMonth = new Map<string, OgeEvent[]>();

  for (const event of events) {
    const month = eventMonth(event);
    if (!monthOrder.has(month)) continue;
    byMonth.set(month, [...(byMonth.get(month) || []), event]);
  }

  return Array.from(byMonth.entries())
    .map(([month, monthEvents]) => {
      const leadEvent = [...monthEvents].sort((a, b) =>
        b.importance - a.importance ||
        a.date.localeCompare(b.date) ||
        a.title.localeCompare(b.title)
      )[0];
      const flow = flowByMonth.get(month);
      const monthPeak = Math.max(flow?.purchaseMidpoint || 0, flow?.saleMidpoint || 0);
      const dotY = Math.min(
        chartMaxY * 0.94,
        Math.max(chartMaxY * 0.12, monthPeak + chartMaxY * 0.045)
      );
      return {
        month,
        count: monthEvents.length,
        category: leadEvent.category,
        importance: leadEvent.importance,
        leadEventId: leadEvent.id,
        y: dotY,
      };
    })
    .sort((a, b) => (monthOrder.get(a.month) || 0) - (monthOrder.get(b.month) || 0));
}

function eventDateLabel(event: OgeEvent): string {
  return event.endDate && event.endDate !== event.date ? `${event.date} to ${event.endDate}` : event.date;
}

function buildChartMaxY(rows: Array<{ purchaseMidpoint: number; saleMidpoint: number }>): number {
  const maxValue = Math.max(
    1,
    ...rows.flatMap((row) => [row.purchaseMidpoint, row.saleMidpoint])
  );
  return maxValue * 1.18;
}

function buildMonthlyFlow(transactions: OgeTransaction[]) {
  const byMonth = new Map<string, { month: string; purchaseMidpoint: number; saleMidpoint: number; count: number }>();
  for (const tx of transactions) {
    const month = tx.date.slice(0, 7);
    const row = byMonth.get(month) || { month, purchaseMidpoint: 0, saleMidpoint: 0, count: 0 };
    if (tx.type === 'Purchase') row.purchaseMidpoint += tx.amount.midpoint;
    if (tx.type === 'Sale') row.saleMidpoint += tx.amount.midpoint;
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
