export type TransactionType = 'Purchase' | 'Sale' | 'Exchange' | 'Other';

export type AssetType =
  | 'Equity'
  | 'Corporate Bond'
  | 'Municipal Bond'
  | 'ETF / Fund'
  | 'Preferred / Hybrid'
  | 'Other';

export type ParserStatus =
  | 'oge-source'
  | 'bootstrap-structured'
  | 'parsed'
  | 'needs-review'
  | 'failed';

export type EnrichmentSource =
  | 'source-ticker'
  | 'sec-ticker'
  | 'sec-exact'
  | 'sec-clean'
  | 'sec-compact'
  | 'sec-fuzzy'
  | 'nasdaq-ticker'
  | 'nasdaq-exact'
  | 'nasdaq-clean'
  | 'nasdaq-compact'
  | 'nasdaq-fuzzy'
  | 'none';

export interface MoneyRange {
  label: string;
  min: number;
  max: number;
  midpoint: number;
}

export interface SourceFiling {
  id: string;
  officialName: string;
  title: string;
  agency: string;
  documentType: '278-T' | 'Annual 278e' | 'Other';
  filedAt: string;
  filedDate: string;
  amendedAt: string | null;
  isAmendment: boolean;
  ogeUrl: string;
  localFilename: string;
  bytes: number | null;
  sha256: string | null;
  parserStatus: ParserStatus;
  transactionCount: number | null;
  notes: string;
}

export interface OgeTransaction {
  id: string;
  description: string;
  normalizedDescription: string;
  ticker: string | null;
  resolvedTicker: string | null;
  resolvedIssuerName: string | null;
  resolvedExchange: string | null;
  resolvedCik: number | null;
  resolvedSector: string | null;
  resolvedSic: string | null;
  resolvedSicDescription: string | null;
  enrichmentSource: EnrichmentSource;
  enrichmentConfidence: number;
  enrichmentFlags: string[];
  type: TransactionType;
  date: string;
  amount: MoneyRange;
  lateFilingFlag: boolean;
  sourceFilingId: string | null;
  sourceUrl: string | null;
  assetType: AssetType;
  sector: string;
  classificationConfidence: number;
  parserStatus: ParserStatus;
  reviewFlags: string[];
}

export interface BaselineHolding {
  id: string;
  description: string;
  normalizedDescription: string;
  resolvedTicker: string | null;
  resolvedIssuerName: string | null;
  resolvedExchange: string | null;
  resolvedCik: number | null;
  resolvedSector: string | null;
  resolvedSic: string | null;
  resolvedSicDescription: string | null;
  enrichmentSource: EnrichmentSource;
  enrichmentConfidence: number;
  enrichmentFlags: string[];
  value: MoneyRange;
  assetType: AssetType;
  sector: string;
  sourceFilingId: string;
  confidence: number;
  reviewFlags: string[];
}

export interface EstimatedHolding {
  id: string;
  description: string;
  normalizedDescription: string;
  ticker: string | null;
  resolvedTicker: string | null;
  resolvedIssuerName: string | null;
  resolvedExchange: string | null;
  resolvedCik: number | null;
  resolvedSector: string | null;
  resolvedSic: string | null;
  resolvedSicDescription: string | null;
  enrichmentSource: EnrichmentSource;
  enrichmentConfidence: number;
  enrichmentFlags: string[];
  assetType: AssetType;
  sector: string;
  baseline: MoneyRange;
  purchases: MoneyRange;
  sales: MoneyRange;
  estimatedCurrent: MoneyRange;
  transactionCount: number;
  purchaseCount: number;
  saleCount: number;
  lastTransactionDate: string | null;
  confidence: number;
  missingBaseline: boolean;
  sourceTransactionIds: string[];
  reviewFlags: string[];
}

export interface SectorSummary {
  key: string;
  sector: string;
  assetType: AssetType | 'All';
  enrichedTransactionCount: number;
  publicCompanyCount: number;
  enrichmentConfidence: number;
  purchases: MoneyRange;
  sales: MoneyRange;
  net: MoneyRange;
  transactionCount: number;
  purchaseCount: number;
  saleCount: number;
  lateCount: number;
  confidence: number;
}

export interface ReviewQueueItem {
  id: string;
  severity: 'low' | 'medium' | 'high';
  kind: 'classification' | 'parser' | 'baseline' | 'source';
  title: string;
  detail: string;
  relatedId: string | null;
  sourceUrl: string | null;
}

export interface CacheMeta {
  generatedAt: string;
  dataThrough: string | null;
  source: string;
  sourceFilingCount: number;
  transactionCount: number;
  baselineHoldingCount: number;
  estimatedHoldingCount: number;
  reviewQueueCount: number;
  lateTransactionCount: number;
  estimatedTotalMidpoint: number;
  securityReferenceCount: number;
  securityEnrichmentCount: number;
  enrichedTransactionCount: number;
  notes: string[];
}

export interface SecurityReferenceSource {
  name: string;
  url: string;
  fetchedAt: string;
  rowCount: number;
  status: 'ok' | 'cached' | 'failed';
  error?: string;
}

export interface SecurityReferenceEntry {
  ticker: string;
  tickerKey: string;
  issuerName: string;
  normalizedName: string;
  cleanedName: string;
  compactName: string;
  exchange: string | null;
  cik: number | null;
  sic: string | null;
  sicDescription: string | null;
  sector: string | null;
  isEtf: boolean;
  isTestIssue: boolean;
  sources: string[];
}

export interface SecurityReferenceCache {
  generatedAt: string;
  sources: SecurityReferenceSource[];
  entries: SecurityReferenceEntry[];
  sicByCik: Record<string, {
    sic: string | null;
    sicDescription: string | null;
    sector: string | null;
  }>;
}

export interface SecurityEnrichment {
  id: string;
  securityKey: string;
  description: string;
  normalizedDescription: string;
  sourceTicker: string | null;
  resolvedTicker: string | null;
  resolvedIssuerName: string | null;
  resolvedExchange: string | null;
  resolvedCik: number | null;
  resolvedSector: string | null;
  resolvedSic: string | null;
  resolvedSicDescription: string | null;
  enrichmentSource: EnrichmentSource;
  enrichmentConfidence: number;
  enrichmentFlags: string[];
  candidateTickers: string[];
  transactionCount: number;
  assetTypes: AssetType[];
}

export interface TrumpOgeDataset {
  sourceFilings: SourceFiling[];
  transactions: OgeTransaction[];
  baselineHoldings: BaselineHolding[];
  holdingsEstimates: EstimatedHolding[];
  sectorSummaries: SectorSummary[];
  reviewQueue: ReviewQueueItem[];
  securityReference: SecurityReferenceCache;
  securityEnrichments: SecurityEnrichment[];
  cacheMeta: CacheMeta;
}

export interface TrumpOgeFilters {
  startDate?: string | null;
  endDate?: string | null;
  assetType?: string | null;
  sector?: string | null;
  transactionType?: string | null;
  lateOnly?: boolean;
  query?: string | null;
  confidence?: number | null;
}

export interface TrumpOgeKpis {
  latestFilingDate: string | null;
  filingCount: number;
  transactionCount: number;
  purchaseCount: number;
  saleCount: number;
  lateCount: number;
  estimatedVolume: MoneyRange;
  parserReviewCount: number;
  uniqueSecurities: number;
}

export interface TrumpOgeApiResponse extends TrumpOgeDataset {
  kpis: TrumpOgeKpis;
  filters: Required<Pick<TrumpOgeFilters, 'lateOnly'>> & Omit<TrumpOgeFilters, 'lateOnly'>;
  availableSectors: string[];
  availableAssetTypes: string[];
}
