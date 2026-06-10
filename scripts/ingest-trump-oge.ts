import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { PDFParse } from 'pdf-parse';
import { addRanges, parseOgeAmountRange } from '../lib/oge/amounts';
import { buildHoldingsEstimates, buildReviewQueue, buildSectorSummaries, stableId } from '../lib/oge/analytics';
import { classifySecurity } from '../lib/oge/classify';
import { fetchTrumpContextDbEvents } from '../lib/oge/context-db';
import {
  buildEventWindows,
  buildFomcEvents,
  federalRegisterDocumentToEvent,
  mergeEvents,
  normalizeManualEvents,
} from '../lib/oge/events';
import {
  broadSectorFromSic,
  buildSecurityReferenceCache,
  collectResolvedCiks,
  emptyEnrichmentFields,
  enrichTransactions,
  parseNasdaqSymbolDirectory,
  parseSecCompanyTickers,
  type ParsedNasdaqSecurity,
} from '../lib/oge/enrichment';
import { buildTrumpIndex } from '../lib/oge/index';
import type {
  AssetIncomeHolding,
  BaselineHolding,
  CacheMeta,
  FinancialDisclosureReport,
  HistoricalSource,
  Liability,
  OgeEvent,
  OgeTransaction,
  SecurityReferenceCache,
  SecurityReferenceEntry,
  SecurityReferenceSource,
  SourceAudit,
  SourceFiling,
  TransactionType,
  TrumpIndexEntry,
  TrumpOgeDataset,
  YearlyExposureSummary,
} from '../lib/oge/types';

const OGE_API_BASE = 'https://extapps2.oge.gov/201/Presiden.nsf/API.xsp/v2/rest';
const OPEN_CABINET_FULL_DATASET_URL = 'https://open-cabinet.org/data/full-dataset.json';
const SEC_COMPANY_TICKERS_EXCHANGE_URL = 'https://www.sec.gov/files/company_tickers_exchange.json';
const SEC_SUBMISSIONS_BASE_URL = 'https://data.sec.gov/submissions';
const NASDAQ_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt';
const NASDAQ_OTHER_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt';
const FEDERAL_REGISTER_DOCUMENTS_URL = 'https://www.federalregister.gov/api/v1/documents.json';
const DATA_ROOT = path.join(process.cwd(), 'data', 'oge', 'trump');
const OGE_PAGE_SIZE = 1000;
const MIN_DOC_DATE = '2015-01-01';
const TRUMP_NAME_RE = /^Trump,\s*Donald\s+J\.?$/i;

interface OgeApiRecord {
  type: string;
  name: string;
  agency: string;
  title: string;
  level: string;
  docDate: string;
  amended: string;
}

interface OgeApiPage {
  recordsTotal?: number;
  recordsFiltered?: number;
  data?: OgeApiRecord[];
}

interface OpenCabinetDataset {
  exportedAt: string;
  officials: Array<{
    name: string;
    slug: string;
    title: string;
    agency: string;
    transactionCount: number;
    mostRecentFilingDate: string;
    transactions: Array<{
      description: string;
      ticker: string | null;
      type: string;
      date: string;
      amount: string;
      lateFilingFlag: boolean;
    }>;
  }>;
}

interface FederalRegisterPage {
  results?: Array<{
    title?: string;
    publication_date?: string;
    html_url?: string;
    abstract?: string;
    document_number?: string;
    agencies?: Array<{ name?: string; raw_name?: string }>;
  }>;
}

interface HistoricalSourceSeed {
  id: string;
  title: string;
  filingType: HistoricalSource['filingType'];
  filedDate: string;
  reportYear: number | null;
  sourceType: HistoricalSource['sourceType'];
  sourceReliability: HistoricalSource['sourceReliability'];
  sourceUrl: string;
  localFilename?: string;
  sourceReviewStatus?: HistoricalSource['sourceReviewStatus'];
  provenanceNote: string;
}

async function main() {
  const sourceRecords = await fetchTrumpOgeSourceRecords();
  const sourceFilings = await buildSourceFilings(sourceRecords);
  const historicalSources = await buildHistoricalSources(sourceRecords, sourceFilings);
  const bootstrapTransactions = await buildBootstrapTransactions(sourceFilings);
  const baseSecurityReference = await buildPublicSecurityReference();
  const firstPassEnrichment = enrichTransactions(bootstrapTransactions, baseSecurityReference);
  const securityReference = await completeSecurityReferenceWithSic(
    baseSecurityReference,
    collectResolvedCiks(firstPassEnrichment.transactions)
  );
  const { transactions, securityEnrichments } = enrichTransactions(bootstrapTransactions, securityReference);
  const cachedBaselineHoldings = await buildBaselineHoldings(sourceFilings);
  const assetIncomeHoldings = await buildAssetIncomeHoldings(cachedBaselineHoldings, historicalSources);
  const baselineHoldings = cachedBaselineHoldings.length > 0
    ? cachedBaselineHoldings
    : buildBaselineHoldingsFromAssetIncome(assetIncomeHoldings);
  const liabilities = await buildLiabilities(historicalSources);
  const financialDisclosureReports = buildFinancialDisclosureReports(historicalSources, assetIncomeHoldings, liabilities);
  const holdingsEstimates = buildHoldingsEstimates(transactions, baselineHoldings);
  const sectorSummaries = buildSectorSummaries(transactions);
  const { entries: trumpIndex, rollups: trumpIndexRollups } = buildTrumpIndex({
    holdings: holdingsEstimates,
    transactions,
    sourceFilings,
    historicalSources,
  });
  const yearlyExposureSummaries = buildYearlyExposureSummaries({
    historicalSources,
    transactions,
    assetIncomeHoldings,
    liabilities,
    trumpIndex,
  });
  const sourceAudit = buildSourceAudit(sourceRecords, historicalSources);
  const events = await buildEvents();
  const eventWindows = buildEventWindows(events, transactions);
  const reviewQueue = buildReviewQueue({
    sourceFilings,
    transactions,
    baselineHoldings,
    holdingsEstimates,
  });
  const cacheMeta = buildCacheMeta({
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
  });

  await writeDataset({
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
  });

  console.log(JSON.stringify({
    generatedAt: cacheMeta.generatedAt,
    sourceFilingCount: sourceFilings.length,
    historicalSourceCount: historicalSources.length,
    transactionCount: transactions.length,
    baselineHoldingCount: baselineHoldings.length,
    financialDisclosureReportCount: financialDisclosureReports.length,
    assetIncomeHoldingCount: assetIncomeHoldings.length,
    liabilityCount: liabilities.length,
    estimatedHoldingCount: holdingsEstimates.length,
    trumpIndexCount: trumpIndex.length,
    sourceAuditStatus: sourceAudit.completenessStatus,
    sourceAuditGapCount: sourceAudit.gaps.length,
    reviewQueueCount: reviewQueue.length,
    securityReferenceCount: securityReference.entries.length,
    securityEnrichmentCount: securityEnrichments.length,
    instrumentContextCount: transactions.filter((tx) => tx.instrumentSummary || tx.issuerContextTicker).length,
    enrichedTransactionCount: transactions.filter((tx) => tx.resolvedTicker).length,
    eventCount: events.length,
    eventWindowCount: eventWindows.length,
    latestFilingDate: cacheMeta.dataThrough,
  }, null, 2));
}

async function fetchTrumpOgeSourceRecords(): Promise<OgeApiRecord[]> {
  const records: OgeApiRecord[] = [];
  let start = 0;
  let total = Number.POSITIVE_INFINITY;

  while (start < total) {
    const url = `${OGE_API_BASE}?start=${start}&length=${OGE_PAGE_SIZE}`;
    let page: OgeApiPage;
    try {
      page = await fetchJson<OgeApiPage>(url);
    } catch (error) {
      if (records.length > 0) {
        console.warn(`[Trump OGE] Stopping OGE pagination at start=${start}: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
      throw error;
    }
    const rows = page.data || [];
    records.push(...rows);
    total = page.recordsTotal || rows.length;
    if (rows.length === 0) break;
    start += OGE_PAGE_SIZE;
    await sleep(150);
  }

  return records
    .filter((record) => TRUMP_NAME_RE.test(record.name || ''))
    .filter((record) => isoDate(record.docDate) >= MIN_DOC_DATE)
    .filter((record) => isSupportedDisclosure(record.type))
    .sort((a, b) => isoDate(a.docDate).localeCompare(isoDate(b.docDate)) || extractPdfUrl(a.type).localeCompare(extractPdfUrl(b.type)));
}

async function buildSourceFilings(records: OgeApiRecord[]): Promise<SourceFiling[]> {
  const seen = new Set<string>();
  const filings: SourceFiling[] = [];

  for (const record of records) {
    const ogeUrl = extractPdfUrl(record.type);
    if (!ogeUrl || seen.has(ogeUrl)) continue;
    seen.add(ogeUrl);

    const fileInfo = await fetchPdfFingerprint(ogeUrl);
    const documentType = classifyDocumentType(record.type);
    const filedDate = isoDate(record.docDate);
    const shaOrUrl = fileInfo.sha256 || stableId(ogeUrl);

    filings.push({
      id: stableId(`${filedDate}|${documentType}|${shaOrUrl}|${ogeUrl}`),
      officialName: 'Trump, Donald J.',
      title: record.title || 'President',
      agency: record.agency || 'White House Office',
      documentType,
      filedAt: record.docDate,
      filedDate,
      amendedAt: record.amended ? record.amended : null,
      isAmendment: Boolean(record.amended) || /\bAMENDED\b/i.test(record.type),
      ogeUrl,
      localFilename: decodeURIComponent(ogeUrl.split('/').pop() || `${stableId(ogeUrl)}.pdf`),
      bytes: fileInfo.bytes,
      sha256: fileInfo.sha256,
      parserStatus: fileInfo.sha256 ? 'oge-source' : 'failed',
      transactionCount: null,
      notes: fileInfo.sha256
        ? 'OGE source PDF fingerprinted for provenance. Current transactions are bootstrapped from structured rows until per-PDF parsing is run.'
        : `Could not fingerprint PDF: ${fileInfo.error || 'unknown error'}`,
    });
  }

  const existingFilings = await readJson<SourceFiling[]>('source-filings.json', []);
  for (const existing of existingFilings) {
    if (!existing.ogeUrl || seen.has(existing.ogeUrl)) continue;
    seen.add(existing.ogeUrl);
    filings.push(existing);
  }

  return filings.sort((a, b) => a.filedDate.localeCompare(b.filedDate) || a.localFilename.localeCompare(b.localFilename));
}

async function buildHistoricalSources(records: OgeApiRecord[], sourceFilings: SourceFiling[]): Promise<HistoricalSource[]> {
  const filingsByUrl = new Map(sourceFilings.map((filing) => [filing.ogeUrl, filing]));
  const sources = new Map<string, HistoricalSource>();

  for (const record of records) {
    const sourceUrl = extractPdfUrl(record.type) || extractHref(record.type);
    const filing = sourceUrl ? filingsByUrl.get(sourceUrl) : null;
    const filingType = classifyHistoricalFilingType(record.type);
    const filedDate = isoDate(record.docDate);
    const title = textFromHtml(record.type) || `${filingType} filed ${filedDate}`;
    const key = sourceUrl || `${filedDate}|${filingType}|${title}`;
    if (sources.has(key)) continue;

    if (filing) {
      sources.set(key, {
        id: stableId(`historical-source|official|${filing.id}`),
        title,
        filingType,
        filedDate,
        reportYear: reportYearFromText(record.type, filedDate),
        sourceType: 'oge_api_pdf',
        sourceReliability: 'official',
        sourceUrl,
        localFilename: filing.localFilename,
        bytes: filing.bytes,
        sha256: filing.sha256,
        fetchStatus: filing.sha256 ? 'ok' : 'failed',
        sourceReviewStatus: filing.sha256 ? 'verified' : 'needs_review',
        provenanceNote: 'Official OGE API source record with direct PDF URL and SHA-256 provenance when fetchable.',
      });
      continue;
    }

    sources.set(key, {
      id: stableId(`historical-source|metadata|${key}`),
      title,
      filingType,
      filedDate,
      reportYear: reportYearFromText(record.type, filedDate),
      sourceType: 'oge_request_metadata',
      sourceReliability: 'metadata_only',
      sourceUrl,
      localFilename: sourceUrl ? decodeURIComponent(sourceUrl.split('/').pop() || '') : '',
      bytes: null,
      sha256: null,
      fetchStatus: 'metadata_only',
      sourceReviewStatus: 'unavailable',
      provenanceNote: 'OGE API metadata record does not expose a direct PDF in the public response; retain for coverage and request tracking.',
    });
  }

  const seededSources = await buildSeededHistoricalSources();
  for (const source of seededSources) {
    if (source.sourceUrl && sources.has(source.sourceUrl)) continue;
    sources.set(source.sourceUrl || source.id, source);
  }

  const existingSources = await readJson<HistoricalSource[]>('historical-sources.json', []);
  for (const source of existingSources) {
    const key = source.sourceUrl || source.id;
    if (!key || sources.has(key)) continue;
    sources.set(key, source);
  }

  return Array.from(sources.values()).sort((a, b) =>
    a.filedDate.localeCompare(b.filedDate) ||
    a.sourceReliability.localeCompare(b.sourceReliability) ||
    a.title.localeCompare(b.title)
  );
}

async function buildSeededHistoricalSources(): Promise<HistoricalSource[]> {
  const seeds = await readJson<HistoricalSourceSeed[]>('historical-source-seeds.json', []);
  const sources: HistoricalSource[] = [];

  for (const seed of seeds) {
    const fileInfo = seed.sourceUrl && /\.pdf(?:$|\?)/i.test(seed.sourceUrl)
      ? await fetchPdfFingerprint(seed.sourceUrl)
      : { bytes: null, sha256: null };
    const status: HistoricalSource['fetchStatus'] = fileInfo.sha256
      ? 'ok'
      : seed.sourceReliability === 'metadata_only'
        ? 'metadata_only'
        : 'failed';
    sources.push({
      id: seed.id,
      title: seed.title,
      filingType: seed.filingType,
      filedDate: seed.filedDate,
      reportYear: seed.reportYear,
      sourceType: seed.sourceType,
      sourceReliability: seed.sourceReliability,
      sourceUrl: seed.sourceUrl,
      localFilename: seed.localFilename || decodeURIComponent(seed.sourceUrl.split('/').pop() || `${seed.id}.pdf`),
      bytes: fileInfo.bytes,
      sha256: fileInfo.sha256,
      fetchStatus: status,
      sourceReviewStatus: seed.sourceReviewStatus || (status === 'ok' ? 'needs_review' : 'unavailable'),
      provenanceNote: fileInfo.sha256
        ? seed.provenanceNote
        : `${seed.provenanceNote} Fetch status: ${fileInfo.error || status}.`,
    });
    await sleep(120);
  }

  return sources;
}

function buildFinancialDisclosureReports(
  historicalSources: HistoricalSource[],
  assetIncomeHoldings: AssetIncomeHolding[],
  liabilities: Liability[]
): FinancialDisclosureReport[] {
  return historicalSources
    .filter((source) => source.filingType !== '278-T')
    .map((source) => {
      const assets = assetIncomeHoldings.filter((item) => item.sourceId === source.id);
      const sourceLiabilities = liabilities.filter((item) => item.sourceId === source.id);
      const parserStatus: FinancialDisclosureReport['parserStatus'] = assets.length > 0 || sourceLiabilities.length > 0 ? 'parsed' : 'needs-review';
      return {
        id: stableId(`financial-report|${source.id}`),
        sourceId: source.id,
        filingType: source.filingType,
        filedDate: source.filedDate,
        reportYear: source.reportYear,
        sourceReliability: source.sourceReliability,
        parserStatus,
        assetIncomeCount: assets.length,
        liabilityCount: sourceLiabilities.length,
        notes: assets.length > 0 || sourceLiabilities.length > 0
          ? 'Structured annual/candidate disclosure rows are present in the cache.'
          : 'Source registered for coverage; holdings, income assets, and liabilities need PDF-table extraction review.',
      };
    })
    .sort((a, b) => a.filedDate.localeCompare(b.filedDate) || a.filingType.localeCompare(b.filingType));
}

async function buildAssetIncomeHoldings(
  baselineHoldings: BaselineHolding[],
  historicalSources: HistoricalSource[]
): Promise<AssetIncomeHolding[]> {
  const existing = await readJson<AssetIncomeHolding[]>('asset-income-holdings.json', []);
  const latestAnnualSource = latestDisclosureSource(historicalSources, 'Annual 278e');
  if (latestAnnualSource?.sourceUrl) {
    try {
      const text = await extractPdfText(latestAnnualSource.sourceUrl);
      const parsed = parseAssetIncomeHoldingsFromText(text, latestAnnualSource);
      if (parsed.length > 0) return parsed;
    } catch (error) {
      console.warn(`[Annual disclosure parser] Could not parse ${latestAnnualSource.sourceUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (existing.length > 0) return existing;

  if (!latestAnnualSource || baselineHoldings.length === 0) return [];

  return baselineHoldings.map((holding) => ({
    id: stableId(`asset-income-holding|${latestAnnualSource.id}|${holding.id}`),
    sourceId: latestAnnualSource.id,
    description: holding.description,
    normalizedDescription: holding.normalizedDescription,
    value: holding.value,
    incomeType: null,
    income: parseOgeAmountRange('None'),
    assetType: holding.assetType,
    sector: holding.sector,
    sourceReliability: latestAnnualSource.sourceReliability,
    confidence: holding.confidence,
    reviewFlags: holding.reviewFlags,
  }));
}

function buildBaselineHoldingsFromAssetIncome(assetIncomeHoldings: AssetIncomeHolding[]): BaselineHolding[] {
  return assetIncomeHoldings
    .filter((asset) => asset.value.midpoint > 0)
    .map((asset) => ({
      id: stableId(`baseline-holding|${asset.sourceId}|${asset.normalizedDescription}|${asset.value.label}`),
      description: asset.description,
      normalizedDescription: asset.normalizedDescription,
      ...emptyEnrichmentFields(),
      value: asset.value,
      assetType: asset.assetType,
      sector: asset.sector,
      sourceFilingId: asset.sourceId,
      confidence: Math.min(asset.confidence, 0.74),
      reviewFlags: [
        ...new Set([
          ...asset.reviewFlags,
          'Parsed from annual 278e text; review source row before publication.',
        ]),
      ],
    }));
}

async function buildLiabilities(historicalSources: HistoricalSource[]): Promise<Liability[]> {
  const existing = await readJson<Liability[]>('liabilities.json', []);
  const latestAnnualSource = latestDisclosureSource(historicalSources, 'Annual 278e');
  if (latestAnnualSource?.sourceUrl) {
    try {
      const text = await extractPdfText(latestAnnualSource.sourceUrl);
      const parsed = parseLiabilitiesFromText(text, latestAnnualSource);
      if (parsed.length > 0) return parsed;
    } catch (error) {
      console.warn(`[Annual disclosure parser] Could not parse liabilities from ${latestAnnualSource.sourceUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return existing;
}

function latestDisclosureSource(
  historicalSources: HistoricalSource[],
  filingType: HistoricalSource['filingType']
): HistoricalSource | null {
  return historicalSources
    .filter((source) => source.filingType === filingType)
    .filter((source) => source.sourceUrl && source.fetchStatus !== 'failed')
    .sort((a, b) =>
      b.filedDate.localeCompare(a.filedDate) ||
      sourceReliabilityRank(b.sourceReliability) - sourceReliabilityRank(a.sourceReliability)
    )[0] || null;
}

async function extractPdfText(url: string): Promise<string> {
  const parser = new PDFParse({ url });
  try {
    const result = await parser.getText();
    return result.text || '';
  } finally {
    await parser.destroy();
  }
}

function parseAssetIncomeHoldingsFromText(text: string, source: HistoricalSource): AssetIncomeHolding[] {
  const rows: AssetIncomeHolding[] = [];
  const rowPattern = numberedAssetRowPattern();
  const seen = new Set<string>();
  let inPart6 = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = normalizePdfLine(rawLine);
    if (/Part 6:\s*Other Assets and Income/i.test(line)) {
      inPart6 = true;
      continue;
    }
    if (inPart6 && /Part 7:\s*Transactions|Part 8:\s*Liabilities|Part 9:\s*Gifts/i.test(line)) {
      inPart6 = false;
      continue;
    }
    if (!inPart6) continue;

    const match = line.match(rowPattern);
    if (!match) continue;
    const [, rowNumber, description, valueLabel, incomeTypeRaw, incomeLabelRaw] = match;
    const cleanedDescription = description.trim();
    if (!cleanedDescription || cleanedDescription === 'N/A') continue;
    const value = parseOgeAmountRange(valueLabel);
    const incomeType = cleanIncomeType(incomeTypeRaw);
    const income = parseOgeAmountRange(incomeLabelRaw || incomeTypeRaw);
    const classification = classifySecurity(cleanedDescription);
    const key = `${rowNumber}|${cleanedDescription}|${value.label}|${income.label}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      id: stableId(`asset-income-holding|${source.id}|${key}`),
      sourceId: source.id,
      description: cleanedDescription,
      normalizedDescription: classification.normalizedDescription,
      value,
      incomeType,
      income,
      assetType: classification.assetType,
      sector: classification.sector,
      sourceReliability: source.sourceReliability,
      confidence: Math.min(0.78, classification.confidence),
      reviewFlags: [
        ...new Set([
          ...classification.flags,
          'Parsed from annual 278e Part 6 text; verify PDF row before publication.',
          ...(value.midpoint === 0 ? ['No disclosed value range parsed'] : []),
        ]),
      ],
    });
  }

  return rows.sort((a, b) => b.value.midpoint - a.value.midpoint || a.description.localeCompare(b.description));
}

function parseLiabilitiesFromText(text: string, source: HistoricalSource): Liability[] {
  const part8 = text.match(/Part 8:\s*Liabilities([\s\S]*?)(?:Part 9:\s*Gifts|Schedule 1 for Part 2|$)/i)?.[1] || '';
  if (!part8) return [];

  const chunks: string[] = [];
  let current = '';
  for (const rawLine of part8.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^(# Creditor|Instructions|Filer's Name|Page \d+|--|\d+\.)$/i.test(line)) continue;
    const startsNewRow = /^\d+\.\s+/.test(line) || /^(New York Attorney General|American Express)\s+/i.test(line);
    if (startsNewRow && current) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);

  const liabilities: Liability[] = [];
  const seen = new Set<string>();
  const amountPattern = disclosureAmountPattern();
  const amountTail = new RegExp(`\\s(${amountPattern})\\s+(\\d{4}|N/A)\\s+([0-9.]+%|N/A)\\s+(.+)$`, 'i');

  for (const chunk of chunks) {
    const columnText = chunk.replace(/\r?\n/g, ' ').replace(/ +/g, ' ').trim();
    const amountMatch = columnText.match(amountTail);
    if (!amountMatch || amountMatch.index === undefined) continue;
    const beforeAmount = columnText.slice(0, amountMatch.index).replace(/^\d+\.\s*/, '').trim();
    const parts = beforeAmount.split(/\t+/).map((part) => part.trim()).filter(Boolean);
    const creditorName = parts[0] || inferCreditorName(beforeAmount.replace(/\t+/g, ' '));
    const type = parts.length > 1 ? parts.slice(1).join(' ') : beforeAmount.replace(/\t+/g, ' ').slice(creditorName.length).trim() || 'Unspecified liability';
    const amount = parseOgeAmountRange(amountMatch[1]);
    const key = `${creditorName}|${type}|${amount.label}|${amountMatch[2]}`;
    if (!creditorName || seen.has(key)) continue;
    seen.add(key);

    liabilities.push({
      id: stableId(`liability|${source.id}|${key}`),
      sourceId: source.id,
      creditorName,
      type,
      amount,
      yearIncurred: amountMatch[2] === 'N/A' ? null : amountMatch[2],
      rate: amountMatch[3] === 'N/A' ? null : amountMatch[3],
      term: amountMatch[4].trim(),
      sourceReliability: source.sourceReliability,
      confidence: 0.78,
      reviewFlags: ['Parsed from annual 278e Part 8 text; verify PDF row before publication.'],
    });
  }

  return liabilities.sort((a, b) => b.amount.midpoint - a.amount.midpoint || a.creditorName.localeCompare(b.creditorName));
}

function disclosureAmountPattern(): string {
  return String.raw`(?:None \(or less than \$1,001\)|None \(or less than \$201\)|Over \$50,000,000|\$[0-9,]+\s*-\s*\$[0-9,]+|\$[0-9,]+)`;
}

function numberedAssetRowPattern(): RegExp {
  const amount = disclosureAmountPattern();
  return new RegExp(String.raw`^(\d{1,4})\s+(.+?)\s+N/A\s+(${amount})\s+(.+?)(?:\s+(${amount}))?$`, 'i');
}

function normalizePdfLine(value: string): string {
  return value.replace(/\t+/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanIncomeType(value: string): string | null {
  const cleaned = value.trim();
  if (!cleaned || /^None \(or less than \$201\)$/i.test(cleaned)) return null;
  return cleaned;
}

function inferCreditorName(value: string): string {
  const match = value.match(/^(.+?)\s+(mortgage|litigation|credit card|Seven Springs|TIHT|Trump Plaza|40 Wall Street)/i);
  return match?.[1]?.trim() || value.trim();
}

function sourceReliabilityRank(reliability: HistoricalSource['sourceReliability']): number {
  if (reliability === 'official') return 3;
  if (reliability === 'archived_copy') return 2;
  return 1;
}

function buildYearlyExposureSummaries(params: {
  historicalSources: HistoricalSource[];
  transactions: OgeTransaction[];
  assetIncomeHoldings: AssetIncomeHolding[];
  liabilities: Liability[];
  trumpIndex: TrumpIndexEntry[];
}): YearlyExposureSummary[] {
  const years = new Set<number>();
  for (const source of params.historicalSources) {
    if (source.reportYear) years.add(source.reportYear);
    const filedYear = Number(source.filedDate.slice(0, 4));
    if (Number.isFinite(filedYear)) years.add(filedYear);
  }
  for (const tx of params.transactions) {
    const year = Number(tx.date.slice(0, 4));
    if (Number.isFinite(year)) years.add(year);
  }

  const latestTransactionYear = Math.max(0, ...params.transactions.map((tx) => Number(tx.date.slice(0, 4))).filter(Number.isFinite));
  return Array.from(years)
    .sort((a, b) => a - b)
    .map((year) => {
      const sources = params.historicalSources.filter((source) =>
        source.reportYear === year || Number(source.filedDate.slice(0, 4)) === year
      );
      const assets = params.assetIncomeHoldings.filter((asset) =>
        sources.some((source) => source.id === asset.sourceId)
      );
      const liabilities = params.liabilities.filter((liability) =>
        sources.some((source) => source.id === liability.sourceId)
      );
      const transactions = params.transactions.filter((tx) => Number(tx.date.slice(0, 4)) === year);
      const purchases = transactions.filter((tx) => tx.type === 'Purchase').map((tx) => tx.amount);
      const sales = transactions.filter((tx) => tx.type === 'Sale').map((tx) => tx.amount);
      const sourceReliability = strongestSourceReliability(sources.map((source) => source.sourceReliability));
      const assetCurrent = assets.reduce((total, asset) => total + asset.value.midpoint, 0);
      const latestIndexCurrent = year === latestTransactionYear
        ? params.trumpIndex.reduce((total, entry) => total + entry.currentMidpoint, 0)
        : 0;

      return {
        year,
        sourceIds: sources.map((source) => source.id),
        sourceReliability,
        assetIncomeCount: assets.length,
        liabilityCount: liabilities.length,
        transactionCount: transactions.length,
        currentMidpoint: assetCurrent || latestIndexCurrent,
        purchaseMidpoint: addRanges('Purchases', purchases).midpoint,
        saleMidpoint: addRanges('Sales', sales).midpoint,
        netFlowMidpoint: addRanges('Purchases', purchases).midpoint - addRanges('Sales', sales).midpoint,
      };
    });
}

function buildSourceAudit(records: OgeApiRecord[], historicalSources: HistoricalSource[]): SourceAudit {
  const now = new Date();
  const currentYear = now.getFullYear();
  const sourceUrls = new Set(historicalSources.map((source) => source.sourceUrl).filter(Boolean));
  const officialRecordUrls = records.map((record) => extractPdfUrl(record.type) || extractHref(record.type)).filter(Boolean);
  const officialRecordsWithoutRegistry = officialRecordUrls.filter((url) => !sourceUrls.has(url)).length;
  const coverageByYear: SourceAudit['coverageByYear'] = [];
  const gaps: SourceAudit['gaps'] = [];

  for (let year = 2015; year <= currentYear; year += 1) {
    const sources = historicalSources.filter((source) => {
      const filedYear = Number(source.filedDate.slice(0, 4));
      return source.reportYear === year || filedYear === year;
    });
    const annualOrCandidateCount = sources.filter((source) =>
      source.filingType === 'Annual 278e' ||
      source.filingType === 'Candidate 278e' ||
      source.filingType === 'Termination 278e'
    ).length;
    const transactionReportCount = sources.filter((source) => source.filingType === '278-T').length;
    const officialCount = sources.filter((source) => source.sourceReliability === 'official').length;
    const archivedCount = sources.filter((source) => source.sourceReliability === 'archived_copy').length;
    const metadataOnlyCount = sources.filter((source) => source.sourceReliability === 'metadata_only').length;
    const notes: string[] = [];
    let status: SourceAudit['coverageByYear'][number]['status'] = 'covered';

    if (sources.length === 0) {
      status = 'gap';
      notes.push('No source registry entry for this year.');
      gaps.push({
        year,
        severity: year >= 2017 && year <= 2020 ? 'high' : 'medium',
        issue: 'No Trump OGE source registered for the year.',
        suggestedAction: year >= 2017 && year <= 2020
          ? 'Add archived or request-only annual presidential disclosure metadata/PDF for this in-office year.'
          : 'Verify whether Trump had a filing obligation or public candidate report for this year; add request-only metadata if relevant.',
      });
    } else if (annualOrCandidateCount === 0 && transactionReportCount === 0) {
      status = 'gap';
      notes.push('Registry has sources, but no supported filing type was identified.');
      gaps.push({
        year,
        severity: 'medium',
        issue: 'Registered sources lack a supported 278e/278-T filing type.',
        suggestedAction: 'Review the source title/type parser and add a curated historical-source seed if needed.',
      });
    } else if (annualOrCandidateCount === 0 && year >= 2017 && year <= 2020) {
      status = 'partial';
      notes.push('In-office year has no annual/termination disclosure row in the registry.');
      gaps.push({
        year,
        severity: 'high',
        issue: 'No annual or termination disclosure row for a presidential in-office year.',
        suggestedAction: 'Locate an archived annual 278e PDF or retain OGE request-only metadata for this year.',
      });
    } else if (officialCount === 0) {
      status = 'partial';
      notes.push('Coverage relies on archived copies or metadata-only records, not a currently fetchable OGE PDF.');
    }

    coverageByYear.push({
      year,
      registryCount: sources.length,
      officialCount,
      archivedCount,
      metadataOnlyCount,
      transactionReportCount,
      annualOrCandidateCount,
      status,
      notes,
    });
  }

  const completenessStatus: SourceAudit['completenessStatus'] = officialRecordsWithoutRegistry > 0
    ? 'incomplete'
    : gaps.length > 0
      ? 'needs_historical_review'
      : 'complete_for_current_oge_api';

  return {
    generatedAt: now.toISOString(),
    minDate: MIN_DOC_DATE,
    checkedThrough: now.toISOString().slice(0, 10),
    ogeApiRecordCount: records.length,
    registrySourceCount: historicalSources.length,
    officialPdfCount: historicalSources.filter((source) => source.sourceReliability === 'official').length,
    archivedCopyCount: historicalSources.filter((source) => source.sourceReliability === 'archived_copy').length,
    metadataOnlyCount: historicalSources.filter((source) => source.sourceReliability === 'metadata_only').length,
    officialRecordsWithoutRegistry,
    coverageByYear,
    gaps,
    completenessStatus,
    notes: [
      'Completeness is measured against currently exposed OGE API records plus curated archived/request-only historical seeds.',
      'OGE warns that most public financial disclosure reports and associated documents are destroyed after 6 to 7 years unless retained for a specific reason; old annual PDFs may require archived copies or request metadata.',
      'High-priority gaps cover likely in-office annual disclosure years; medium gaps should be checked before publication-facing claims.',
    ],
  };
}

async function buildBootstrapTransactions(sourceFilings: SourceFiling[]): Promise<OgeTransaction[]> {
  const existing = await readExistingTransactions();

  try {
    const dataset = await fetchJson<OpenCabinetDataset>(OPEN_CABINET_FULL_DATASET_URL);
    const official = dataset.officials.find((item) => item.slug === 'trump-donald-j');
    if (!official) throw new Error('Trump official not found in Open Cabinet dataset.');

    const mostRecentSourceUrl = sourceFilings
      .filter((filing) => filing.documentType === '278-T')
      .sort((a, b) => b.filedDate.localeCompare(a.filedDate))[0]?.ogeUrl || null;

    return official.transactions.map((row, index) => normalizeTransaction(row, index, mostRecentSourceUrl));
  } catch (error) {
    if (existing.length > 0) {
      console.warn(`[Trump OGE] Open Cabinet bootstrap unavailable; preserving ${existing.length} existing transaction rows.`);
      return existing;
    }
    throw error;
  }
}

async function buildBaselineHoldings(sourceFilings: SourceFiling[]): Promise<BaselineHolding[]> {
  const existing = await readJson<BaselineHolding[]>('baseline-holdings.json', []);
  if (existing.length > 0) return existing;

  const annual = sourceFilings.find((filing) => filing.documentType === 'Annual 278e');
  if (!annual) return [];

  return [];
}

async function buildEvents(): Promise<OgeEvent[]> {
  const manualEvents = normalizeManualEvents(await readJson<OgeEvent[]>('manual-events.json', []));
  const contextDbEvents = await buildContextDbEvents();
  const federalRegisterEvents = await fetchFederalRegisterEvents();
  const fomcEvents = buildFomcEvents();
  return mergeEvents(manualEvents, contextDbEvents, federalRegisterEvents, fomcEvents)
    .filter((event) => event.date >= MIN_DOC_DATE)
    .sort((a, b) =>
      a.date.localeCompare(b.date) ||
      b.importance - a.importance ||
      a.title.localeCompare(b.title)
    );
}

async function buildContextDbEvents(): Promise<OgeEvent[]> {
  const cached = await readJson<OgeEvent[]>('events.json', []);
  const cachedContextEvents = cached.filter((event) => isContextDbEvent(event));
  if (!process.env.DATABASE_URL) {
    if (cachedContextEvents.length > 0) {
      console.warn(`[Trump context DB] DATABASE_URL not set; preserving ${cachedContextEvents.length} cached context events.`);
      return cachedContextEvents;
    }
    return [];
  }

  try {
    const events = await fetchTrumpContextDbEvents({
      minDate: MIN_DOC_DATE,
      socialLimit: intFromEnv('TRUMP_CONTEXT_DB_SOCIAL_LIMIT', 500),
      documentLimit: intFromEnv('TRUMP_CONTEXT_DB_DOCUMENT_LIMIT', 450),
      reutersLimit: intFromEnv('TRUMP_CONTEXT_DB_REUTERS_LIMIT', 350),
      totalLimit: intFromEnv('TRUMP_CONTEXT_DB_EVENT_LIMIT', 1200),
    });
    console.log(`[Trump context DB] Imported ${events.length} timing context events.`);
    return events;
  } catch (error) {
    if (cachedContextEvents.length > 0) {
      console.warn(`[Trump context DB] Import failed; preserving ${cachedContextEvents.length} cached context events: ${error instanceof Error ? error.message : String(error)}`);
      return cachedContextEvents;
    }
    console.warn(`[Trump context DB] Import failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function isContextDbEvent(event: OgeEvent): boolean {
  return [
    'Truth Social',
    'Twitter/X',
    'Factbase transcript',
    'Reuters',
    'Trump Archive',
    'White House executive order',
    'White House proclamation',
    'White House memorandum',
  ].includes(event.sourceName);
}

async function fetchFederalRegisterEvents(): Promise<OgeEvent[]> {
  const existing = await readJson<OgeEvent[]>('events.json', []);
  const fallback = existing.filter((event) => event.sourceName === 'Federal Register');
  const terms = [
    'tariff',
    'section 232',
    'reciprocal tariff',
    'harmonized tariff schedule',
    'trade and investment deal',
  ];
  const documents = new Map<string, NonNullable<FederalRegisterPage['results']>[number]>();

  try {
    for (const term of terms) {
      const params = new URLSearchParams();
      params.set('conditions[publication_date][gte]', MIN_DOC_DATE);
      params.set('conditions[publication_date][lte]', new Date().toISOString().slice(0, 10));
      params.set('conditions[term]', term);
      params.set('per_page', '100');
      params.set('order', 'newest');
      for (const field of ['title', 'publication_date', 'html_url', 'abstract', 'agencies', 'document_number']) {
        params.append('fields[]', field);
      }

      const page = await fetchJson<FederalRegisterPage>(`${FEDERAL_REGISTER_DOCUMENTS_URL}?${params.toString()}`);
      for (const document of page.results || []) {
        const key = document.document_number || `${document.publication_date}|${document.title}`;
        if (key) documents.set(key, document);
      }
      await sleep(120);
    }

    return Array.from(documents.values())
      .map(federalRegisterDocumentToEvent)
      .filter((event): event is OgeEvent => Boolean(event))
      .sort((a, b) =>
        b.importance - a.importance ||
        b.date.localeCompare(a.date) ||
        a.title.localeCompare(b.title)
      )
      .slice(0, 140);
  } catch (error) {
    if (fallback.length > 0) {
      console.warn(`[Event overlay] Federal Register unavailable; preserving ${fallback.length} cached events.`);
      return fallback;
    }
    console.warn(`[Event overlay] Federal Register unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function buildPublicSecurityReference(): Promise<SecurityReferenceCache> {
  const existing = await readJson<SecurityReferenceCache | null>('security-reference.json', null);
  const generatedAt = new Date().toISOString();
  const sources: SecurityReferenceSource[] = [];

  const secResult = await fetchSecReference(generatedAt, existing);
  sources.push(secResult.source);

  const nasdaqResult = await fetchNasdaqReferences(generatedAt, existing);
  sources.push(...nasdaqResult.sources);

  return buildSecurityReferenceCache({
    generatedAt,
    secEntries: secResult.entries,
    nasdaqEntries: nasdaqResult.entries,
    sicByCik: existing?.sicByCik || {},
    sources,
  });
}

async function completeSecurityReferenceWithSic(
  reference: SecurityReferenceCache,
  matchedCiks: number[]
): Promise<SecurityReferenceCache> {
  const sicByCik = { ...reference.sicByCik };
  let fetched = 0;
  let failed = 0;

  for (const cik of matchedCiks) {
    const key = String(cik);
    if (sicByCik[key]) continue;
    try {
      const sic = await fetchSecSic(cik);
      sicByCik[key] = sic;
      fetched += 1;
    } catch (error) {
      failed += 1;
      console.warn(`[Security enrichment] Could not fetch SEC SIC for CIK ${cik}: ${error instanceof Error ? error.message : String(error)}`);
    }
    await sleep(120);
  }

  const source: SecurityReferenceSource = {
    name: 'SEC company submissions',
    url: SEC_SUBMISSIONS_BASE_URL,
    fetchedAt: new Date().toISOString(),
    rowCount: fetched,
    status: failed > 0 && fetched === 0 ? 'failed' : 'ok',
    ...(failed > 0 ? { error: `${failed} matched CIKs could not be fetched.` } : {}),
  };

  return {
    ...reference,
    sources: [...reference.sources, source],
    sicByCik,
    entries: reference.entries.map((entry) => {
      const sic = entry.cik ? sicByCik[String(entry.cik)] : null;
      return sic
        ? {
            ...entry,
            sic: sic.sic,
            sicDescription: sic.sicDescription,
            sector: sic.sector,
          }
        : entry;
    }),
  };
}

async function fetchSecReference(
  fetchedAt: string,
  existing: SecurityReferenceCache | null
): Promise<{ entries: SecurityReferenceEntry[]; source: SecurityReferenceSource }> {
  try {
    const payload = await fetchJson<unknown>(SEC_COMPANY_TICKERS_EXCHANGE_URL);
    const entries = parseSecCompanyTickers(payload);
    return {
      entries,
      source: {
        name: 'SEC company tickers/exchanges',
        url: SEC_COMPANY_TICKERS_EXCHANGE_URL,
        fetchedAt,
        rowCount: entries.length,
        status: 'ok',
      },
    };
  } catch (error) {
    const entries = existing?.entries.filter((entry) => entry.sources.some((source) => source.startsWith('SEC'))) || [];
    return {
      entries,
      source: {
        name: 'SEC company tickers/exchanges',
        url: SEC_COMPANY_TICKERS_EXCHANGE_URL,
        fetchedAt,
        rowCount: entries.length,
        status: entries.length > 0 ? 'cached' : 'failed',
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function fetchNasdaqReferences(
  fetchedAt: string,
  existing: SecurityReferenceCache | null
): Promise<{ entries: ParsedNasdaqSecurity[]; sources: SecurityReferenceSource[] }> {
  const results = await Promise.all([
    fetchNasdaqDirectory(NASDAQ_LISTED_URL, 'nasdaq-listed', fetchedAt),
    fetchNasdaqDirectory(NASDAQ_OTHER_LISTED_URL, 'other-listed', fetchedAt),
  ]);
  const entries = results.flatMap((result) => result.entries);
  const sources = results.map((result) => result.source);

  if (entries.length > 0) return { entries, sources };

  const fallback = (existing?.entries || [])
    .filter((entry) => entry.sources.some((source) => source.startsWith('Nasdaq Trader')))
    .map((entry) => ({
      ticker: entry.ticker,
      issuerName: entry.issuerName,
      exchange: entry.exchange,
      isEtf: entry.isEtf,
      isTestIssue: entry.isTestIssue,
      source: 'Nasdaq Trader listed' as const,
    }));

  return {
    entries: fallback,
    sources: sources.map((source) => ({
      ...source,
      rowCount: fallback.length,
      status: fallback.length > 0 ? 'cached' : source.status,
    })),
  };
}

async function fetchNasdaqDirectory(
  url: string,
  directory: 'nasdaq-listed' | 'other-listed',
  fetchedAt: string
): Promise<{ entries: ParsedNasdaqSecurity[]; source: SecurityReferenceSource }> {
  try {
    const text = await fetchText(url);
    const entries = parseNasdaqSymbolDirectory(text, directory);
    return {
      entries,
      source: {
        name: directory === 'nasdaq-listed' ? 'Nasdaq Trader listed symbols' : 'Nasdaq Trader other-listed symbols',
        url,
        fetchedAt,
        rowCount: entries.length,
        status: 'ok',
      },
    };
  } catch (error) {
    return {
      entries: [],
      source: {
        name: directory === 'nasdaq-listed' ? 'Nasdaq Trader listed symbols' : 'Nasdaq Trader other-listed symbols',
        url,
        fetchedAt,
        rowCount: 0,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function fetchSecSic(cik: number): Promise<SecurityReferenceCache['sicByCik'][string]> {
  const paddedCik = String(cik).padStart(10, '0');
  const payload = await fetchJson<{ sic?: string | number; sicDescription?: string }>(
    `${SEC_SUBMISSIONS_BASE_URL}/CIK${paddedCik}.json`
  );
  const sic = payload.sic === undefined || payload.sic === null || payload.sic === '' ? null : String(payload.sic);
  const sicDescription = payload.sicDescription?.trim() || null;
  return {
    sic,
    sicDescription,
    sector: broadSectorFromSic(sic, sicDescription),
  };
}

function normalizeTransaction(
  row: OpenCabinetDataset['officials'][number]['transactions'][number],
  index: number,
  sourceUrl: string | null
): OgeTransaction {
  const amount = parseOgeAmountRange(row.amount);
  const classification = classifySecurity(row.description);
  const type = normalizeTransactionType(row.type);
  const reviewFlags = [...classification.flags];
  if (amount.midpoint === 0) reviewFlags.push('Unknown amount range');
  if (type === 'Other') reviewFlags.push(`Unexpected transaction type: ${row.type}`);

  const id = stableId([
    row.description,
    row.ticker || '',
    type,
    row.date,
    amount.label,
    String(index),
  ].join('|'));

  return {
    id,
    description: row.description,
    normalizedDescription: classification.normalizedDescription,
    ticker: normalizeTicker(row.ticker),
    ...emptyEnrichmentFields(),
    type,
    date: row.date,
    amount,
    lateFilingFlag: Boolean(row.lateFilingFlag),
    sourceFilingId: null,
    sourceUrl,
    assetType: classification.assetType,
    sector: classification.sector,
    classificationConfidence: classification.confidence,
    parserStatus: 'bootstrap-structured',
    reviewFlags,
  };
}

function buildCacheMeta(dataset: Omit<TrumpOgeDataset, 'cacheMeta'>): CacheMeta {
  const estimatedVolume = addRanges('Estimated transaction volume', dataset.transactions.map((tx) => tx.amount));
  const latestFilingDate = dataset.sourceFilings.map((filing) => filing.filedDate).sort().at(-1) || null;
  const annual = dataset.historicalSources
    .filter((filing) => filing.filingType === 'Annual 278e')
    .sort((a, b) => b.filedDate.localeCompare(a.filedDate))[0] ||
    dataset.sourceFilings
      .filter((filing) => filing.documentType === 'Annual 278e')
      .sort((a, b) => b.filedDate.localeCompare(a.filedDate))[0];
  const enrichedTransactionCount = dataset.transactions.filter((tx) => tx.resolvedTicker).length;
  const instrumentContextCount = dataset.transactions.filter((tx) => tx.instrumentSummary || tx.issuerContextTicker).length;

  return {
    generatedAt: new Date().toISOString(),
    dataThrough: latestFilingDate,
    source: 'OGE source metadata and PDFs; transaction rows bootstrapped from Open Cabinet structured export.',
    sourceFilingCount: dataset.sourceFilings.length,
    transactionCount: dataset.transactions.length,
    baselineHoldingCount: dataset.baselineHoldings.length,
    estimatedHoldingCount: dataset.holdingsEstimates.length,
    reviewQueueCount: dataset.reviewQueue.length,
    lateTransactionCount: dataset.transactions.filter((tx) => tx.lateFilingFlag).length,
    estimatedTotalMidpoint: estimatedVolume.midpoint,
    securityReferenceCount: dataset.securityReference.entries.length,
    securityEnrichmentCount: dataset.securityEnrichments.length,
    instrumentContextCount,
    enrichedTransactionCount,
    eventCount: dataset.events.length,
    eventWindowCount: dataset.eventWindows.length,
    historicalSourceCount: dataset.historicalSources.length,
    financialDisclosureReportCount: dataset.financialDisclosureReports.length,
    assetIncomeHoldingCount: dataset.assetIncomeHoldings.length,
    liabilityCount: dataset.liabilities.length,
    trumpIndexCount: dataset.trumpIndex.length,
    notes: [
      'OGE PDF URLs and SHA-256 fingerprints are treated as canonical source provenance.',
      'Historical source registry starts at Jan. 1, 2015 and separates official PDFs, archived public copies, and request-only metadata.',
      'Transaction values are statutory disclosure ranges; midpoint totals are estimates, not exact trading value.',
      'Trump Index score = 50% log-scaled current exposure rank + 30% absolute midpoint change rank + 20% gross transaction activity rank.',
      annual
        ? dataset.assetIncomeHoldings.length > 0
          ? `Annual 278e source located at ${annual.filedDate}; annual asset/income rows are parsed into baseline holdings with review flags.`
          : `Annual 278e source located at ${annual.filedDate}; holdings estimates remain transaction-implied until that baseline is extracted.`
        : 'No annual 278e source was found in the current OGE record set.',
      'Annual/candidate/termination disclosure rows remain parser-reviewed unless structured asset-income and liability rows are present in the cache.',
      'Security enrichment uses public SEC and Nasdaq Trader reference data; sector labels are SEC/SIC-derived broad sectors, not proprietary GICS classifications.',
      `Instrument context parsed ${instrumentContextCount.toLocaleString('en-US')} transaction rows into issuer/fixed-income summaries where OGE descriptions allowed it.`,
      `Security enrichment resolved ${enrichedTransactionCount.toLocaleString('en-US')} transaction rows to public-company tickers.`,
      `Annual disclosure parser produced ${dataset.assetIncomeHoldings.length.toLocaleString('en-US')} asset/income rows and ${dataset.liabilities.length.toLocaleString('en-US')} liability rows.`,
      'Event overlay uses public Federal Register and Federal Reserve sources, optional Trump context database rows, and optional manual events; event proximity does not imply motive or causation.',
      'Rules-based classifications remain as fallback and include review flags for ambiguous or unmatched rows.',
    ],
  };
}

async function writeDataset(dataset: TrumpOgeDataset) {
  await fs.mkdir(DATA_ROOT, { recursive: true });
  await Promise.all([
    writeJson('historical-sources.json', dataset.historicalSources),
    writeJson('source-filings.json', dataset.sourceFilings),
    writeJson('transactions.json', dataset.transactions),
    writeJson('baseline-holdings.json', dataset.baselineHoldings),
    writeJson('financial-disclosure-reports.json', dataset.financialDisclosureReports),
    writeJson('asset-income-holdings.json', dataset.assetIncomeHoldings),
    writeJson('liabilities.json', dataset.liabilities),
    writeJson('yearly-exposure-summaries.json', dataset.yearlyExposureSummaries),
    writeJson('source-audit.json', dataset.sourceAudit),
    writeJson('holdings-estimates.json', dataset.holdingsEstimates),
    writeJson('sector-summaries.json', dataset.sectorSummaries),
    writeJson('trump-index.json', dataset.trumpIndex),
    writeJson('trump-index-rollups.json', dataset.trumpIndexRollups),
    writeJson('review-queue.json', dataset.reviewQueue),
    writeJson('events.json', dataset.events),
    writeJson('event-windows.json', dataset.eventWindows),
    writeJson('security-reference.json', dataset.securityReference),
    writeJson('security-enrichment.json', dataset.securityEnrichments),
    writeJson('cache-meta.json', dataset.cacheMeta),
  ]);
}

async function fetchPdfFingerprint(url: string): Promise<{ bytes: number | null; sha256: string | null; error?: string }> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': process.env.OGE_USER_AGENT || 'Reuters OGE Dashboard contact@example.com',
        'Accept': 'application/pdf,*/*',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      bytes: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex').toUpperCase(),
    };
  } catch (error) {
    return {
      bytes: null,
      sha256: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': process.env.OGE_USER_AGENT || 'Reuters OGE Dashboard contact@example.com',
      'Accept': 'application/json,text/plain,*/*',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  return await response.json() as T;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': process.env.OGE_USER_AGENT || 'Reuters OGE Dashboard contact@example.com',
      'Accept': 'text/plain,text/csv,*/*',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  return await response.text();
}

async function readExistingTransactions(): Promise<OgeTransaction[]> {
  return readJson<OgeTransaction[]>('transactions.json', []);
}

async function readJson<T>(filename: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(path.join(DATA_ROOT, filename), 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(filename: string, value: unknown) {
  await fs.writeFile(path.join(DATA_ROOT, filename), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function extractPdfUrl(typeField: string): string {
  const match = String(typeField || '').match(/href=['"]([^'"]+\.pdf(?:\?[^'"]*)?)['"]/i);
  return match?.[1] || '';
}

function extractHref(typeField: string): string {
  const match = String(typeField || '').match(/href=['"]([^'"]+)['"]/i);
  return match?.[1] || '';
}

function isSupportedDisclosure(typeField: string): boolean {
  return /278 Transaction|278T|278-T|Annual|Termination|Presidential Candidate|Candidate/i.test(typeField);
}

function classifyDocumentType(typeField: string): SourceFiling['documentType'] {
  if (/278 Transaction|278T|278-T/i.test(typeField)) return '278-T';
  if (/Annual/i.test(typeField)) return 'Annual 278e';
  return 'Other';
}

function classifyHistoricalFilingType(typeField: string): HistoricalSource['filingType'] {
  if (/278 Transaction|278T|278-T/i.test(typeField)) return '278-T';
  if (/Termination/i.test(typeField)) return 'Termination 278e';
  if (/Presidential Candidate|Candidate/i.test(typeField)) return 'Candidate 278e';
  if (/Annual/i.test(typeField)) return 'Annual 278e';
  return 'Other';
}

function textFromHtml(value: string): string {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function reportYearFromText(typeField: string, filedDate: string): number | null {
  const text = textFromHtml(typeField);
  const annualMatch = text.match(/Annual\s*\((20\d{2})\)/i);
  if (annualMatch) return Number(annualMatch[1]);
  const explicitYear = text.match(/\b(20\d{2})\b/);
  if (explicitYear) return Number(explicitYear[1]);
  const filedYear = Number(filedDate.slice(0, 4));
  return Number.isFinite(filedYear) ? filedYear : null;
}

function strongestSourceReliability(values: HistoricalSource['sourceReliability'][]): HistoricalSource['sourceReliability'] {
  if (values.includes('official')) return 'official';
  if (values.includes('archived_copy')) return 'archived_copy';
  return 'metadata_only';
}

function normalizeTransactionType(type: string): TransactionType {
  const value = type.trim().toLowerCase();
  if (value.startsWith('purchase')) return 'Purchase';
  if (value.startsWith('sale')) return 'Sale';
  if (value.startsWith('exchange')) return 'Exchange';
  return 'Other';
}

function normalizeTicker(value: string | null): string | null {
  const ticker = value?.trim().toUpperCase();
  return ticker || null;
}

function isoDate(value: string): string {
  return String(value || '').slice(0, 10);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function intFromEnv(key: string, fallback: number): number {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

main().catch((error) => {
  console.error('[Trump OGE Ingestion] Failed:', error);
  process.exitCode = 1;
});
