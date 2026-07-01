import { addRanges, subtractRanges, ZERO_RANGE } from './amounts';
import { buildSecurityKey, normalizeSecurityDescription } from './classify';
import { pickInstrumentContextFields } from './instruments';
import type {
  BaselineHolding,
  EstimatedHolding,
  MoneyRange,
  OgeTransaction,
  InstrumentIdentity,
  ReviewQueueItem,
  SectorSummary,
  SourceFiling,
  TrumpOgeDataset,
  TrumpOgeKpis,
} from './types';

export function buildHoldingsEstimates(
  transactions: OgeTransaction[],
  baselineHoldings: BaselineHolding[]
): EstimatedHolding[] {
  const baselineByKey = new Map<string, BaselineHolding[]>();
  for (const holding of baselineHoldings) {
    for (const key of baselineMatchKeys(holding)) {
      const rows = baselineByKey.get(key) || [];
      rows.push(holding);
      baselineByKey.set(key, rows);
    }
  }

  const grouped = new Map<string, OgeTransaction[]>();
  for (const tx of transactions) {
    const key = buildSecurityKey(tx.description);
    const rows = grouped.get(key) || [];
    rows.push(tx);
    grouped.set(key, rows);
  }

  const transactionBacked = Array.from(grouped.entries())
    .map(([key, rows]) => {
      const sample = rows[0];
      const baseline = findBaselineMatch(rows, baselineByKey);
      const purchases = rows.filter((tx) => tx.type === 'Purchase');
      const sales = rows.filter((tx) => tx.type === 'Sale');
      const purchaseRange = addRanges('Purchases', purchases.map((tx) => tx.amount));
      const saleRange = addRanges('Sales', sales.map((tx) => tx.amount));
      const baselineRange = baseline?.value || ZERO_RANGE;
      const estimatedCurrent = subtractRanges(
        'Estimated current',
        addRanges('Baseline plus purchases', [baselineRange, purchaseRange]),
        saleRange
      );
      const confidence = Math.min(
        baseline ? 0.86 : 0.58,
        ...rows.map((tx) => tx.classificationConfidence || 0.5)
      );
      const missingBaseline = !baseline;
      const reviewFlags = [
        ...new Set([
          ...(missingBaseline ? ['Missing annual-baseline match; estimate is transaction-implied'] : []),
          ...rows.flatMap((tx) => tx.reviewFlags),
        ]),
      ];

      return {
        id: stableId(`holding|${key}`),
        description: baseline?.description || sample.description,
        normalizedDescription: key,
        ticker: sample.ticker,
        resolvedTicker: baseline?.resolvedTicker || sample.resolvedTicker,
        resolvedIssuerName: baseline?.resolvedIssuerName || sample.resolvedIssuerName,
        resolvedExchange: baseline?.resolvedExchange || sample.resolvedExchange,
        resolvedCik: baseline?.resolvedCik || sample.resolvedCik,
        resolvedSector: baseline?.resolvedSector || sample.resolvedSector,
        resolvedSic: baseline?.resolvedSic || sample.resolvedSic,
        resolvedSicDescription: baseline?.resolvedSicDescription || sample.resolvedSicDescription,
        enrichmentSource: baseline?.enrichmentSource || sample.enrichmentSource,
        enrichmentConfidence: Math.max(
          baseline?.enrichmentConfidence || 0,
          ...rows.map((tx) => tx.enrichmentConfidence || 0)
        ),
        enrichmentFlags: [
          ...new Set([
            ...(baseline?.enrichmentFlags || []),
            ...rows.flatMap((tx) => tx.enrichmentFlags),
          ]),
        ],
        ...pickInstrumentContextFields(baseline, sample),
        assetType: baseline?.assetType || sample.assetType,
        sector: baseline?.sector || sample.sector,
        baseline: baselineRange,
        purchases: purchaseRange,
        sales: saleRange,
        estimatedCurrent,
        transactionCount: rows.length,
        purchaseCount: purchases.length,
        saleCount: sales.length,
        lastTransactionDate: rows.map((tx) => tx.date).sort().at(-1) || null,
        sourceFilingId: baseline?.sourceFilingId || null,
        confidence,
        missingBaseline,
        sourceTransactionIds: rows.map((tx) => tx.id),
        reviewFlags,
      } satisfies EstimatedHolding;
    })
    .sort((a, b) =>
      b.estimatedCurrent.midpoint - a.estimatedCurrent.midpoint ||
        b.transactionCount - a.transactionCount ||
        a.description.localeCompare(b.description)
    );

  const baselineOnly = baselineHoldings
    .filter((holding) => !grouped.has(buildSecurityKey(holding.description)))
    .map((holding) => ({
      id: stableId(`holding|${buildSecurityKey(holding.description)}`),
      description: holding.description,
      normalizedDescription: buildSecurityKey(holding.description),
      ticker: null,
      resolvedTicker: holding.resolvedTicker,
      resolvedIssuerName: holding.resolvedIssuerName,
      resolvedExchange: holding.resolvedExchange,
      resolvedCik: holding.resolvedCik,
      resolvedSector: holding.resolvedSector,
      resolvedSic: holding.resolvedSic,
      resolvedSicDescription: holding.resolvedSicDescription,
      enrichmentSource: holding.enrichmentSource,
      enrichmentConfidence: holding.enrichmentConfidence,
      enrichmentFlags: holding.enrichmentFlags,
      ...pickInstrumentContextFields(holding),
      assetType: holding.assetType,
      sector: holding.sector,
      baseline: holding.value,
      purchases: ZERO_RANGE,
      sales: ZERO_RANGE,
      estimatedCurrent: {
        ...holding.value,
        label: 'Estimated current',
      },
      transactionCount: 0,
      purchaseCount: 0,
      saleCount: 0,
      lastTransactionDate: null,
      sourceFilingId: holding.sourceFilingId,
      confidence: Math.min(holding.confidence, 0.74),
      missingBaseline: false,
      sourceTransactionIds: [],
      reviewFlags: holding.reviewFlags,
    } satisfies EstimatedHolding))
    .sort((a, b) =>
      b.estimatedCurrent.midpoint - a.estimatedCurrent.midpoint ||
      a.description.localeCompare(b.description)
    );

  return [...transactionBacked, ...baselineOnly].sort((a, b) =>
    b.estimatedCurrent.midpoint - a.estimatedCurrent.midpoint ||
    b.transactionCount - a.transactionCount ||
    a.description.localeCompare(b.description)
  );
}

export function buildSectorSummaries(transactions: OgeTransaction[]): SectorSummary[] {
  const groups = new Map<string, OgeTransaction[]>();
  for (const tx of transactions) {
    const keys = [`All|${tx.sector}`, `${tx.assetType}|${tx.sector}`];
    for (const key of keys) {
      const rows = groups.get(key) || [];
      rows.push(tx);
      groups.set(key, rows);
    }
  }

  return Array.from(groups.entries())
    .map(([key, rows]) => {
      const [assetType, sector] = key.split('|') as [SectorSummary['assetType'], string];
      const purchases = rows.filter((tx) => tx.type === 'Purchase');
      const sales = rows.filter((tx) => tx.type === 'Sale');
      const enrichedRows = rows.filter((tx) => tx.resolvedTicker);
      const purchaseRange = addRanges('Purchases', purchases.map((tx) => tx.amount));
      const saleRange = addRanges('Sales', sales.map((tx) => tx.amount));
      const net: MoneyRange = {
        label: 'Net',
        min: purchaseRange.min - saleRange.max,
        max: purchaseRange.max - saleRange.min,
        midpoint: purchaseRange.midpoint - saleRange.midpoint,
      };

      return {
        key,
        sector,
        assetType,
        enrichedTransactionCount: enrichedRows.length,
        publicCompanyCount: new Set(enrichedRows.map((tx) => tx.resolvedTicker)).size,
        enrichmentConfidence: enrichedRows.length > 0
          ? enrichedRows.reduce((sum, tx) => sum + tx.enrichmentConfidence, 0) / enrichedRows.length
          : 0,
        purchases: purchaseRange,
        sales: saleRange,
        net,
        transactionCount: rows.length,
        purchaseCount: purchases.length,
        saleCount: sales.length,
        lateCount: rows.filter((tx) => tx.lateFilingFlag).length,
        confidence: rows.reduce((sum, tx) => sum + tx.classificationConfidence, 0) / rows.length,
      } satisfies SectorSummary;
    })
    .sort((a, b) =>
      (a.assetType === 'All' ? -1 : 1) - (b.assetType === 'All' ? -1 : 1) ||
      Math.abs(b.net.midpoint) - Math.abs(a.net.midpoint)
    );
}

export function buildReviewQueue(params: {
  sourceFilings: SourceFiling[];
  transactions: OgeTransaction[];
  baselineHoldings: BaselineHolding[];
  holdingsEstimates: EstimatedHolding[];
  instrumentIdentities?: InstrumentIdentity[];
}): ReviewQueueItem[] {
  const items: ReviewQueueItem[] = [];

  for (const filing of params.sourceFilings) {
    if (filing.parserStatus === 'failed' || filing.parserStatus === 'needs-review') {
      items.push({
        id: stableId(`source|${filing.id}`),
        severity: filing.parserStatus === 'failed' ? 'high' : 'medium',
        kind: 'source',
        title: `Review source filing ${filing.filedDate}`,
        detail: filing.notes,
        relatedId: filing.id,
        sourceUrl: filing.ogeUrl,
      });
    }
  }

  if (params.baselineHoldings.length === 0) {
    const annual = params.sourceFilings.find((filing) => filing.documentType === 'Annual 278e');
    items.push({
      id: 'baseline-not-parsed',
      severity: 'high',
      kind: 'baseline',
      title: 'Annual 278e baseline not parsed',
      detail: 'Holdings estimates are transaction-implied until the annual 278e asset table is extracted and reviewed.',
      relatedId: annual?.id || null,
      sourceUrl: annual?.ogeUrl || null,
    });
  }

  for (const tx of params.transactions) {
    if (tx.reviewFlags.length === 0 && tx.classificationConfidence >= 0.7) continue;
    items.push({
      id: stableId(`tx-review|${tx.id}`),
      severity: tx.classificationConfidence < 0.6 ? 'high' : 'medium',
      kind: 'classification',
      title: `Review ${tx.assetType} classification`,
      detail: `${tx.description} | ${tx.reviewFlags.join(', ') || 'Low confidence'}`,
      relatedId: tx.id,
      sourceUrl: tx.sourceUrl,
    });
  }

  for (const holding of params.holdingsEstimates.slice(0, 200)) {
    if (!holding.missingBaseline) continue;
    items.push({
      id: stableId(`holding-review|${holding.id}`),
      severity: 'low',
      kind: 'baseline',
      title: 'Holding estimate lacks annual baseline',
      detail: `${holding.description} is estimated only from reported transaction ranges.`,
      relatedId: holding.id,
      sourceUrl: null,
    });
  }

  for (const identity of (params.instrumentIdentities || []).slice(0, 200)) {
    if (identity.referenceStatus !== 'needs_identifier' && identity.reviewStatus !== 'needs_review') continue;
    items.push({
      id: stableId(`identifier-review|${identity.id}`),
      severity: identity.reviewPriority >= 130 ? 'high' : identity.reviewPriority >= 95 ? 'medium' : 'low',
      kind: 'identifier',
      title: identity.referenceStatus === 'needs_identifier' ? 'Exact instrument identifier needed' : 'Instrument evidence needs review',
      detail: `${identity.displayName} | ${identity.reviewReason}`,
      relatedId: identity.id,
      sourceUrl: identity.evidenceSourceUrl || identity.sourceUrls[0] || null,
    });
  }

  return items.slice(0, 500);
}

export function buildKpis(dataset: Pick<TrumpOgeDataset, 'sourceFilings' | 'transactions' | 'reviewQueue'>): TrumpOgeKpis {
  const purchaseCount = dataset.transactions.filter((tx) => tx.type === 'Purchase').length;
  const saleCount = dataset.transactions.filter((tx) => tx.type === 'Sale').length;
  return {
    latestFilingDate: dataset.sourceFilings.map((filing) => filing.filedDate).sort().at(-1) || null,
    filingCount: dataset.sourceFilings.length,
    transactionCount: dataset.transactions.length,
    purchaseCount,
    saleCount,
    lateCount: dataset.transactions.filter((tx) => tx.lateFilingFlag).length,
    estimatedVolume: addRanges('Estimated transaction volume', dataset.transactions.map((tx) => tx.amount)),
    parserReviewCount: dataset.reviewQueue.length,
    uniqueSecurities: new Set(dataset.transactions.map((tx) => tx.resolvedTicker || tx.issuerContextTicker || buildSecurityKey(tx.description))).size,
  };
}

export function stableId(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function findBaselineMatch(
  rows: OgeTransaction[],
  baselineByKey: Map<string, BaselineHolding[]>
): BaselineHolding | undefined {
  const sample = rows[0];
  const candidates = new Map<string, BaselineHolding>();
  for (const row of rows) {
    for (const key of transactionMatchKeys(row)) {
      for (const holding of baselineByKey.get(key) || []) {
        candidates.set(holding.id, holding);
      }
    }
  }
  const narrowed = Array.from(candidates.values()).filter((holding) =>
    holding.assetType === sample.assetType ||
    holding.sector === sample.sector ||
    Boolean(holding.instrumentCusip && holding.instrumentCusip === sample.instrumentCusip) ||
    Boolean(holding.resolvedTicker && holding.resolvedTicker === sample.resolvedTicker)
  );
  const viable = narrowed.length > 0 ? narrowed : Array.from(candidates.values());
  if (viable.length === 1) return viable[0];
  const exactKey = buildSecurityKey(sample.description);
  const exact = viable.filter((holding) => buildSecurityKey(holding.description) === exactKey);
  if (exact.length === 1) return exact[0];
  return undefined;
}

function baselineMatchKeys(holding: BaselineHolding): string[] {
  return genericSecurityMatchKeys(holding);
}

function transactionMatchKeys(tx: OgeTransaction): string[] {
  return genericSecurityMatchKeys(tx);
}

function genericSecurityMatchKeys(row: Pick<BaselineHolding | OgeTransaction, 'description' | 'resolvedTicker' | 'resolvedIssuerName' | 'issuerContextTicker' | 'issuerContextIssuerName' | 'instrumentCusip' | 'instrumentIsin' | 'instrumentFigi' | 'instrumentIssuerName' | 'instrumentCoupon' | 'instrumentMaturityDate' | 'assetType'>): string[] {
  const keys = new Set<string>();
  const add = (key: string, value: string | null | undefined) => {
    const cleaned = normalizeSecurityDescription(String(value || ''));
    if (cleaned.length >= 3) keys.add(`${key}|${cleaned}`);
  };
  add('security-key', buildSecurityKey(row.description));
  add('ticker', row.resolvedTicker);
  add('issuer-ticker', row.issuerContextTicker);
  add('resolved-issuer', row.resolvedIssuerName);
  add('issuer-context', row.issuerContextIssuerName);
  add('instrument-issuer', row.instrumentIssuerName);
  add('cusip', row.instrumentCusip);
  add('isin', row.instrumentIsin);
  add('figi', row.instrumentFigi);
  if (row.instrumentIssuerName && row.instrumentCoupon !== null && row.instrumentCoupon !== undefined && row.instrumentMaturityDate) {
    add('issuer-coupon-maturity', `${row.assetType}|${row.instrumentIssuerName}|${row.instrumentCoupon}|${row.instrumentMaturityDate}`);
  }
  return Array.from(keys);
}
