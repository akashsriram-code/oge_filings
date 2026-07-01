import { buildSecurityKey, normalizeSecurityDescription } from './classify';
import { parseInstrumentDescription } from './instruments';
import type {
  AssetType,
  FixedIncomeIdentifierCache,
  FixedIncomeIdentifierCandidate,
  FixedIncomeIdentifierMatch,
  OgeTransaction,
  SecurityEnrichment,
} from './types';

interface OpenFigiSearchResponse {
  data?: OpenFigiSearchResult[];
  error?: string;
  warning?: string;
  next?: string;
}

interface OpenFigiSearchResult {
  figi?: string | null;
  ticker?: string | null;
  name?: string | null;
  exchCode?: string | null;
  securityType?: string | null;
  marketSector?: string | null;
  securityType2?: string | null;
  securityDescription?: string | null;
}

interface LookupOptions {
  apiKey?: string | null;
  lookupLimit?: number;
  now?: string;
  fetchFn?: typeof fetch;
  sleepMs?: number;
}

interface LookupGroup {
  key: string;
  sample: OgeTransaction;
  rows: OgeTransaction[];
  totalMidpoint: number;
}

class OpenFigiRateLimitError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const OPENFIGI_SEARCH_URL = 'https://api.openfigi.com/v3/search';
const OPENFIGI_DOCS_URL = 'https://www.openfigi.com/api/documentation';
const FIXED_INCOME_ASSET_TYPES = new Set<AssetType>(['Corporate Bond', 'Municipal Bond', 'Preferred / Hybrid']);

export const EMPTY_FIXED_INCOME_IDENTIFIER_CACHE: FixedIncomeIdentifierCache = {
  generatedAt: new Date(0).toISOString(),
  source: {
    name: 'OpenFIGI search',
    url: OPENFIGI_SEARCH_URL,
    fetchedAt: new Date(0).toISOString(),
    rowCount: 0,
    status: 'cached',
  },
  entries: [],
};

export async function buildFixedIncomeIdentifierCache(
  transactions: OgeTransaction[],
  existing: FixedIncomeIdentifierCache = EMPTY_FIXED_INCOME_IDENTIFIER_CACHE,
  options: LookupOptions = {}
): Promise<FixedIncomeIdentifierCache> {
  const now = options.now || new Date().toISOString();
  const fetchFn = options.fetchFn || fetch;
  const lookupLimit = Math.max(0, options.lookupLimit ?? 0);
  const existingByKey = new Map(existing.entries.map((entry) => [entry.securityKey, entry]));
  const groups = groupLookupCandidates(transactions);
  const entries = new Map<string, FixedIncomeIdentifierMatch>();

  let queried = 0;
  let failed = false;
  let errorMessage = '';

  for (const group of groups) {
    const cached = existingByKey.get(group.key);
    if (cached && cached.status !== 'failed') {
      entries.set(group.key, refreshCachedMatch(cached, group));
      continue;
    }
    if (queried >= lookupLimit) {
      entries.set(group.key, notQueriedMatch(group, now, 'Lookup cap reached; preserve row for future refresh.'));
      continue;
    }

    queried += 1;
    try {
      const match = await lookupOpenFigiMatch(group, { ...options, fetchFn, now });
      entries.set(group.key, match);
      const waitMs = options.sleepMs ?? (options.apiKey ? 3500 : 13_000);
      if (queried < lookupLimit && waitMs > 0) await sleep(waitMs);
    } catch (error) {
      if (error instanceof OpenFigiRateLimitError) {
        entries.set(group.key, notQueriedMatch(group, now, error.message));
        queried = lookupLimit;
        continue;
      }
      failed = true;
      errorMessage = error instanceof Error ? error.message : String(error);
      entries.set(group.key, failedMatch(group, now, errorMessage));
    }
  }

  for (const cached of existing.entries) {
    if (!entries.has(cached.securityKey)) entries.set(cached.securityKey, cached);
  }

  const values = Array.from(entries.values()).sort((a, b) =>
    b.totalMidpoint - a.totalMidpoint ||
    b.transactionCount - a.transactionCount ||
    a.description.localeCompare(b.description)
  );

  return {
    generatedAt: now,
    source: {
      name: 'OpenFIGI search',
      url: OPENFIGI_SEARCH_URL,
      fetchedAt: now,
      rowCount: values.length,
      status: failed ? 'failed' : queried > 0 ? 'ok' : 'cached',
      error: failed ? errorMessage : undefined,
    },
    entries: values,
  };
}

export function applyFixedIncomeIdentifiers(
  transactions: OgeTransaction[],
  cache: FixedIncomeIdentifierCache
): OgeTransaction[] {
  const byKey = new Map(cache.entries.map((entry) => [entry.securityKey, entry]));
  return transactions.map((tx) => {
    if (!FIXED_INCOME_ASSET_TYPES.has(tx.assetType)) return tx;
    if (tx.instrumentCusip || tx.instrumentIsin || tx.instrumentFigi) return tx;
    const match = byKey.get(buildSecurityKey(tx.description));
    if (!match || match.status !== 'matched' || !match.resolvedFigi) return tx;

    const contextFlags = new Set(tx.instrumentContextFlags.filter((flag) => flag !== 'No CUSIP/ISIN parsed'));
    contextFlags.add('OpenFIGI FIGI matched by issuer, coupon, and maturity; verify before publication.');

    return {
      ...tx,
      instrumentFigi: match.resolvedFigi,
      instrumentReferenceLabel: `OpenFIGI ${match.resolvedFigi}`,
      instrumentReferenceSource: 'OpenFIGI search exact FIGI match',
      instrumentReferenceUrl: null,
      instrumentReferenceStatus: 'exact',
      instrumentEvidenceSourceUrl: OPENFIGI_DOCS_URL,
      instrumentEvidenceNote: match.flags.join(' '),
      instrumentReviewStatus: 'needs_review',
      instrumentMatchSource: 'openfigi',
      instrumentMatchConfidence: Math.max(tx.instrumentMatchConfidence, match.confidence),
      instrumentContextFlags: Array.from(contextFlags),
    };
  });
}

export function rebuildSecurityEnrichmentsFromTransactions(transactions: OgeTransaction[]): SecurityEnrichment[] {
  const groups = new Map<string, SecurityEnrichment>();
  for (const tx of transactions) {
    const key = `${buildSecurityKey(tx.description)}|${tx.ticker || ''}`;
    const existing = groups.get(key);
    if (existing) {
      existing.transactionCount += 1;
      existing.assetTypes = Array.from(new Set([...existing.assetTypes, tx.assetType]));
      continue;
    }
    groups.set(key, {
      id: stableHash(`security-enrichment|${key}`),
      securityKey: buildSecurityKey(tx.description),
      description: tx.description,
      normalizedDescription: tx.normalizedDescription,
      sourceTicker: tx.ticker,
      resolvedTicker: tx.resolvedTicker,
      resolvedIssuerName: tx.resolvedIssuerName,
      resolvedExchange: tx.resolvedExchange,
      resolvedCik: tx.resolvedCik,
      resolvedSector: tx.resolvedSector,
      resolvedSic: tx.resolvedSic,
      resolvedSicDescription: tx.resolvedSicDescription,
      enrichmentSource: tx.enrichmentSource,
      enrichmentConfidence: tx.enrichmentConfidence,
      enrichmentFlags: tx.enrichmentFlags,
      instrumentKind: tx.instrumentKind,
      instrumentIssuerName: tx.instrumentIssuerName,
      instrumentCusip: tx.instrumentCusip,
      instrumentIsin: tx.instrumentIsin,
      instrumentFigi: tx.instrumentFigi,
      instrumentCoupon: tx.instrumentCoupon,
      instrumentMaturityDate: tx.instrumentMaturityDate,
      instrumentCallable: tx.instrumentCallable,
      instrumentCallDate: tx.instrumentCallDate,
      instrumentCallPrice: tx.instrumentCallPrice,
      instrumentYieldToCall: tx.instrumentYieldToCall,
      instrumentYieldToMaturity: tx.instrumentYieldToMaturity,
      instrumentIssuerState: tx.instrumentIssuerState,
      instrumentIssuerCategory: tx.instrumentIssuerCategory,
      instrumentReferenceLabel: tx.instrumentReferenceLabel,
      instrumentReferenceSource: tx.instrumentReferenceSource,
      instrumentReferenceUrl: tx.instrumentReferenceUrl,
      instrumentReferenceStatus: tx.instrumentReferenceStatus,
      instrumentEvidenceSourceUrl: tx.instrumentEvidenceSourceUrl,
      instrumentEvidenceNote: tx.instrumentEvidenceNote,
      instrumentReviewStatus: tx.instrumentReviewStatus,
      instrumentSummary: tx.instrumentSummary,
      instrumentMatchSource: tx.instrumentMatchSource,
      instrumentMatchConfidence: tx.instrumentMatchConfidence,
      instrumentContextFlags: tx.instrumentContextFlags,
      issuerContextTicker: tx.issuerContextTicker,
      issuerContextIssuerName: tx.issuerContextIssuerName,
      issuerContextExchange: tx.issuerContextExchange,
      issuerContextCik: tx.issuerContextCik,
      issuerContextSector: tx.issuerContextSector,
      issuerContextSource: tx.issuerContextSource,
      issuerContextConfidence: tx.issuerContextConfidence,
      issuerContextFlags: tx.issuerContextFlags,
      candidateTickers: tx.resolvedTicker ? [tx.resolvedTicker] : tx.issuerContextTicker ? [tx.issuerContextTicker] : [],
      transactionCount: 1,
      assetTypes: [tx.assetType],
    });
  }
  return Array.from(groups.values()).sort((a, b) =>
    b.transactionCount - a.transactionCount ||
    b.instrumentMatchConfidence - a.instrumentMatchConfidence ||
    a.description.localeCompare(b.description)
  );
}

export function resolveOpenFigiCandidates(
  group: Pick<LookupGroup, 'sample' | 'rows' | 'totalMidpoint'>,
  candidates: FixedIncomeIdentifierCandidate[],
  fetchedAt: string
): FixedIncomeIdentifierMatch {
  const sample = group.sample;
  const parsed = parseInstrumentDescription(sample.description, sample.assetType);
  const query = buildOpenFigiQuery(sample);
  const expectedMarket = sample.assetType === 'Municipal Bond' ? 'Muni' : 'Corp';
  const matchingMarket = candidates.filter((candidate) => normalizeSecurityDescription(candidate.marketSector || '') === normalizeSecurityDescription(expectedMarket));
  const couponMatches = matchingMarket.filter((candidate) => parsed.coupon === null || candidateCouponMatches(candidate, parsed.coupon));
  const maturityMatches = couponMatches.filter((candidate) => !parsed.maturityDate || candidateMaturityMatches(candidate, parsed.maturityDate));
  if (sample.assetType === 'Municipal Bond') {
    const muniCandidates = dedupeCandidates(applyRestrictedSecurityPreference(sample.description, maturityMatches));
    if (muniCandidates.length !== 1) {
      return {
        ...matchBase(group, query, fetchedAt),
        status: candidates.length === 0 ? 'not_found' : 'ambiguous',
        flags: [
          muniCandidates.length > 1
            ? `${muniCandidates.length} municipal OpenFIGI candidates share the disclosed coupon/maturity; CUSIP or review is required.`
            : 'OpenFIGI municipal candidates did not satisfy market/coupon/maturity checks.',
        ],
        candidates: muniCandidates.length > 0 ? muniCandidates.slice(0, 8) : candidates.slice(0, 8),
      };
    }
  }
  const issuerMatches = maturityMatches.filter((candidate) => issuerMatchesCandidate(parsed.issuerName || sample.issuerContextIssuerName || sample.resolvedIssuerName, candidate));
  const markerMatches = applyRestrictedSecurityPreference(sample.description, issuerMatches);
  const uniqueCandidates = dedupeCandidates(markerMatches);

  const base = matchBase(group, query, fetchedAt);
  if (candidates.length === 0) {
    return {
      ...base,
      status: 'not_found',
      flags: ['OpenFIGI returned no candidates for the fixed-income search query.'],
      candidates: [],
    };
  }
  if (uniqueCandidates.length === 1) {
    const candidate = uniqueCandidates[0];
    return {
      ...base,
      status: 'matched',
      resolvedFigi: candidate.figi,
      resolvedTicker: candidate.ticker,
      resolvedIssuerName: candidate.name,
      resolvedExchange: candidate.exchCode,
      resolvedSecurityDescription: candidate.securityDescription,
      resolvedMarketSector: candidate.marketSector,
      confidence: matchConfidence(sample, candidate),
      flags: [
        'OpenFIGI returned one clear candidate after market, issuer, coupon, maturity, and restricted-security filters.',
        'No public instrument URL is emitted; FIGI is stored as identifier evidence.',
      ],
      candidates: uniqueCandidates,
    };
  }

  return {
    ...base,
    status: 'ambiguous',
    flags: [
      candidates.length > 0
        ? `${uniqueCandidates.length} OpenFIGI candidates survived matching; reporter review required.`
        : 'OpenFIGI candidates did not satisfy issuer/coupon/maturity checks.',
    ],
    candidates: uniqueCandidates.length > 0 ? uniqueCandidates.slice(0, 8) : candidates.slice(0, 8),
  };
}

async function lookupOpenFigiMatch(group: LookupGroup, options: LookupOptions & { fetchFn: typeof fetch; now: string }): Promise<FixedIncomeIdentifierMatch> {
  const query = buildOpenFigiQuery(group.sample);
  if (!query) return notQueriedMatch(group, options.now, 'Insufficient issuer/coupon/maturity data for OpenFIGI search.');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (options.apiKey) headers['X-OPENFIGI-APIKEY'] = options.apiKey;

  const response = await options.fetchFn(OPENFIGI_SEARCH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after');
    throw new OpenFigiRateLimitError(`OpenFIGI anonymous rate limit reached${retryAfter ? `; retry after ${retryAfter}s` : ''}.`);
  }
  if (!response.ok) throw new Error(`OpenFIGI search HTTP ${response.status}: ${text.slice(0, 300)}`);

  const payload = JSON.parse(text) as OpenFigiSearchResponse;
  const candidates = (payload.data || []).map(openFigiCandidate).filter((candidate): candidate is FixedIncomeIdentifierCandidate => Boolean(candidate?.figi));
  const match = resolveOpenFigiCandidates(group, candidates, options.now);
  const remaining = response.headers.get('ratelimit-remaining');
  const reset = response.headers.get('ratelimit-reset');
  return {
    ...match,
    flags: [
      ...match.flags,
      ...(remaining ? [`OpenFIGI rate remaining: ${remaining}`] : []),
      ...(reset ? [`OpenFIGI rate reset seconds: ${reset}`] : []),
    ],
  };
}

function groupLookupCandidates(transactions: OgeTransaction[]): LookupGroup[] {
  const groups = new Map<string, LookupGroup>();
  for (const tx of transactions) {
    if (!FIXED_INCOME_ASSET_TYPES.has(tx.assetType)) continue;
    if (tx.instrumentCusip || tx.instrumentIsin || tx.instrumentFigi) continue;
    if (!tx.instrumentCoupon || !tx.instrumentMaturityDate) continue;
    const key = buildSecurityKey(tx.description);
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(tx);
      existing.totalMidpoint += tx.amount.midpoint;
      continue;
    }
    groups.set(key, {
      key,
      sample: tx,
      rows: [tx],
      totalMidpoint: tx.amount.midpoint,
    });
  }
  return Array.from(groups.values()).sort((a, b) =>
    b.totalMidpoint - a.totalMidpoint ||
    b.rows.length - a.rows.length ||
    a.sample.description.localeCompare(b.sample.description)
  );
}

function refreshCachedMatch(match: FixedIncomeIdentifierMatch, group: LookupGroup): FixedIncomeIdentifierMatch {
  return {
    ...match,
    transactionCount: group.rows.length,
    totalMidpoint: group.totalMidpoint,
  };
}

function notQueriedMatch(group: LookupGroup, fetchedAt: string, reason: string): FixedIncomeIdentifierMatch {
  return {
    ...matchBase(group, buildOpenFigiQuery(group.sample), fetchedAt),
    status: 'not_queried',
    flags: [reason],
    candidates: [],
  };
}

function failedMatch(group: LookupGroup, fetchedAt: string, error: string): FixedIncomeIdentifierMatch {
  return {
    ...matchBase(group, buildOpenFigiQuery(group.sample), fetchedAt),
    status: 'failed',
    flags: ['OpenFIGI lookup failed; cached or unresolved identifier state preserved.'],
    candidates: [],
    error,
  };
}

function matchBase(
  group: Pick<LookupGroup, 'sample' | 'rows' | 'totalMidpoint'>,
  query: string,
  fetchedAt: string
): FixedIncomeIdentifierMatch {
  const sample = group.sample;
  const parsed = parseInstrumentDescription(sample.description, sample.assetType);
  return {
    id: stableHash(`fixed-income-identifier|${buildSecurityKey(sample.description)}`),
    securityKey: buildSecurityKey(sample.description),
    description: sample.description,
    normalizedDescription: sample.normalizedDescription,
    assetType: sample.assetType,
    parsedIssuerName: parsed.issuerName,
    issuerContextTicker: sample.issuerContextTicker,
    coupon: parsed.coupon,
    maturityDate: parsed.maturityDate,
    query,
    status: 'not_queried',
    source: 'openfigi-search',
    fetchedAt,
    resolvedFigi: null,
    resolvedTicker: null,
    resolvedIssuerName: null,
    resolvedExchange: null,
    resolvedSecurityDescription: null,
    resolvedMarketSector: null,
    confidence: 0,
    flags: [],
    candidates: [],
    transactionCount: group.rows.length,
    totalMidpoint: group.totalMidpoint,
    error: null,
  };
}

function buildOpenFigiQuery(tx: OgeTransaction): string {
  const parsed = parseInstrumentDescription(tx.description, tx.assetType);
  const issuer = tx.issuerContextTicker ||
    parsed.issuerName ||
    tx.issuerContextIssuerName ||
    tx.resolvedIssuerName ||
    '';
  const coupon = parsed.coupon === null ? '' : trimNumber(parsed.coupon);
  const maturity = parsed.maturityDate ? formatShortDate(parsed.maturityDate) : '';
  return [issuer, coupon, maturity].filter(Boolean).join(' ').trim();
}

function openFigiCandidate(value: OpenFigiSearchResult): FixedIncomeIdentifierCandidate | null {
  if (!value.figi) return null;
  return {
    figi: value.figi,
    ticker: value.ticker || null,
    name: value.name || null,
    exchCode: value.exchCode || null,
    securityType: value.securityType || null,
    marketSector: value.marketSector || null,
    securityType2: value.securityType2 || null,
    securityDescription: value.securityDescription || null,
  };
}

function candidateCouponMatches(candidate: FixedIncomeIdentifierCandidate, expected: number): boolean {
  const text = candidateText(candidate);
  const values = extractCouponValues(text);
  return values.some((value) => Math.abs(value - expected) <= 0.015);
}

function candidateMaturityMatches(candidate: FixedIncomeIdentifierCandidate, expectedIsoDate: string): boolean {
  const text = candidateText(candidate);
  const dates = extractCandidateDates(text);
  return dates.includes(expectedIsoDate);
}

function issuerMatchesCandidate(issuer: string | null | undefined, candidate: FixedIncomeIdentifierCandidate): boolean {
  const issuerTokens = meaningfulTokens(issuer || '');
  if (issuerTokens.length === 0) return true;
  const candidateTokens = meaningfulTokens(`${candidate.name || ''} ${candidate.ticker || ''}`);
  const overlap = issuerTokens.filter((token) => candidateTokens.includes(token)).length;
  if (overlap >= Math.min(2, issuerTokens.length)) return true;
  if (issuerTokens.length === 1 && overlap === 1) return true;
  return false;
}

function applyRestrictedSecurityPreference(description: string, candidates: FixedIncomeIdentifierCandidate[]): FixedIncomeIdentifierCandidate[] {
  const normalized = normalizeSecurityDescription(description);
  const wantsRegS = /\b(REGS|REG S|REG\. S)\b/.test(normalized);
  const wants144A = /\b144A\b/.test(normalized);
  if (wantsRegS) return candidates.filter(isRegSCandidate);
  if (wants144A) return candidates.filter(is144ACandidate);

  const unrestricted = candidates.filter((candidate) => !isRegSCandidate(candidate) && !is144ACandidate(candidate));
  return unrestricted.length > 0 ? unrestricted : candidates;
}

function dedupeCandidates(candidates: FixedIncomeIdentifierCandidate[]): FixedIncomeIdentifierCandidate[] {
  const byFigi = new Map<string, FixedIncomeIdentifierCandidate>();
  for (const candidate of candidates) byFigi.set(candidate.figi, candidate);
  return Array.from(byFigi.values());
}

function matchConfidence(tx: OgeTransaction, candidate: FixedIncomeIdentifierCandidate): number {
  const parsed = parseInstrumentDescription(tx.description, tx.assetType);
  let confidence = 0.62;
  if (parsed.coupon !== null && candidateCouponMatches(candidate, parsed.coupon)) confidence += 0.12;
  if (parsed.maturityDate && candidateMaturityMatches(candidate, parsed.maturityDate)) confidence += 0.12;
  if (issuerMatchesCandidate(parsed.issuerName || tx.issuerContextIssuerName || tx.resolvedIssuerName, candidate)) confidence += 0.08;
  if (tx.issuerContextTicker && normalizeSecurityDescription(candidate.ticker || '').startsWith(tx.issuerContextTicker)) confidence += 0.04;
  return Math.min(0.92, Math.round(confidence * 100) / 100);
}

function candidateText(candidate: FixedIncomeIdentifierCandidate): string {
  return [candidate.ticker, candidate.securityDescription, candidate.name, candidate.securityType].filter(Boolean).join(' ');
}

function extractCouponValues(text: string): number[] {
  const values = new Set<number>();
  const normalized = text.replace(/(\d+)\s+(\d)\/(\d)/g, (_, whole, numerator, denominator) =>
    String(Number(whole) + Number(numerator) / Number(denominator))
  );
  for (const match of normalized.matchAll(/\b(\d{1,2}(?:\.\d{1,4})?)\b/g)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0 && value < 20) values.add(Math.round(value * 1000) / 1000);
  }
  return Array.from(values);
}

function extractCandidateDates(text: string): string[] {
  const dates = new Set<string>();
  for (const match of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g)) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    let year = Number(match[3]);
    if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) continue;
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    dates.add(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return Array.from(dates);
}

function isRegSCandidate(candidate: FixedIncomeIdentifierCandidate): boolean {
  const text = normalizeSecurityDescription(candidateText(candidate));
  return /\b(REGS|REG S)\b/.test(text) || normalizeSecurityDescription(candidate.securityType || '') === 'EURO DOLLAR';
}

function is144ACandidate(candidate: FixedIncomeIdentifierCandidate): boolean {
  const text = normalizeSecurityDescription(candidateText(candidate));
  return /\b144A\b/.test(text) || normalizeSecurityDescription(candidate.securityType || '') === 'PRIV PLACEMENT';
}

function meaningfulTokens(value: string): string[] {
  const stop = new Set(['INC', 'CORP', 'CORPORATION', 'LLC', 'LTD', 'CO', 'COMPANY', 'THE', 'BANK', 'BK', 'NATIONAL', 'ASSOCIATION']);
  return normalizeSecurityDescription(value)
    .split(/\s+/)
    .map((token) => ISSUER_TOKEN_ALIASES[token] || token)
    .filter((token) => token.length >= 2 && !stop.has(token));
}

function trimNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function formatShortDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${month}/${day}/${year.slice(2)}`;
}

function stableHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ISSUER_TOKEN_ALIASES: Record<string, string> = {
  HORIZON: 'HORIZON',
  TRANSN: 'TRANSPORTATION',
  TRANS: 'TRANSPORTATION',
  TRANSP: 'TRANSPORTATION',
  HEALT: 'HEALTH',
  HLTH: 'HEALTH',
  ST: 'STATE',
};
