import { normalizeSecurityDescription } from './classify';
import type { AssetType, InstrumentContextFields, SecurityReferenceEntry } from './types';

export interface ParsedInstrument {
  instrumentKind: string | null;
  issuerName: string | null;
  issuerSearchNames: string[];
  cusip: string | null;
  isin: string | null;
  figi: string | null;
  coupon: number | null;
  maturityDate: string | null;
  callable: boolean | null;
  callDate: string | null;
  callPrice: number | null;
  yieldToCall: number | null;
  yieldToMaturity: number | null;
  confidence: number;
  flags: string[];
}

export interface IssuerContextResolution {
  entry: SecurityReferenceEntry;
  source: 'sec-issuer-context' | 'nasdaq-issuer-context';
  confidence: number;
  flags: string[];
}

export function emptyInstrumentFields(): InstrumentContextFields {
  return {
    instrumentKind: null,
    instrumentIssuerName: null,
    instrumentCusip: null,
    instrumentIsin: null,
    instrumentFigi: null,
    instrumentCoupon: null,
    instrumentMaturityDate: null,
    instrumentCallable: null,
    instrumentCallDate: null,
    instrumentCallPrice: null,
    instrumentYieldToCall: null,
    instrumentYieldToMaturity: null,
    instrumentSummary: null,
    instrumentMatchSource: 'none',
    instrumentMatchConfidence: 0,
    instrumentContextFlags: [],
    issuerContextTicker: null,
    issuerContextIssuerName: null,
    issuerContextExchange: null,
    issuerContextCik: null,
    issuerContextSector: null,
    issuerContextSource: null,
    issuerContextConfidence: 0,
    issuerContextFlags: [],
  };
}

export function parseInstrumentDescription(description: string, assetType: AssetType): ParsedInstrument {
  const raw = description.toUpperCase();
  const normalized = normalizeSecurityDescription(description);
  const dueDate = parseDateMatch(raw.match(/\bDUE\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\b/)?.[1]);
  const maturityDate = dueDate || parseDateMatch(raw.match(/\bMATURITY\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\b/)?.[1]);
  const coupon = parseNumberMatch(raw.match(/\b(\d{1,2}\.\d{2,4})\s*%/)?.[1]);
  const callDate = parseDateMatch(raw.match(/\bCALLABLE\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\b/)?.[1]);
  const callPrice = parseNumberMatch(raw.match(/\bCALLABLE\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s+AT\s+(\d{1,3}(?:\.\d+)?)\b/)?.[1]);
  const yieldToCall = parseNumberMatch(raw.match(/\bYIELD\s+(\d{1,2}\.\d{2,4})\s*%\s+TO\s+PAR\s+CALL\b/)?.[1]);
  const yieldToMaturity = parseNumberMatch(raw.match(/\bYIELD\s+(\d{1,2}\.\d{2,4})\s*%\s+TO\s+MATURITY\b/)?.[1]);
  const cusip = raw.match(/\bCUSIP\s*([A-Z0-9]{9})\b/)?.[1] || null;
  const isin = raw.match(/\b([A-Z]{2}[A-Z0-9]{9}\d)\b/)?.[1] || null;
  const figi = raw.match(/\b(BBG[A-Z0-9]{9})\b/)?.[1] || null;
  const issuerName = cleanInstrumentIssuerName(extractIssuerStem(normalized));
  const hasInstrumentSignal = Boolean(
    maturityDate ||
    coupon !== null ||
    callDate ||
    cusip ||
    isin ||
    figi ||
    assetType === 'Corporate Bond' ||
    assetType === 'Municipal Bond' ||
    assetType === 'Preferred / Hybrid'
  );

  if (!hasInstrumentSignal) {
    return {
      instrumentKind: null,
      issuerName: null,
      issuerSearchNames: [],
      cusip,
      isin,
      figi,
      coupon,
      maturityDate,
      callable: callDate ? true : null,
      callDate,
      callPrice,
      yieldToCall,
      yieldToMaturity,
      confidence: 0,
      flags: [],
    };
  }

  const flags: string[] = [];
  if (!cusip && !isin && !figi && (assetType === 'Corporate Bond' || assetType === 'Municipal Bond')) {
    flags.push('No CUSIP/ISIN parsed');
  }
  if (!issuerName) flags.push('Instrument issuer needs review');

  return {
    instrumentKind: instrumentKind(assetType),
    issuerName,
    issuerSearchNames: issuerSearchNames(issuerName),
    cusip,
    isin,
    figi,
    coupon,
    maturityDate,
    callable: callDate ? true : normalized.includes(' CALLABLE ') ? true : null,
    callDate,
    callPrice,
    yieldToCall,
    yieldToMaturity,
    confidence: instrumentConfidence({ issuerName, maturityDate, coupon, callDate, cusip, isin, figi }),
    flags,
  };
}

export function buildInstrumentFields(
  parsed: ParsedInstrument,
  issuerContext: IssuerContextResolution | null
): InstrumentContextFields {
  const fields = emptyInstrumentFields();
  const hasInstrument = Boolean(parsed.instrumentKind || parsed.issuerName || parsed.maturityDate || parsed.coupon !== null);
  if (!hasInstrument) return fields;

  const instrumentContextFlags = [...parsed.flags];
  const issuerContextFlags = issuerContext?.flags || [];

  return {
    instrumentKind: parsed.instrumentKind,
    instrumentIssuerName: parsed.issuerName,
    instrumentCusip: parsed.cusip,
    instrumentIsin: parsed.isin,
    instrumentFigi: parsed.figi,
    instrumentCoupon: parsed.coupon,
    instrumentMaturityDate: parsed.maturityDate,
    instrumentCallable: parsed.callable,
    instrumentCallDate: parsed.callDate,
    instrumentCallPrice: parsed.callPrice,
    instrumentYieldToCall: parsed.yieldToCall,
    instrumentYieldToMaturity: parsed.yieldToMaturity,
    instrumentSummary: buildInstrumentSummary(parsed, issuerContext),
    instrumentMatchSource: 'description-parser',
    instrumentMatchConfidence: parsed.confidence,
    instrumentContextFlags,
    issuerContextTicker: issuerContext?.entry.ticker || null,
    issuerContextIssuerName: issuerContext?.entry.issuerName || null,
    issuerContextExchange: issuerContext?.entry.exchange || null,
    issuerContextCik: issuerContext?.entry.cik || null,
    issuerContextSector: issuerContext?.entry.sector || null,
    issuerContextSource: issuerContext?.source || null,
    issuerContextConfidence: issuerContext?.confidence || 0,
    issuerContextFlags,
  };
}

export function pickInstrumentContextFields(
  primary?: Partial<InstrumentContextFields> | null,
  fallback?: Partial<InstrumentContextFields> | null
): InstrumentContextFields {
  const empty = emptyInstrumentFields();
  return {
    instrumentKind: first(primary?.instrumentKind, fallback?.instrumentKind, empty.instrumentKind),
    instrumentIssuerName: first(primary?.instrumentIssuerName, fallback?.instrumentIssuerName, empty.instrumentIssuerName),
    instrumentCusip: first(primary?.instrumentCusip, fallback?.instrumentCusip, empty.instrumentCusip),
    instrumentIsin: first(primary?.instrumentIsin, fallback?.instrumentIsin, empty.instrumentIsin),
    instrumentFigi: first(primary?.instrumentFigi, fallback?.instrumentFigi, empty.instrumentFigi),
    instrumentCoupon: first(primary?.instrumentCoupon, fallback?.instrumentCoupon, empty.instrumentCoupon),
    instrumentMaturityDate: first(primary?.instrumentMaturityDate, fallback?.instrumentMaturityDate, empty.instrumentMaturityDate),
    instrumentCallable: first(primary?.instrumentCallable, fallback?.instrumentCallable, empty.instrumentCallable),
    instrumentCallDate: first(primary?.instrumentCallDate, fallback?.instrumentCallDate, empty.instrumentCallDate),
    instrumentCallPrice: first(primary?.instrumentCallPrice, fallback?.instrumentCallPrice, empty.instrumentCallPrice),
    instrumentYieldToCall: first(primary?.instrumentYieldToCall, fallback?.instrumentYieldToCall, empty.instrumentYieldToCall),
    instrumentYieldToMaturity: first(primary?.instrumentYieldToMaturity, fallback?.instrumentYieldToMaturity, empty.instrumentYieldToMaturity),
    instrumentSummary: first(primary?.instrumentSummary, fallback?.instrumentSummary, empty.instrumentSummary),
    instrumentMatchSource: first(primary?.instrumentMatchSource, fallback?.instrumentMatchSource, empty.instrumentMatchSource),
    instrumentMatchConfidence: Math.max(primary?.instrumentMatchConfidence || 0, fallback?.instrumentMatchConfidence || 0),
    instrumentContextFlags: unique([...(primary?.instrumentContextFlags || []), ...(fallback?.instrumentContextFlags || [])]),
    issuerContextTicker: first(primary?.issuerContextTicker, fallback?.issuerContextTicker, empty.issuerContextTicker),
    issuerContextIssuerName: first(primary?.issuerContextIssuerName, fallback?.issuerContextIssuerName, empty.issuerContextIssuerName),
    issuerContextExchange: first(primary?.issuerContextExchange, fallback?.issuerContextExchange, empty.issuerContextExchange),
    issuerContextCik: first(primary?.issuerContextCik, fallback?.issuerContextCik, empty.issuerContextCik),
    issuerContextSector: first(primary?.issuerContextSector, fallback?.issuerContextSector, empty.issuerContextSector),
    issuerContextSource: first(primary?.issuerContextSource, fallback?.issuerContextSource, empty.issuerContextSource),
    issuerContextConfidence: Math.max(primary?.issuerContextConfidence || 0, fallback?.issuerContextConfidence || 0),
    issuerContextFlags: unique([...(primary?.issuerContextFlags || []), ...(fallback?.issuerContextFlags || [])]),
  };
}

function buildInstrumentSummary(parsed: ParsedInstrument, issuerContext: IssuerContextResolution | null): string {
  const issuer = issuerContext?.entry.issuerName || titleCase(parsed.issuerName || '');
  const facts: string[] = [];
  if (parsed.coupon !== null) facts.push(`${formatNumber(parsed.coupon, 3)}% coupon`);
  if (parsed.maturityDate) facts.push(`due ${formatIsoDate(parsed.maturityDate)}`);
  if (parsed.callable) {
    const callBits = ['callable'];
    if (parsed.callDate) callBits.push(formatIsoDate(parsed.callDate));
    if (parsed.callPrice !== null) callBits.push(`at ${formatNumber(parsed.callPrice, 3)}`);
    facts.push(callBits.join(' '));
  }
  if (parsed.yieldToCall !== null) facts.push(`${formatNumber(parsed.yieldToCall, 3)}% yield to call`);
  if (parsed.yieldToMaturity !== null) facts.push(`${formatNumber(parsed.yieldToMaturity, 3)}% yield to maturity`);
  if (parsed.cusip) facts.push(`CUSIP ${parsed.cusip}`);
  if (parsed.isin) facts.push(`ISIN ${parsed.isin}`);

  const subject = [issuer, parsed.instrumentKind].filter(Boolean).join(' ') || parsed.instrumentKind || 'Instrument';
  const context = issuerContext
    ? ` Issuer context: ${issuerContext.entry.ticker}${issuerContext.entry.exchange ? ` on ${issuerContext.entry.exchange}` : ''}${issuerContext.entry.sector ? `, ${issuerContext.entry.sector}` : ''}; not a direct bond identifier.`
    : '';
  return `${subject}${facts.length > 0 ? ` (${facts.join('; ')})` : ''}.${context}`.replace(/\s+/g, ' ').trim();
}

function extractIssuerStem(normalized: string): string {
  return normalized
    .replace(/\b(CUSIP|FIGI|ISIN)\b.*$/g, ' ')
    .replace(/\b(DUE|DTD|MATURITY)\b.*$/g, ' ')
    .replace(/\b\d{1,2}\.\d{2,4}\s*%.*$/g, ' ')
    .replace(/\b(DISCRETIONARY ORDER|CONFIRMATION|PURSUANT TO REG S)\b.*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanInstrumentIssuerName(value: string): string | null {
  if (!value) return null;
  let tokens = normalizeSecurityDescription(value)
    .split(/\s+/)
    .map((token) => ISSUER_ALIASES[token] || token)
    .filter(Boolean);

  while (tokens.length > 1 && TRAILING_LOCATION_TOKENS.has(tokens[tokens.length - 1])) tokens = tokens.slice(0, -1);
  while (tokens.length > 1 && TRAILING_LOCATION_TOKENS.has(tokens[tokens.length - 1])) tokens = tokens.slice(0, -1);

  return tokens.join(' ').replace(/\s+/g, ' ').trim() || null;
}

function issuerSearchNames(issuerName: string | null): string[] {
  if (!issuerName) return [];
  const names = new Set<string>([issuerName]);
  const withoutBankingSuffix = issuerName
    .replace(/\b(NATIONAL ASSOCIATION|N A|NA|BANK|BK|TRUST|TR)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (withoutBankingSuffix.length >= 4) names.add(withoutBankingSuffix);
  const firstTwo = issuerName.split(/\s+/).slice(0, 2).join(' ');
  if (firstTwo.length >= 4) names.add(firstTwo);
  return Array.from(names);
}

function instrumentKind(assetType: AssetType): string | null {
  if (assetType === 'Corporate Bond') return 'corporate bond/note';
  if (assetType === 'Municipal Bond') return 'municipal bond';
  if (assetType === 'Preferred / Hybrid') return 'preferred/hybrid security';
  if (assetType === 'ETF / Fund') return 'fund/ETF';
  return null;
}

function instrumentConfidence(parsed: {
  issuerName: string | null;
  maturityDate: string | null;
  coupon: number | null;
  callDate: string | null;
  cusip: string | null;
  isin: string | null;
  figi: string | null;
}): number {
  let confidence = 0.52;
  if (parsed.issuerName) confidence += 0.12;
  if (parsed.coupon !== null) confidence += 0.1;
  if (parsed.maturityDate) confidence += 0.1;
  if (parsed.callDate) confidence += 0.04;
  if (parsed.cusip || parsed.isin || parsed.figi) confidence += 0.14;
  return Math.min(0.92, Math.round(confidence * 100) / 100);
}

function parseDateMatch(value: string | undefined): string | null {
  if (!value) return null;
  const [monthRaw, dayRaw, yearRaw] = value.split('/');
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  let year = Number(yearRaw);
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return null;
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseNumberMatch(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatIsoDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return value;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatNumber(value: number, maxDigits: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDigits,
  });
}

function first<T>(...values: Array<T | null | undefined>): T {
  return values.find((value) => value !== null && value !== undefined) as T;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (word.length <= 2) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

const ISSUER_ALIASES: Record<string, string> = {
  BANC: 'BANK',
  BK: 'BANK',
  CO: 'COMPANY',
  CORP: 'CORPORATION',
  HLDG: 'HOLDINGS',
  HLDGS: 'HOLDINGS',
  NATL: 'NATIONAL',
  NA: 'NATIONAL ASSOCIATION',
  N: 'NATIONAL',
  TR: 'TRUST',
};

const TRAILING_LOCATION_TOKENS = new Set([
  'ALA',
  'ALABAMA',
  'ARIZ',
  'ARIZONA',
  'ARK',
  'ARKANSAS',
  'ATLANTA',
  'BOSTON',
  'CALIF',
  'CALIFORNIA',
  'CHARLOTTE',
  'CHICAGO',
  'COLO',
  'COLORADO',
  'CONN',
  'CONNECTICUT',
  'DALLAS',
  'DEL',
  'DELAWARE',
  'FLA',
  'FLORIDA',
  'GA',
  'GEORGIA',
  'HOUSTON',
  'ILL',
  'ILLINOIS',
  'IND',
  'INDIANA',
  'IOWA',
  'KAN',
  'KANSAS',
  'KY',
  'KENTUCKY',
  'LA',
  'LOUISIANA',
  'MASS',
  'MASSACHUSETTS',
  'MEMPHIS',
  'MICH',
  'MICHIGAN',
  'MINN',
  'MINNESOTA',
  'MISS',
  'MISSISSIPPI',
  'MO',
  'MISSOURI',
  'NASHVILLE',
  'NC',
  'NEW',
  'NJ',
  'NY',
  'OHIO',
  'OKLA',
  'ORE',
  'PA',
  'PENN',
  'PENNSYLVANIA',
  'TENN',
  'TENNESSEE',
  'TEX',
  'TEXAS',
  'UTAH',
  'VA',
  'VIRGINIA',
  'WASH',
  'WIS',
  'WISCONSIN',
]);
