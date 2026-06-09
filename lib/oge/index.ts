import { ZERO_RANGE } from './amounts';
import { stableId } from './analytics';
import type {
  EstimatedHolding,
  HistoricalSource,
  MoneyRange,
  OgeTransaction,
  SourceReliability,
  SourceFiling,
  TrumpIndexCitation,
  TrumpIndexEntry,
  TrumpIndexRollup,
} from './types';

export function buildTrumpIndex(params: {
  holdings: EstimatedHolding[];
  transactions: OgeTransaction[];
  sourceFilings: SourceFiling[];
  historicalSources: HistoricalSource[];
}): { entries: TrumpIndexEntry[]; rollups: TrumpIndexRollup[] } {
  const transactionsByHolding = new Map<string, OgeTransaction[]>();
  const transactionsByKey = new Map<string, OgeTransaction[]>();
  for (const tx of params.transactions) {
    const key = tx.normalizedDescription || tx.description.toUpperCase();
    transactionsByKey.set(key, [...(transactionsByKey.get(key) || []), tx]);
  }

  for (const holding of params.holdings) {
    const rows = holding.sourceTransactionIds
      .map((id) => params.transactions.find((tx) => tx.id === id))
      .filter((tx): tx is OgeTransaction => Boolean(tx));
    transactionsByHolding.set(
      holding.id,
      rows.length > 0 ? rows : transactionsByKey.get(holding.normalizedDescription) || []
    );
  }

  const rawEntries = params.holdings.map((holding) => {
    const rows = transactionsByHolding.get(holding.id) || [];
    const currentMidpoint = Math.max(0, holding.estimatedCurrent.midpoint);
    const purchaseMidpoint = holding.purchases.midpoint;
    const saleMidpoint = holding.sales.midpoint;
    const netFlowMidpoint = purchaseMidpoint - saleMidpoint;
    const previousMidpoint = Math.max(0, currentMidpoint - netFlowMidpoint);
    const previousRange: MoneyRange = previousMidpoint > 0
      ? {
          label: 'Previous estimate',
          min: Math.max(0, holding.estimatedCurrent.min - holding.purchases.max + holding.sales.min),
          max: Math.max(0, holding.estimatedCurrent.max - holding.purchases.min + holding.sales.max),
          midpoint: previousMidpoint,
        }
      : ZERO_RANGE;
    const dates = rows.map((tx) => tx.date).filter(Boolean).sort();
    const citations = rows.length > 0
      ? buildCitations(rows, params.sourceFilings, params.historicalSources)
      : buildHoldingCitations(holding, params.sourceFilings, params.historicalSources);
    const sourceReliability = strongestReliability(citations.map((citation) => citation.sourceReliability));

    return {
      id: stableId(`trump-index|${holding.id}`),
      displayName: holding.resolvedIssuerName || holding.resolvedTicker || holding.description,
      assetType: holding.assetType,
      sector: holding.sector,
      resolvedTicker: holding.resolvedTicker,
      resolvedIssuerName: holding.resolvedIssuerName,
      resolvedExchange: holding.resolvedExchange,
      resolvedCik: holding.resolvedCik,
      currentRange: holding.estimatedCurrent,
      currentMidpoint,
      previousRange,
      changeMidpoint: currentMidpoint - previousMidpoint,
      changePct: previousMidpoint > 0 ? ((currentMidpoint - previousMidpoint) / previousMidpoint) * 100 : currentMidpoint > 0 ? 100 : null,
      purchaseMidpoint,
      saleMidpoint,
      netFlowMidpoint,
      netDirection: netDirection(netFlowMidpoint),
      transactionCount: holding.transactionCount,
      filingCount: Math.max(1, new Set(citations.map((citation) => citation.sourceId || citation.sourceUrl || citation.label)).size),
      firstSeenDate: dates[0] || null,
      lastSeenDate: dates.at(-1) || holding.lastTransactionDate,
      score: 0,
      exposureComponent: 0,
      changeComponent: 0,
      activityComponent: 0,
      confidence: holding.confidence,
      sourceReliability,
      reviewFlags: [
        ...new Set([
          ...holding.reviewFlags,
          ...holding.enrichmentFlags,
          ...(sourceReliability !== 'official' ? [`Source reliability: ${sourceReliability}`] : []),
        ]),
      ],
      citations,
    } satisfies TrumpIndexEntry;
  });

  const maxExposure = maxLog(rawEntries.map((entry) => entry.currentMidpoint));
  const maxChange = maxLog(rawEntries.map((entry) => Math.abs(entry.changeMidpoint)));
  const maxActivity = maxLog(rawEntries.map((entry) => entry.purchaseMidpoint + entry.saleMidpoint));
  const entries = rawEntries
    .map((entry) => {
      const exposureComponent = component(entry.currentMidpoint, maxExposure);
      const changeComponent = component(Math.abs(entry.changeMidpoint), maxChange);
      const activityComponent = component(entry.purchaseMidpoint + entry.saleMidpoint, maxActivity);
      const score = exposureComponent * 0.5 + changeComponent * 0.3 + activityComponent * 0.2;
      return {
        ...entry,
        exposureComponent,
        changeComponent,
        activityComponent,
        score: round(score),
      };
    })
    .sort((a, b) =>
      b.score - a.score ||
      b.currentMidpoint - a.currentMidpoint ||
      a.displayName.localeCompare(b.displayName)
    );

  return {
    entries,
    rollups: buildTrumpIndexRollups(entries),
  };
}

export function buildTrumpIndexRollups(entries: TrumpIndexEntry[]): TrumpIndexRollup[] {
  return [
    ...rollup(entries, 'sector'),
    ...rollup(entries, 'assetType'),
  ];
}

function rollup(entries: TrumpIndexEntry[], rollupType: TrumpIndexRollup['rollupType']): TrumpIndexRollup[] {
  const groups = new Map<string, TrumpIndexEntry[]>();
  for (const entry of entries) {
    const key = rollupType === 'sector' ? entry.sector : entry.assetType;
    groups.set(key, [...(groups.get(key) || []), entry]);
  }

  return Array.from(groups.entries())
    .map(([key, rows]) => ({
      id: stableId(`trump-index-rollup|${rollupType}|${key}`),
      rollupType,
      key,
      entryCount: rows.length,
      currentMidpoint: sum(rows.map((row) => row.currentMidpoint)),
      purchaseMidpoint: sum(rows.map((row) => row.purchaseMidpoint)),
      saleMidpoint: sum(rows.map((row) => row.saleMidpoint)),
      netFlowMidpoint: sum(rows.map((row) => row.netFlowMidpoint)),
      averageScore: round(sum(rows.map((row) => row.score)) / Math.max(1, rows.length)),
      topEntryIds: rows.slice(0, 5).map((row) => row.id),
    }))
    .sort((a, b) => b.currentMidpoint - a.currentMidpoint || a.key.localeCompare(b.key));
}

function buildCitations(
  rows: OgeTransaction[],
  sourceFilings: SourceFiling[],
  historicalSources: HistoricalSource[]
): TrumpIndexCitation[] {
  const sourceByUrl = new Map<string, HistoricalSource>();
  for (const source of historicalSources) {
    if (source.sourceUrl) sourceByUrl.set(source.sourceUrl, source);
  }
  const filingByUrl = new Map(sourceFilings.map((filing) => [filing.ogeUrl, filing]));
  const citations = new Map<string, TrumpIndexCitation>();

  for (const tx of rows) {
    const sourceUrl = tx.sourceUrl || null;
    const historical = sourceUrl ? sourceByUrl.get(sourceUrl) : null;
    const filing = sourceUrl ? filingByUrl.get(sourceUrl) : null;
    const citation: TrumpIndexCitation = {
      sourceId: historical?.id || filing?.id || null,
      sourceUrl,
      label: historical?.title || filing?.localFilename || 'Structured transaction row',
      filedDate: historical?.filedDate || filing?.filedDate || tx.date || null,
      sourceReliability: historical?.sourceReliability || (sourceUrl ? 'official' : 'metadata_only'),
    };
    citations.set(`${citation.sourceId || citation.sourceUrl || citation.label}`, citation);
  }

  return Array.from(citations.values()).slice(0, 5);
}

function buildHoldingCitations(
  holding: EstimatedHolding,
  sourceFilings: SourceFiling[],
  historicalSources: HistoricalSource[]
): TrumpIndexCitation[] {
  if (!holding.sourceFilingId) return [];
  const historical = historicalSources.find((source) => source.id === holding.sourceFilingId);
  if (historical) {
    return [{
      sourceId: historical.id,
      sourceUrl: historical.sourceUrl || null,
      label: historical.title,
      filedDate: historical.filedDate,
      sourceReliability: historical.sourceReliability,
    }];
  }
  const filing = sourceFilings.find((source) => source.id === holding.sourceFilingId);
  if (!filing) return [];
  return [{
    sourceId: filing.id,
    sourceUrl: filing.ogeUrl,
    label: filing.localFilename,
    filedDate: filing.filedDate,
    sourceReliability: 'official',
  }];
}

function strongestReliability(values: SourceReliability[]): SourceReliability {
  if (values.includes('official')) return 'official';
  if (values.includes('archived_copy')) return 'archived_copy';
  return 'metadata_only';
}

function netDirection(value: number): TrumpIndexEntry['netDirection'] {
  if (value > 0) return 'Net buy';
  if (value < 0) return 'Net sale';
  return 'Hold';
}

function maxLog(values: number[]): number {
  return Math.max(1, ...values.map((value) => Math.log1p(Math.max(0, value))));
}

function component(value: number, maxValue: number): number {
  return round((Math.log1p(Math.max(0, value)) / maxValue) * 100);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
