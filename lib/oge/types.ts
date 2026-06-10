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

export type InstrumentMatchSource =
  | 'description-parser'
  | 'openfigi'
  | 'finra-trace'
  | 'msrb-emma'
  | 'none';

export interface InstrumentContextFields {
  instrumentKind: string | null;
  instrumentIssuerName: string | null;
  instrumentCusip: string | null;
  instrumentIsin: string | null;
  instrumentFigi: string | null;
  instrumentCoupon: number | null;
  instrumentMaturityDate: string | null;
  instrumentCallable: boolean | null;
  instrumentCallDate: string | null;
  instrumentCallPrice: number | null;
  instrumentYieldToCall: number | null;
  instrumentYieldToMaturity: number | null;
  instrumentIssuerState: string | null;
  instrumentIssuerCategory: string | null;
  instrumentReferenceLabel: string | null;
  instrumentReferenceSource: string | null;
  instrumentReferenceUrl: string | null;
  instrumentSummary: string | null;
  instrumentMatchSource: InstrumentMatchSource;
  instrumentMatchConfidence: number;
  instrumentContextFlags: string[];
  issuerContextTicker: string | null;
  issuerContextIssuerName: string | null;
  issuerContextExchange: string | null;
  issuerContextCik: number | null;
  issuerContextSector: string | null;
  issuerContextSource: string | null;
  issuerContextConfidence: number;
  issuerContextFlags: string[];
}

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

export type SourceReliability = 'official' | 'archived_copy' | 'metadata_only';

export type HistoricalSourceType =
  | 'oge_api_pdf'
  | 'oge_request_metadata'
  | 'archived_public_pdf';

export interface HistoricalSource {
  id: string;
  title: string;
  filingType: '278-T' | 'Annual 278e' | 'Candidate 278e' | 'Termination 278e' | 'Other';
  filedDate: string;
  reportYear: number | null;
  sourceType: HistoricalSourceType;
  sourceReliability: SourceReliability;
  sourceUrl: string;
  localFilename: string;
  bytes: number | null;
  sha256: string | null;
  fetchStatus: 'ok' | 'metadata_only' | 'failed';
  sourceReviewStatus: 'verified' | 'needs_review' | 'unavailable';
  provenanceNote: string;
}

export interface OgeTransaction extends InstrumentContextFields {
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

export interface BaselineHolding extends InstrumentContextFields {
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

export interface EstimatedHolding extends InstrumentContextFields {
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
  sourceFilingId: string | null;
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

export type EventCategory =
  | 'tariff'
  | 'fed'
  | 'white-house'
  | 'market'
  | 'company-news'
  | 'truth-social'
  | 'manual';

export interface OgeEvent {
  id: string;
  date: string;
  endDate: string | null;
  category: EventCategory;
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  tickers: string[];
  sectors: string[];
  tags: string[];
  importance: 1 | 2 | 3;
}

export interface EventWindowSummary {
  eventId: string;
  windowDays: 7 | 30;
  transactionCount: number;
  purchaseMidpoint: number;
  saleMidpoint: number;
  netMidpoint: number;
  matchedTickers: string[];
  matchedSectors: string[];
  firstTransactionDate: string | null;
  lastTransactionDate: string | null;
}

export interface FinancialDisclosureReport {
  id: string;
  sourceId: string;
  filingType: HistoricalSource['filingType'];
  filedDate: string;
  reportYear: number | null;
  sourceReliability: SourceReliability;
  parserStatus: ParserStatus;
  assetIncomeCount: number;
  liabilityCount: number;
  notes: string;
}

export interface AssetIncomeHolding {
  id: string;
  sourceId: string;
  description: string;
  normalizedDescription: string;
  value: MoneyRange;
  incomeType: string | null;
  income: MoneyRange;
  assetType: AssetType;
  sector: string;
  sourceReliability: SourceReliability;
  confidence: number;
  reviewFlags: string[];
}

export interface Liability {
  id: string;
  sourceId: string;
  creditorName: string;
  type: string;
  amount: MoneyRange;
  yearIncurred: string | null;
  rate: string | null;
  term: string | null;
  sourceReliability: SourceReliability;
  confidence: number;
  reviewFlags: string[];
}

export interface YearlyExposureSummary {
  year: number;
  sourceIds: string[];
  sourceReliability: SourceReliability;
  assetIncomeCount: number;
  liabilityCount: number;
  transactionCount: number;
  currentMidpoint: number;
  purchaseMidpoint: number;
  saleMidpoint: number;
  netFlowMidpoint: number;
}

export interface TrumpIndexCitation {
  sourceId: string | null;
  sourceUrl: string | null;
  label: string;
  filedDate: string | null;
  sourceReliability: SourceReliability;
}

export interface TrumpIndexEntry extends InstrumentContextFields {
  id: string;
  displayName: string;
  assetType: AssetType;
  sector: string;
  resolvedTicker: string | null;
  resolvedIssuerName: string | null;
  resolvedExchange: string | null;
  resolvedCik: number | null;
  currentRange: MoneyRange;
  currentMidpoint: number;
  previousRange: MoneyRange;
  changeMidpoint: number;
  changePct: number | null;
  purchaseMidpoint: number;
  saleMidpoint: number;
  netFlowMidpoint: number;
  netDirection: 'Net buy' | 'Net sale' | 'Hold';
  transactionCount: number;
  filingCount: number;
  firstSeenDate: string | null;
  lastSeenDate: string | null;
  score: number;
  exposureComponent: number;
  changeComponent: number;
  activityComponent: number;
  confidence: number;
  sourceReliability: SourceReliability;
  reviewFlags: string[];
  citations: TrumpIndexCitation[];
}

export interface TrumpIndexRollup {
  id: string;
  rollupType: 'sector' | 'assetType';
  key: string;
  entryCount: number;
  currentMidpoint: number;
  purchaseMidpoint: number;
  saleMidpoint: number;
  netFlowMidpoint: number;
  averageScore: number;
  topEntryIds: string[];
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
  instrumentContextCount: number;
  enrichedTransactionCount: number;
  eventCount: number;
  eventWindowCount: number;
  historicalSourceCount: number;
  financialDisclosureReportCount: number;
  assetIncomeHoldingCount: number;
  liabilityCount: number;
  trumpIndexCount: number;
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

export interface SecurityEnrichment extends InstrumentContextFields {
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
  historicalSources: HistoricalSource[];
  sourceFilings: SourceFiling[];
  transactions: OgeTransaction[];
  baselineHoldings: BaselineHolding[];
  financialDisclosureReports: FinancialDisclosureReport[];
  assetIncomeHoldings: AssetIncomeHolding[];
  liabilities: Liability[];
  yearlyExposureSummaries: YearlyExposureSummary[];
  holdingsEstimates: EstimatedHolding[];
  sectorSummaries: SectorSummary[];
  trumpIndex: TrumpIndexEntry[];
  trumpIndexRollups: TrumpIndexRollup[];
  reviewQueue: ReviewQueueItem[];
  events: OgeEvent[];
  eventWindows: EventWindowSummary[];
  securityReference: SecurityReferenceCache;
  securityEnrichments: SecurityEnrichment[];
  cacheMeta: CacheMeta;
}

export interface TrumpOgeFilters {
  year?: string | number | null;
  startDate?: string | null;
  endDate?: string | null;
  assetType?: string | null;
  sector?: string | null;
  transactionType?: string | null;
  sourceReliability?: string | null;
  ticker?: string | null;
  issuer?: string | null;
  dataClass?: string | null;
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
