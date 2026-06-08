import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { addRanges, parseOgeAmountRange } from '../lib/oge/amounts';
import { buildHoldingsEstimates, buildReviewQueue, buildSectorSummaries, stableId } from '../lib/oge/analytics';
import { classifySecurity } from '../lib/oge/classify';
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
import type {
  BaselineHolding,
  CacheMeta,
  OgeTransaction,
  SecurityReferenceCache,
  SecurityReferenceEntry,
  SecurityReferenceSource,
  SourceFiling,
  TransactionType,
  TrumpOgeDataset,
} from '../lib/oge/types';

const OGE_API_BASE = 'https://extapps2.oge.gov/201/Presiden.nsf/API.xsp/v2/rest';
const OPEN_CABINET_FULL_DATASET_URL = 'https://open-cabinet.org/data/full-dataset.json';
const SEC_COMPANY_TICKERS_EXCHANGE_URL = 'https://www.sec.gov/files/company_tickers_exchange.json';
const SEC_SUBMISSIONS_BASE_URL = 'https://data.sec.gov/submissions';
const NASDAQ_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt';
const NASDAQ_OTHER_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt';
const DATA_ROOT = path.join(process.cwd(), 'data', 'oge', 'trump');
const OGE_PAGE_SIZE = 1000;
const MIN_DOC_DATE = '2025-01-01';
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

async function main() {
  const sourceRecords = await fetchTrumpOgeSourceRecords();
  const sourceFilings = await buildSourceFilings(sourceRecords);
  const bootstrapTransactions = await buildBootstrapTransactions(sourceFilings);
  const baseSecurityReference = await buildPublicSecurityReference();
  const firstPassEnrichment = enrichTransactions(bootstrapTransactions, baseSecurityReference);
  const securityReference = await completeSecurityReferenceWithSic(
    baseSecurityReference,
    collectResolvedCiks(firstPassEnrichment.transactions)
  );
  const { transactions, securityEnrichments } = enrichTransactions(bootstrapTransactions, securityReference);
  const baselineHoldings = await buildBaselineHoldings(sourceFilings);
  const holdingsEstimates = buildHoldingsEstimates(transactions, baselineHoldings);
  const sectorSummaries = buildSectorSummaries(transactions);
  const reviewQueue = buildReviewQueue({
    sourceFilings,
    transactions,
    baselineHoldings,
    holdingsEstimates,
  });
  const cacheMeta = buildCacheMeta({
    sourceFilings,
    transactions,
    baselineHoldings,
    holdingsEstimates,
    sectorSummaries,
    reviewQueue,
    securityReference,
    securityEnrichments,
  });

  await writeDataset({
    sourceFilings,
    transactions,
    baselineHoldings,
    holdingsEstimates,
    sectorSummaries,
    reviewQueue,
    securityReference,
    securityEnrichments,
    cacheMeta,
  });

  console.log(JSON.stringify({
    generatedAt: cacheMeta.generatedAt,
    sourceFilingCount: sourceFilings.length,
    transactionCount: transactions.length,
    baselineHoldingCount: baselineHoldings.length,
    estimatedHoldingCount: holdingsEstimates.length,
    reviewQueueCount: reviewQueue.length,
    securityReferenceCount: securityReference.entries.length,
    securityEnrichmentCount: securityEnrichments.length,
    enrichedTransactionCount: transactions.filter((tx) => tx.resolvedTicker).length,
    latestFilingDate: cacheMeta.dataThrough,
  }, null, 2));
}

async function fetchTrumpOgeSourceRecords(): Promise<OgeApiRecord[]> {
  const records: OgeApiRecord[] = [];
  let start = 0;
  let total = Number.POSITIVE_INFINITY;

  while (start < total) {
    const url = `${OGE_API_BASE}?start=${start}&length=${OGE_PAGE_SIZE}`;
    const page = await fetchJson<OgeApiPage>(url);
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
    .filter((record) => extractPdfUrl(record.type))
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

  return filings.sort((a, b) => a.filedDate.localeCompare(b.filedDate) || a.localFilename.localeCompare(b.localFilename));
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
  const annual = dataset.sourceFilings.find((filing) => filing.documentType === 'Annual 278e');
  const enrichedTransactionCount = dataset.transactions.filter((tx) => tx.resolvedTicker).length;

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
    enrichedTransactionCount,
    notes: [
      'OGE PDF URLs and SHA-256 fingerprints are treated as canonical source provenance.',
      'Transaction values are statutory disclosure ranges; midpoint totals are estimates, not exact trading value.',
      annual
        ? `Annual 278e source located at ${annual.filedDate}; holdings estimates remain transaction-implied until that baseline is extracted.`
        : 'No annual 278e source was found in the current OGE record set.',
      'Security enrichment uses public SEC and Nasdaq Trader reference data; sector labels are SEC/SIC-derived broad sectors, not proprietary GICS classifications.',
      `Security enrichment resolved ${enrichedTransactionCount.toLocaleString('en-US')} transaction rows to public-company tickers.`,
      'Rules-based classifications remain as fallback and include review flags for ambiguous or unmatched rows.',
    ],
  };
}

async function writeDataset(dataset: TrumpOgeDataset) {
  await fs.mkdir(DATA_ROOT, { recursive: true });
  await Promise.all([
    writeJson('source-filings.json', dataset.sourceFilings),
    writeJson('transactions.json', dataset.transactions),
    writeJson('baseline-holdings.json', dataset.baselineHoldings),
    writeJson('holdings-estimates.json', dataset.holdingsEstimates),
    writeJson('sector-summaries.json', dataset.sectorSummaries),
    writeJson('review-queue.json', dataset.reviewQueue),
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
  const match = String(typeField || '').match(/href='([^']+\.pdf)'/i);
  return match?.[1] || '';
}

function isSupportedDisclosure(typeField: string): boolean {
  return /278 Transaction|278T|278-T|Annual \(2025\)/i.test(typeField);
}

function classifyDocumentType(typeField: string): SourceFiling['documentType'] {
  if (/278 Transaction|278T|278-T/i.test(typeField)) return '278-T';
  if (/Annual/i.test(typeField)) return 'Annual 278e';
  return 'Other';
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

main().catch((error) => {
  console.error('[Trump OGE Ingestion] Failed:', error);
  process.exitCode = 1;
});
