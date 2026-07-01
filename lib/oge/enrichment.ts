import { buildSecurityKey, normalizeSecurityDescription } from './classify';
import {
  buildInstrumentFields,
  emptyInstrumentFields,
  parseInstrumentDescription,
  type IssuerContextResolution,
  type ParsedInstrument,
} from './instruments';
import type {
  AssetType,
  EnrichmentSource,
  InstrumentContextFields,
  OgeTransaction,
  SecurityEnrichment,
  SecurityReferenceCache,
  SecurityReferenceEntry,
  SecurityReferenceSource,
} from './types';

export interface ParsedNasdaqSecurity {
  ticker: string;
  issuerName: string;
  exchange: string | null;
  isEtf: boolean;
  isTestIssue: boolean;
  source: 'Nasdaq Trader listed' | 'Nasdaq Trader other-listed';
}

interface CandidateMatch {
  entry: SecurityReferenceEntry;
  score: number;
  source: EnrichmentSource;
}

interface SecurityResolution {
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
  instrument: InstrumentContextFields;
}

const EQUITY_ACCEPTANCE_THRESHOLD = 0.78;
const NON_EQUITY_ACCEPTANCE_THRESHOLD = 0.75;
const CORPORATE_BOND_ACCEPTANCE_THRESHOLD = 0.72;
const MUNICIPAL_BOND_ACCEPTANCE_THRESHOLD = 0.70;
const AMBIGUITY_MARGIN = 0.10;

const EMPTY_REFERENCE_SOURCE: SecurityReferenceSource = {
  name: 'none',
  url: '',
  fetchedAt: new Date(0).toISOString(),
  rowCount: 0,
  status: 'failed',
  error: 'No security reference cache is available.',
};

export const EMPTY_SECURITY_REFERENCE: SecurityReferenceCache = {
  generatedAt: new Date(0).toISOString(),
  sources: [EMPTY_REFERENCE_SOURCE],
  entries: [],
  sicByCik: {},
};

export function emptyEnrichmentFields(): Pick<
  OgeTransaction,
  | 'resolvedTicker'
  | 'resolvedIssuerName'
  | 'resolvedExchange'
  | 'resolvedCik'
  | 'resolvedSector'
  | 'resolvedSic'
  | 'resolvedSicDescription'
  | 'enrichmentSource'
  | 'enrichmentConfidence'
  | 'enrichmentFlags'
> & InstrumentContextFields {
  return {
    resolvedTicker: null,
    resolvedIssuerName: null,
    resolvedExchange: null,
    resolvedCik: null,
    resolvedSector: null,
    resolvedSic: null,
    resolvedSicDescription: null,
    enrichmentSource: 'none',
    enrichmentConfidence: 0,
    enrichmentFlags: [],
    ...emptyInstrumentFields(),
  };
}

export function parseSecCompanyTickers(payload: unknown): SecurityReferenceEntry[] {
  const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
  const entries: SecurityReferenceEntry[] = [];
  for (const row of data) {
    if (!Array.isArray(row) || row.length < 4) continue;
      const [cikValue, nameValue, tickerValue, exchangeValue] = row;
      const ticker = normalizeTicker(String(tickerValue || ''));
      const issuerName = String(nameValue || '').trim();
      if (!ticker || !issuerName) continue;
      const cleanedName = normalizeIssuerName(issuerName);
      const cik = Number(cikValue);
      entries.push({
        ticker,
        tickerKey: tickerKey(ticker),
        issuerName,
        normalizedName: normalizeSecurityDescription(issuerName),
        cleanedName,
        compactName: compactName(cleanedName),
        exchange: normalizeExchangeName(String(exchangeValue || '')),
        cik: Number.isFinite(cik) ? cik : null,
        sic: null,
        sicDescription: null,
        sector: null,
        isEtf: false,
        isTestIssue: false,
        sources: ['SEC company_tickers_exchange.json'],
      });
  }
  return entries;
}

export function parseNasdaqSymbolDirectory(
  text: string,
  directory: 'nasdaq-listed' | 'other-listed'
): ParsedNasdaqSecurity[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headerLine = lines.find((line) => !line.startsWith('File Creation Time'));
  if (!headerLine) return [];
  const headers = headerLine.split('|');
  const rows = lines.slice(lines.indexOf(headerLine) + 1);

  return rows
    .map((line) => {
      if (line.startsWith('File Creation Time')) return null;
      const cells = line.split('|');
      const record = Object.fromEntries(headers.map((header, index) => [header, cells[index] || '']));
      const ticker = normalizeTicker(directory === 'nasdaq-listed' ? record.Symbol : record['ACT Symbol']);
      const issuerName = String(record['Security Name'] || '').trim();
      if (!ticker || !issuerName) return null;

      return {
        ticker,
        issuerName,
        exchange: directory === 'nasdaq-listed' ? 'Nasdaq' : exchangeCodeName(record.Exchange),
        isEtf: record.ETF === 'Y',
        isTestIssue: record['Test Issue'] === 'Y',
        source: directory === 'nasdaq-listed' ? 'Nasdaq Trader listed' : 'Nasdaq Trader other-listed',
      } satisfies ParsedNasdaqSecurity;
    })
    .filter((entry): entry is ParsedNasdaqSecurity => Boolean(entry));
}

export function buildSecurityReferenceCache(params: {
  generatedAt: string;
  secEntries: SecurityReferenceEntry[];
  nasdaqEntries: ParsedNasdaqSecurity[];
  sicByCik: SecurityReferenceCache['sicByCik'];
  sources: SecurityReferenceSource[];
}): SecurityReferenceCache {
  const byTicker = new Map<string, SecurityReferenceEntry>();

  for (const entry of params.secEntries) {
    byTicker.set(entry.tickerKey, applySic(entry, params.sicByCik));
  }

  for (const nasdaq of params.nasdaqEntries) {
    const key = tickerKey(nasdaq.ticker);
    const existing = byTicker.get(key);
    if (existing) {
      byTicker.set(key, {
        ...existing,
        exchange: existing.exchange || nasdaq.exchange,
        isEtf: existing.isEtf || nasdaq.isEtf,
        isTestIssue: existing.isTestIssue || nasdaq.isTestIssue,
        sources: Array.from(new Set([...existing.sources, nasdaq.source])),
      });
      continue;
    }

    const cleanedName = normalizeIssuerName(nasdaq.issuerName);
    byTicker.set(key, {
      ticker: nasdaq.ticker,
      tickerKey: key,
      issuerName: nasdaq.issuerName,
      normalizedName: normalizeSecurityDescription(nasdaq.issuerName),
      cleanedName,
      compactName: compactName(cleanedName),
      exchange: nasdaq.exchange,
      cik: null,
      sic: null,
      sicDescription: null,
      sector: nasdaq.isEtf ? 'ETF / Funds' : null,
      isEtf: nasdaq.isEtf,
      isTestIssue: nasdaq.isTestIssue,
      sources: [nasdaq.source],
    });
  }

  return {
    generatedAt: params.generatedAt,
    sources: params.sources,
    entries: Array.from(byTicker.values()).sort((a, b) => a.ticker.localeCompare(b.ticker)),
    sicByCik: params.sicByCik,
  };
}

export function broadSectorFromSic(sic: string | number | null, sicDescription: string | null): string | null {
  const code = Number(sic);
  const description = normalizeSecurityDescription(sicDescription || '');

  if (/\b(BANK|BANKS|BANKING|FINANCE|FINANCIAL|INSURANCE|INVESTMENT|BROKER|SECURITY BROKERS|CREDIT|LOAN|EXCHANGE)\b/.test(description)) return 'Financials';
  if (/\b(REAL ESTATE|REIT|LESSORS|PROPERTY|PROPERTIES|MORTGAGE)\b/.test(description)) return 'Real Estate';
  if (/\b(OIL|GAS|PETROLEUM|DRILLING|PIPELINE|ENERGY)\b/.test(description)) return 'Energy';
  if (/\b(ELECTRIC|UTILITY|UTILITIES|WATER SUPPLY|SANITARY|POWER GENERATION|NATURAL GAS TRANSMISSION)\b/.test(description)) return 'Utilities';
  if (/\b(PHARMACEUTICAL|BIOLOGICAL|BIOTECH|MEDICAL|HEALTH|HOSPITAL|SURGICAL|DIAGNOSTIC)\b/.test(description)) return 'Health Care';
  if (/\b(SOFTWARE|COMPUTER|SEMICONDUCTOR|ELECTRONIC COMPUTERS|DATA|INFORMATION RETRIEVAL|TECHNOLOGY)\b/.test(description)) return 'Information Technology';
  if (/\b(TELEPHONE|COMMUNICATIONS|CABLE|RADIO|TELEVISION|MOTION PICTURE|MEDIA|ADVERTISING)\b/.test(description)) return 'Communication Services';
  if (/\b(FOOD|BEVERAGE|GROCERY|TOBACCO|HOUSEHOLD|SOAP|AGRICULTURE)\b/.test(description)) return 'Consumer Staples';
  if (/\b(RETAIL|APPAREL|HOTEL|RESTAURANT|EATING PLACES|AUTO|AUTOMOBILE|CASINO|LEISURE|CONSUMER)\b/.test(description)) return 'Consumer Discretionary';
  if (/\b(CHEMICAL|MINING|METAL|STEEL|PAPER|LUMBER|PACKAGING|MATERIALS|PLASTICS)\b/.test(description)) return 'Materials';
  if (/\b(MACHINERY|AEROSPACE|TRANSPORTATION|TRUCKING|RAILROAD|AIRCRAFT|CONSTRUCTION|ENGINEERING|INDUSTRIAL)\b/.test(description)) return 'Industrials';

  if (!Number.isFinite(code)) return null;
  if (code >= 1000 && code <= 1499) return code >= 1300 && code <= 1399 ? 'Energy' : 'Materials';
  if (code >= 1500 && code <= 1799) return 'Industrials';
  if (code >= 2000 && code <= 2199) return 'Consumer Staples';
  if (code >= 2200 && code <= 2399) return 'Consumer Discretionary';
  if (code >= 2400 && code <= 2999) return 'Materials';
  if (code >= 3000 && code <= 3569) return 'Industrials';
  if (code >= 3570 && code <= 3679) return 'Information Technology';
  if (code >= 3710 && code <= 3799) return 'Industrials';
  if (code >= 3840 && code <= 3851) return 'Health Care';
  if (code >= 4810 && code <= 4899) return 'Communication Services';
  if (code >= 4910 && code <= 4999) return 'Utilities';
  if (code >= 5200 && code <= 5999) return 'Consumer Discretionary';
  if (code >= 6000 && code <= 6799) return 'Financials';
  if (code >= 7000 && code <= 8999) return 'Industrials';
  return null;
}

export function normalizeIssuerName(value: string): string {
  const base = normalizeSecurityDescription(value)
    .replace(/\b(CLASS|CL)\s+[A-Z0-9]+\b/g, ' ')
    .replace(/\b(COMMON STOCK|COMMON SHARES|COM STK|ORDINARY SHARES|ORD SHS|ORDS|SHARES|STOCK|EQUITY)\b/g, ' ')
    .replace(/\b(AMERICAN DEPOSITARY SHARES?|DEPOSITARY SHARES?|ADS|ADR|RIGHTS?|WARRANTS?|UNITS?)\b/g, ' ')
    .replace(/\b(REGS|REGISTERED|RESTRICTED|DISCRETIONARY ORDER|CONFIRMATION|PURSUANT TO REG S)\b.*$/g, ' ')
    .replace(/\b(DUE|DTD|CUSIP|NOTE|NT|BOND|DEBENTURE|SR UNSEC|CALLABLE)\b.*$/g, ' ')
    .replace(/\b\d{1,2}\.\d{2,3}%.*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = base
    .split(/\s+/)
    .map((token) => ISSUER_ALIASES[token] || token)
    .filter((token) => !ISSUER_SUFFIXES.has(token));

  while (tokens.length > 1 && /^[A-Z]$/.test(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  return tokens.join(' ').replace(/\s+/g, ' ').trim();
}

export function enrichTransactions(
  transactions: OgeTransaction[],
  reference: SecurityReferenceCache
): { transactions: OgeTransaction[]; securityEnrichments: SecurityEnrichment[] } {
  const resolver = createSecurityResolver(reference);
  const enrichmentGroups = new Map<string, SecurityEnrichment>();
  const enrichedTransactions = transactions.map((tx) => {
    const resolution = resolver.resolve(tx);
    const enriched = applyResolution(tx, resolution);
    const groupKey = `${resolution.securityKey}|${resolution.sourceTicker || ''}`;
    const existing = enrichmentGroups.get(groupKey);
    if (existing) {
      existing.transactionCount += 1;
      existing.assetTypes = Array.from(new Set([...existing.assetTypes, tx.assetType]));
    } else {
      enrichmentGroups.set(groupKey, {
        id: stableHash(`security-enrichment|${groupKey}`),
        securityKey: resolution.securityKey,
        description: tx.description,
        normalizedDescription: resolution.normalizedDescription,
        sourceTicker: resolution.sourceTicker,
        resolvedTicker: resolution.resolvedTicker,
        resolvedIssuerName: resolution.resolvedIssuerName,
        resolvedExchange: resolution.resolvedExchange,
        resolvedCik: resolution.resolvedCik,
        resolvedSector: resolution.resolvedSector,
        resolvedSic: resolution.resolvedSic,
        resolvedSicDescription: resolution.resolvedSicDescription,
        enrichmentSource: resolution.enrichmentSource,
        enrichmentConfidence: resolution.enrichmentConfidence,
        enrichmentFlags: resolution.enrichmentFlags,
        ...resolution.instrument,
        candidateTickers: resolution.candidateTickers,
        transactionCount: 1,
        assetTypes: [tx.assetType],
      });
    }
    return enriched;
  });

  return {
    transactions: enrichedTransactions,
    securityEnrichments: Array.from(enrichmentGroups.values()).sort((a, b) =>
      b.transactionCount - a.transactionCount ||
      (b.enrichmentConfidence || 0) - (a.enrichmentConfidence || 0) ||
      a.description.localeCompare(b.description)
    ),
  };
}

export function collectResolvedCiks(transactions: OgeTransaction[]): number[] {
  return Array.from(new Set(
    transactions
      .flatMap((tx) => [tx.resolvedCik, tx.issuerContextCik])
      .filter((cik): cik is number => Number.isFinite(cik))
  )).sort((a, b) => a - b);
}

export function createSecurityResolver(reference: SecurityReferenceCache) {
  const index = buildReferenceIndex(reference.entries);

  return {
    resolve(tx: Pick<OgeTransaction, 'description' | 'ticker' | 'assetType'>): SecurityResolution {
      const sourceTicker = normalizeTicker(tx.ticker || '');
      const securityKey = buildSecurityKey(tx.description);
      const normalizedDescription = normalizeSecurityDescription(tx.description);
      const parsedInstrument = parseInstrumentDescription(tx.description, tx.assetType);
      const candidates: CandidateMatch[] = [];

      if (sourceTicker) {
        for (const entry of index.byTickerKey.get(tickerKey(sourceTicker)) || []) {
          candidates.push({ entry, score: 1, source: entry.cik ? 'source-ticker' : 'nasdaq-ticker' });
        }
      }

      const variants = buildNameVariants(tx.description, parsedInstrument);
      for (const variant of variants) {
        addMatches(candidates, index.byNormalizedName.get(normalizeSecurityDescription(variant)), 0.96, sourceFor('exact'));
        addMatches(candidates, index.byCleanedName.get(normalizeIssuerName(variant)), 0.93, sourceFor('clean'));
        addMatches(candidates, index.byCompactName.get(compactName(normalizeIssuerName(variant))), 0.91, sourceFor('compact'));
      }

      const cleanedDescription = normalizeIssuerName(tx.description);
      if (cleanedDescription.length >= 4) {
        const firstToken = cleanedDescription.split(/\s+/)[0];
        for (const entry of index.byFirstToken.get(firstToken) || []) {
          const score = scoreIssuerSimilarity(cleanedDescription, entry.cleanedName);
          if (score >= 0.8) {
            candidates.push({ entry, score, source: entry.cik ? 'sec-fuzzy' : 'nasdaq-fuzzy' });
          }
        }
      }

      return chooseResolution({
        description: tx.description,
        securityKey,
        normalizedDescription,
        sourceTicker,
        candidates: rankCandidates(candidates, tx.assetType),
        assetType: tx.assetType,
        parsedInstrument,
      });
    },
  };
}

function applyResolution(tx: OgeTransaction, resolution: SecurityResolution): OgeTransaction {
  const useResolvedSector = shouldApplyResolvedSector(tx.assetType, resolution);
  const sector = useResolvedSector && resolution.resolvedSector ? resolution.resolvedSector : tx.sector;
  const reviewFlags = new Set(tx.reviewFlags);

  for (const flag of resolution.enrichmentFlags) {
    reviewFlags.add(flag);
  }

  if (useResolvedSector && sector !== 'Unclassified Equity') {
    reviewFlags.delete('Needs sector review');
  }

  const classificationConfidence = useResolvedSector
    ? Math.max(tx.classificationConfidence, Math.min(0.92, resolution.enrichmentConfidence))
    : tx.classificationConfidence;

  return {
    ...tx,
    resolvedTicker: resolution.resolvedTicker,
    resolvedIssuerName: resolution.resolvedIssuerName,
    resolvedExchange: resolution.resolvedExchange,
    resolvedCik: resolution.resolvedCik,
    resolvedSector: resolution.resolvedSector,
    resolvedSic: resolution.resolvedSic,
    resolvedSicDescription: resolution.resolvedSicDescription,
    enrichmentSource: resolution.enrichmentSource,
    enrichmentConfidence: resolution.enrichmentConfidence,
    enrichmentFlags: resolution.enrichmentFlags,
    ...resolution.instrument,
    sector,
    classificationConfidence,
    reviewFlags: Array.from(reviewFlags),
  };
}

function shouldApplyResolvedSector(assetType: AssetType, resolution: SecurityResolution): boolean {
  if (!resolution.resolvedSector || !resolution.resolvedTicker) return false;
  if (assetType === 'Municipal Bond' || assetType === 'ETF / Fund') return false;
  if (assetType === 'Equity') return resolution.enrichmentConfidence >= EQUITY_ACCEPTANCE_THRESHOLD;
  return resolution.enrichmentConfidence >= NON_EQUITY_ACCEPTANCE_THRESHOLD;
}

function chooseResolution(params: {
  description: string;
  securityKey: string;
  normalizedDescription: string;
  sourceTicker: string | null;
  candidates: CandidateMatch[];
  assetType: AssetType;
  parsedInstrument: ParsedInstrument;
}): SecurityResolution {
  const base = {
    securityKey: params.securityKey,
    description: params.description,
    normalizedDescription: params.normalizedDescription,
    sourceTicker: params.sourceTicker,
  };
  const top = params.candidates[0];
  const candidateTickers = params.candidates.slice(0, 5).map((candidate) => candidate.entry.ticker);
  const issuerContext = chooseIssuerContext(params.candidates, params.assetType);
  const instrument = buildInstrumentFields(params.parsedInstrument, issuerContext);

  if (!top) {
    return {
      ...base,
      ...emptyResolutionFields('none', 0),
      enrichmentFlags: params.assetType === 'Equity' ? ['No public match'] : [],
      candidateTickers: [],
      instrument,
    };
  }

  const second = params.candidates[1];
  const threshold = params.assetType === 'Equity' ? EQUITY_ACCEPTANCE_THRESHOLD : NON_EQUITY_ACCEPTANCE_THRESHOLD;
  const ambiguous = Boolean(second && top.score < 0.97 && top.score - second.score < AMBIGUITY_MARGIN);
  if (ambiguous) {
    return {
      ...base,
      ...emptyResolutionFields('none', top.score),
      enrichmentFlags: [
        'Multiple possible tickers',
        ...(issuerContext ? ['Issuer context only; not direct instrument ticker'] : []),
      ],
      candidateTickers,
      instrument,
    };
  }

  if (top.score < threshold) {
    return {
      ...base,
      ...emptyResolutionFields('none', top.score),
      enrichmentFlags: [
        'Low-confidence issuer match',
        ...(issuerContext ? ['Issuer context only; not direct instrument ticker'] : []),
      ],
      candidateTickers,
      instrument,
    };
  }

  // Allow direct resolution for all asset types when confidence is high enough
  // For bonds without source tickers, use issuer context instead of blocking
  const isHighConfidenceBond = (params.assetType === 'Corporate Bond' || params.assetType === 'Preferred / Hybrid') 
    && top.score >= CORPORATE_BOND_ACCEPTANCE_THRESHOLD;
  const isHighConfidenceMuni = params.assetType === 'Municipal Bond' && top.score >= MUNICIPAL_BOND_ACCEPTANCE_THRESHOLD;
  const directResolutionAllowed = params.assetType === 'Equity' 
    || params.assetType === 'ETF / Fund' 
    || Boolean(params.sourceTicker)
    || isHighConfidenceBond
    || isHighConfidenceMuni;
  
  if (!directResolutionAllowed) {
    // Still provide issuer context even when direct resolution is blocked
    return {
      ...base,
      ...emptyResolutionFields('none', top.score),
      enrichmentFlags: issuerContext 
        ? ['Issuer context only; not direct instrument ticker'] 
        : ['Bond/preferred without source ticker - issuer context used'],
      candidateTickers,
      instrument,
    };
  }

  const flags: string[] = [];
  if (top.score < 0.9) flags.push('Low-confidence issuer match');
  if (!top.entry.sector && top.entry.cik) flags.push('No SEC/SIC sector');

  return {
    ...base,
    resolvedTicker: top.entry.ticker,
    resolvedIssuerName: top.entry.issuerName,
    resolvedExchange: top.entry.exchange,
    resolvedCik: top.entry.cik,
    resolvedSector: top.entry.sector,
    resolvedSic: top.entry.sic,
    resolvedSicDescription: top.entry.sicDescription,
    enrichmentSource: top.source,
    enrichmentConfidence: top.score,
    enrichmentFlags: flags,
    candidateTickers,
    instrument,
  };
}

function emptyResolutionFields(source: EnrichmentSource, confidence: number) {
  return {
    resolvedTicker: null,
    resolvedIssuerName: null,
    resolvedExchange: null,
    resolvedCik: null,
    resolvedSector: null,
    resolvedSic: null,
    resolvedSicDescription: null,
    enrichmentSource: source,
    enrichmentConfidence: confidence,
  };
}

function buildReferenceIndex(entries: SecurityReferenceEntry[]) {
  const byTickerKey = new Map<string, SecurityReferenceEntry[]>();
  const byNormalizedName = new Map<string, SecurityReferenceEntry[]>();
  const byCleanedName = new Map<string, SecurityReferenceEntry[]>();
  const byCompactName = new Map<string, SecurityReferenceEntry[]>();
  const byFirstToken = new Map<string, SecurityReferenceEntry[]>();

  for (const entry of entries) {
    if (entry.isTestIssue) continue;
    addToIndex(byTickerKey, entry.tickerKey, entry);
    addToIndex(byNormalizedName, entry.normalizedName, entry);
    addToIndex(byCleanedName, entry.cleanedName, entry);
    addToIndex(byCompactName, entry.compactName, entry);
    const firstToken = entry.cleanedName.split(/\s+/)[0];
    if (firstToken) addToIndex(byFirstToken, firstToken, entry);
  }

  return { byTickerKey, byNormalizedName, byCleanedName, byCompactName, byFirstToken };
}

function addMatches(
  candidates: CandidateMatch[],
  entries: SecurityReferenceEntry[] | undefined,
  score: number,
  sourceFactory: (entry: SecurityReferenceEntry) => EnrichmentSource
) {
  for (const entry of entries || []) {
    candidates.push({ entry, score, source: sourceFactory(entry) });
  }
}

function sourceFor(kind: 'exact' | 'clean' | 'compact') {
  return (entry: SecurityReferenceEntry): EnrichmentSource => {
    if (entry.cik) {
      if (kind === 'exact') return 'sec-exact';
      if (kind === 'clean') return 'sec-clean';
      return 'sec-compact';
    }
    if (kind === 'exact') return 'nasdaq-exact';
    if (kind === 'clean') return 'nasdaq-clean';
    return 'nasdaq-compact';
  };
}

function rankCandidates(candidates: CandidateMatch[], assetType: AssetType): CandidateMatch[] {
  const bestByTicker = new Map<string, CandidateMatch>();
  for (const candidate of candidates) {
    if (!candidate.entry.tickerKey || candidate.entry.isTestIssue) continue;
    if (assetType === 'Equity' && candidate.entry.isEtf && !candidate.source.includes('ticker')) continue;
    if (assetType === 'ETF / Fund' && !candidate.source.includes('ticker')) continue;
    const existing = bestByTicker.get(candidate.entry.tickerKey);
    if (!existing || candidate.score > existing.score) {
      bestByTicker.set(candidate.entry.tickerKey, candidate);
    }
  }

  return Array.from(bestByTicker.values()).sort((a, b) =>
    b.score - a.score ||
    Number(Boolean(b.entry.cik)) - Number(Boolean(a.entry.cik)) ||
    Number(!a.entry.isEtf) - Number(!b.entry.isEtf) ||
    a.entry.ticker.localeCompare(b.entry.ticker)
  );
}

function buildNameVariants(description: string, parsedInstrument: ParsedInstrument): string[] {
  return Array.from(new Set([
    description,
    buildSecurityKey(description),
    normalizeIssuerName(description),
    parsedInstrument.issuerName || '',
    ...parsedInstrument.issuerSearchNames,
  ].filter(Boolean)));
}

function chooseIssuerContext(candidates: CandidateMatch[], assetType: AssetType): IssuerContextResolution | null {
  if (assetType === 'Equity') return null;
  const top = candidates[0];
  if (!top || top.score < 0.78) return null;
  const floor = Math.max(0.78, top.score - AMBIGUITY_MARGIN);
  const family = candidates.filter((candidate) => candidate.score >= floor && !candidate.entry.isTestIssue);
  const byCleanedName = new Map<string, CandidateMatch[]>();
  for (const candidate of family) {
    const rows = byCleanedName.get(candidate.entry.cleanedName) || [];
    rows.push(candidate);
    byCleanedName.set(candidate.entry.cleanedName, rows);
  }

  const groups = Array.from(byCleanedName.values()).sort((a, b) =>
    b[0].score - a[0].score ||
    b.length - a.length ||
    a[0].entry.cleanedName.localeCompare(b[0].entry.cleanedName)
  );
  const group = groups[0] || family;
  if (group.length === 0) return null;

  const commonCandidate = group.find((candidate) => isCommonIssuerCandidate(candidate.entry)) || group[0];
  const flags = ['Issuer context only; not direct instrument ticker'];
  if (group.length > 1) flags.push('Multiple issuer securities share this issuer name');
  if (!commonCandidate.entry.cik) flags.push('No SEC CIK for issuer context');

  return {
    entry: commonCandidate.entry,
    source: commonCandidate.entry.cik ? 'sec-issuer-context' : 'nasdaq-issuer-context',
    confidence: Math.min(0.9, commonCandidate.score),
    flags,
  };
}

function isCommonIssuerCandidate(entry: SecurityReferenceEntry): boolean {
  const text = `${entry.ticker} ${entry.issuerName}`.toUpperCase();
  if (entry.isEtf) return false;
  if (/\b(PFD|PREFERRED|DEPOSITARY|WARRANT|RIGHT|UNIT|NOTE|BOND|DEBT)\b/.test(text)) return false;
  if (/[-$]P[A-Z]?$/.test(entry.ticker.toUpperCase())) return false;
  return true;
}

function scoreIssuerSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 0.93;
  const leftCompact = compactName(left);
  const rightCompact = compactName(right);
  if (leftCompact === rightCompact) return 0.91;
  if (left.length >= 5 && right.length >= 5 && (left.includes(right) || right.includes(left))) {
    const shorter = Math.min(left.length, right.length);
    const longer = Math.max(left.length, right.length);
    return 0.84 + (shorter / longer) * 0.08;
  }

  const leftTokens = new Set(left.split(/\s+/));
  const rightTokens = new Set(right.split(/\s+/));
  const intersection = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const jaccard = union ? intersection / union : 0;
  const compactScore = normalizedEditSimilarity(leftCompact, rightCompact);
  return Math.max(jaccard, compactScore * 0.92);
}

function normalizedEditSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (Math.max(left.length, right.length) > 48) return 0;
  const distance = levenshtein(left, right);
  return 1 - distance / Math.max(left.length, right.length);
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function addToIndex(map: Map<string, SecurityReferenceEntry[]>, key: string, entry: SecurityReferenceEntry) {
  if (!key) return;
  const rows = map.get(key) || [];
  rows.push(entry);
  map.set(key, rows);
}

function applySic(entry: SecurityReferenceEntry, sicByCik: SecurityReferenceCache['sicByCik']): SecurityReferenceEntry {
  const sic = entry.cik ? sicByCik[String(entry.cik)] : null;
  if (!sic) return entry;
  return {
    ...entry,
    sic: sic.sic,
    sicDescription: sic.sicDescription,
    sector: sic.sector,
  };
}

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase();
}

function tickerKey(value: string): string {
  return normalizeTicker(value).replace(/[^A-Z0-9]/g, '');
}

function compactName(value: string): string {
  return value.replace(/[^A-Z0-9]/g, '');
}

function normalizeExchangeName(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function exchangeCodeName(value: string): string | null {
  const exchanges: Record<string, string> = {
    A: 'NYSE American',
    B: 'Nasdaq BX',
    C: 'NYSE National',
    I: 'IEX',
    J: 'Cboe EDGA',
    K: 'Cboe EDGX',
    M: 'NYSE Chicago',
    N: 'NYSE',
    P: 'NYSE Arca',
    Q: 'Nasdaq',
    V: 'IEX',
    X: 'Nasdaq PSX',
    Y: 'Cboe BYX',
    Z: 'Cboe BZX',
  };
  return exchanges[value] || value || null;
}

function stableHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const ISSUER_ALIASES: Record<string, string> = {
  BANC: 'BANK',
  BK: 'BANK',
  COS: 'COMPANIES',
  COSMETCS: 'COSMETICS',
  FINL: 'FINANCIAL',
  HLTH: 'HEALTH',
  HLDG: 'HOLDINGS',
  HLDGS: 'HOLDINGS',
  INDS: 'INDUSTRIES',
  INTL: 'INTERNATIONAL',
  LABS: 'LABORATORIES',
  PHARMA: 'PHARMACEUTICALS',
  PPTY: 'PROPERTIES',
  PPTYS: 'PROPERTIES',
  PTS: 'PARTS',
  RESH: 'RESEARCH',
  RLTY: 'REALTY',
  SVCS: 'SERVICES',
  TECH: 'TECHNOLOGY',
  TECHS: 'TECHNOLOGIES',
};

const ISSUER_SUFFIXES = new Set([
  'AB',
  'AG',
  'BV',
  'CO',
  'COMPANY',
  'CORP',
  'CORPORATION',
  'DEL',
  'F',
  'GMBH',
  'GROUP',
  'HOLDING',
  'HOLDINGS',
  'INC',
  'INCORPORATED',
  'L',
  'LIMITED',
  'LLC',
  'LP',
  'LTD',
  'NEW',
  'NV',
  'PLC',
  'REIT',
  'SA',
  'SE',
  'THE',
  'TR',
  'TRUST',
]);
