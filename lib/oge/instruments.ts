import { normalizeSecurityDescription } from './classify';
import type { AssetType, InstrumentContextFields, InstrumentReferenceStatus, InstrumentReviewStatus, SecurityReferenceEntry } from './types';

export interface ParsedInstrument {
  description: string;
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
  issuerState: string | null;
  issuerCategory: string | null;
  confidence: number;
  flags: string[];
}

interface InstrumentIdentifierOverride {
  normalizedDescription: string;
  cusip: string;
  isin: string | null;
  figi: string | null;
  sourceUrl: string | null;
  sourceNote: string;
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
    instrumentIssuerState: null,
    instrumentIssuerCategory: null,
    instrumentReferenceLabel: null,
    instrumentReferenceSource: null,
    instrumentReferenceUrl: null,
    instrumentReferenceStatus: 'not_applicable',
    instrumentEvidenceSourceUrl: null,
    instrumentEvidenceNote: null,
    instrumentReviewStatus: 'verified',
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
  const coupon = parseNumberMatch(raw.match(/\b(\d{1,2}(?:\.\d{1,4})?)\s*%/)?.[1]);
  const callDate = parseDateMatch(raw.match(/\bCALLABLE\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\b/)?.[1]);
  const callPrice = parseNumberMatch(raw.match(/\bCALLABLE\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s+AT\s+(\d{1,3}(?:\.\d+)?)\b/)?.[1]);
  const yieldToCall = parseNumberMatch(raw.match(/\bYIELD\s+(\d{1,2}\.\d{2,4})\s*%\s+TO\s+PAR\s+CALL\b/)?.[1]);
  const yieldToMaturity = parseNumberMatch(raw.match(/\bYIELD\s+(\d{1,2}\.\d{2,4})\s*%\s+TO\s+MATURITY\b/)?.[1]);
  let cusip = raw.match(/\bCUSIP\s*([A-Z0-9]{9})\b/)?.[1] || null;
  let isin = raw.match(/\b([A-Z]{2}[A-Z0-9]{9}\d)\b/)?.[1] || null;
  let figi = raw.match(/\b(BBG[A-Z0-9]{9})\b/)?.[1] || null;
  const issuerName = cleanInstrumentIssuerName(extractIssuerStem(normalized));
  const issuerState = assetType === 'Municipal Bond' ? inferMunicipalState(issuerName) : null;
  const issuerCategory = assetType === 'Municipal Bond' ? inferMunicipalIssuerCategory(issuerName) : null;
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
      description,
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
      issuerState,
      issuerCategory,
      confidence: 0,
      flags: [],
    };
  }

  const flags: string[] = [];
  const identifierOverride = findInstrumentIdentifierOverride(normalized);
  if (identifierOverride) {
    cusip ||= identifierOverride.cusip;
    isin ||= identifierOverride.isin;
    figi ||= identifierOverride.figi;
    flags.push(identifierOverride.sourceNote);
  }
  if (!cusip && !isin && !figi && (assetType === 'Corporate Bond' || assetType === 'Municipal Bond')) {
    flags.push('No CUSIP/ISIN parsed');
  }
  if (!issuerName) flags.push('Instrument issuer needs review');

  return {
    description,
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
    issuerState,
    issuerCategory,
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
  const instrumentReference = buildInstrumentReference(parsed);
  const referenceStatus = instrumentReferenceStatus(parsed, issuerContext);
  const identifierOverride = findInstrumentIdentifierOverride(normalizeSecurityDescription(parsed.description));

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
    instrumentIssuerState: parsed.issuerState,
    instrumentIssuerCategory: parsed.issuerCategory,
    instrumentReferenceLabel: instrumentReference.label,
    instrumentReferenceSource: instrumentReference.source,
    instrumentReferenceUrl: instrumentReference.url,
    instrumentReferenceStatus: referenceStatus,
    instrumentEvidenceSourceUrl: identifierOverride?.sourceUrl || null,
    instrumentEvidenceNote: identifierOverride?.sourceNote || instrumentEvidenceNote(parsed, referenceStatus),
    instrumentReviewStatus: instrumentReviewStatus(parsed, referenceStatus, identifierOverride),
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
    instrumentIssuerState: first(primary?.instrumentIssuerState, fallback?.instrumentIssuerState, empty.instrumentIssuerState),
    instrumentIssuerCategory: first(primary?.instrumentIssuerCategory, fallback?.instrumentIssuerCategory, empty.instrumentIssuerCategory),
    instrumentReferenceLabel: first(primary?.instrumentReferenceLabel, fallback?.instrumentReferenceLabel, empty.instrumentReferenceLabel),
    instrumentReferenceSource: first(primary?.instrumentReferenceSource, fallback?.instrumentReferenceSource, empty.instrumentReferenceSource),
    instrumentReferenceUrl: first(primary?.instrumentReferenceUrl, fallback?.instrumentReferenceUrl, empty.instrumentReferenceUrl),
    instrumentReferenceStatus: strongestReferenceStatus(primary?.instrumentReferenceStatus, fallback?.instrumentReferenceStatus, empty.instrumentReferenceStatus),
    instrumentEvidenceSourceUrl: first(primary?.instrumentEvidenceSourceUrl, fallback?.instrumentEvidenceSourceUrl, empty.instrumentEvidenceSourceUrl),
    instrumentEvidenceNote: first(primary?.instrumentEvidenceNote, fallback?.instrumentEvidenceNote, empty.instrumentEvidenceNote),
    instrumentReviewStatus: strongestReviewStatus(primary?.instrumentReviewStatus, fallback?.instrumentReviewStatus, empty.instrumentReviewStatus),
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
  if (parsed.figi) facts.push(`FIGI ${parsed.figi}`);

  const subject = [issuer, parsed.instrumentKind].filter(Boolean).join(' ') || parsed.instrumentKind || 'Instrument';
  const contextParts: string[] = [];
  if (issuerContext) {
    contextParts.push(`Issuer context: ${issuerContext.entry.ticker}${issuerContext.entry.exchange ? ` on ${issuerContext.entry.exchange}` : ''}${issuerContext.entry.sector ? `, ${issuerContext.entry.sector}` : ''}; not a direct bond identifier.`);
  }
  if (parsed.instrumentKind === 'municipal bond' && parsed.cusip) {
    contextParts.push(`Public reference: MSRB EMMA municipal security details${parsed.issuerState ? `, ${parsed.issuerState}` : ''}${parsed.issuerCategory ? `, ${parsed.issuerCategory}` : ''}; not a ticker.`);
  } else if (isFixedIncomeKind(parsed.instrumentKind)) {
    contextParts.push(
      parsed.cusip || parsed.isin || parsed.figi
        ? 'Public reference: exact CUSIP/ISIN/FIGI-derived instrument link; not a ticker.'
        : 'Exact instrument link needs a CUSIP, ISIN, or FIGI; not a ticker.'
    );
  }
  return `${subject}${facts.length > 0 ? ` (${facts.join('; ')})` : ''}.${contextParts.length > 0 ? ` ${contextParts.join(' ')}` : ''}`.replace(/\s+/g, ' ').trim();
}

function extractIssuerStem(normalized: string): string {
  return normalized
    .replace(/\b(CUSIP|FIGI|ISIN)\b.*$/g, ' ')
    .replace(/\b(DUE|DTD|MATURITY)\b.*$/g, ' ')
    .replace(/\b\d{1,2}(?:\.\d{1,4})?\s*%.*$/g, ' ')
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

  tokens = normalizeMunicipalStateToken(tokens);

  while (tokens.length > 1 && TRAILING_LOCATION_TOKENS.has(tokens[tokens.length - 1])) tokens = tokens.slice(0, -1);
  while (tokens.length > 1 && TRAILING_LOCATION_TOKENS.has(tokens[tokens.length - 1])) tokens = tokens.slice(0, -1);

  return tokens.join(' ').replace(/\s+/g, ' ').trim() || null;
}

function buildInstrumentReference(parsed: ParsedInstrument): { label: string | null; source: string | null; url: string | null } {
  if (parsed.instrumentKind === 'municipal bond' && parsed.cusip) {
    return {
      label: `EMMA ${parsed.cusip}`,
      source: 'MSRB EMMA municipal security details',
      url: `https://emma.msrb.org/Security/Details/${encodeURIComponent(parsed.cusip)}`,
    };
  }

  if (parsed.figi) {
    return {
      label: `OpenFIGI ${parsed.figi}`,
      source: 'OpenFIGI exact FIGI identifier',
      url: null,
    };
  }

  if (parsed.cusip || parsed.isin) {
    const value = parsed.cusip || parsed.isin || '';
    return {
      label: `OpenFIGI ${value}`,
      source: 'OpenFIGI exact identifier candidate',
      url: null,
    };
  }

  return { label: null, source: null, url: null };
}

function isFixedIncomeKind(kind: string | null): boolean {
  return kind === 'corporate bond/note' || kind === 'municipal bond' || kind === 'preferred/hybrid security';
}

function instrumentReferenceStatus(
  parsed: ParsedInstrument,
  issuerContext: IssuerContextResolution | null
): InstrumentReferenceStatus {
  if (parsed.cusip || parsed.isin || parsed.figi) return 'exact';
  if (isFixedIncomeKind(parsed.instrumentKind)) return 'needs_identifier';
  if (issuerContext) return 'issuer_context_only';
  return 'not_applicable';
}

function instrumentReviewStatus(
  parsed: ParsedInstrument,
  referenceStatus: InstrumentReferenceStatus,
  override: InstrumentIdentifierOverride | null
): InstrumentReviewStatus {
  if (override) return 'verified';
  if (referenceStatus === 'exact' && parsed.instrumentKind === 'municipal bond' && parsed.cusip) return 'needs_review';
  if (referenceStatus === 'not_applicable') return 'verified';
  return 'needs_review';
}

function instrumentEvidenceNote(parsed: ParsedInstrument, referenceStatus: InstrumentReferenceStatus): string | null {
  if (referenceStatus === 'exact') {
    return 'Identifier parsed from OGE description; verify source row before publication.';
  }
  if (referenceStatus === 'needs_identifier') {
    return 'Fixed-income description lacks CUSIP, ISIN, or FIGI; exact instrument page cannot be linked yet.';
  }
  if (referenceStatus === 'issuer_context_only') {
    return 'Issuer context explains likely public-company issuer, not the direct instrument.';
  }
  if (parsed.instrumentKind) {
    return 'Instrument context parsed from OGE description.';
  }
  return null;
}

function strongestReferenceStatus(
  ...statuses: Array<InstrumentReferenceStatus | null | undefined>
): InstrumentReferenceStatus {
  const order: InstrumentReferenceStatus[] = ['not_applicable', 'issuer_context_only', 'needs_identifier', 'exact'];
  return statuses.reduce<InstrumentReferenceStatus>((best, status) =>
    order.indexOf(status || 'not_applicable') > order.indexOf(best) ? status || best : best,
  'not_applicable');
}

function strongestReviewStatus(
  ...statuses: Array<InstrumentReviewStatus | null | undefined>
): InstrumentReviewStatus {
  if (statuses.includes('rejected')) return 'rejected';
  if (statuses.includes('needs_review')) return 'needs_review';
  return 'verified';
}

function findInstrumentIdentifierOverride(normalizedDescription: string): InstrumentIdentifierOverride | null {
  return INSTRUMENT_IDENTIFIER_OVERRIDES.find((override) => override.normalizedDescription === normalizedDescription) || null;
}

function inferMunicipalState(issuerName: string | null): string | null {
  if (!issuerName) return null;
  const tokens = issuerName.split(/\s+/);
  for (const token of tokens) {
    const state = STATE_TOKEN_NAMES[token];
    if (state) return state;
  }
  return null;
}

function inferMunicipalIssuerCategory(issuerName: string | null): string | null {
  const normalized = normalizeSecurityDescription(issuerName || '');
  if (/\b(HEALTH|HOSPITAL|MEDICAL|CARE|FACILITIES)\b/.test(normalized)) return 'Health care / hospital';
  if (/\b(TRANSPORTATION|TRANSIT|TOLL|TURNPIKE|RAIL|RAILROAD|METROPOLITAN TRANSPORTATION)\b/.test(normalized)) return 'Transportation';
  if (/\b(UNIVERSITY|COLLEGE|SCHOOL|EDUCATION|EDUCATIONAL)\b/.test(normalized)) return 'Education';
  if (/\b(WATER|SEWER|SANITARY)\b/.test(normalized)) return 'Water / sewer';
  if (/\b(AIRPORT|PORT)\b/.test(normalized)) return 'Airport / port';
  if (/\b(HOUSING|MORTGAGE)\b/.test(normalized)) return 'Housing';
  if (/\b(POWER|ELECTRIC|UTILITY)\b/.test(normalized)) return 'Public power / utility';
  if (/\b(COUNTY|CITY|TOWN|VILLAGE)\b/.test(normalized)) return 'Local government';
  if (/\b(STATE|AUTHORITY|FINANCE|DEVELOPMENT|REVENUE)\b/.test(normalized)) return 'State / authority revenue';
  return null;
}

function normalizeMunicipalStateToken(tokens: string[]): string[] {
  return tokens.map((token, index) => {
    if (token === 'ST' && index > 0 && STATE_TOKEN_NAMES[tokens[index - 1]]) return 'STATE';
    return token;
  });
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
  CNTY: 'COUNTY',
  DEV: 'DEVELOPMENT',
  DIST: 'DISTRICT',
  EDL: 'EDUCATIONAL',
  FACS: 'FACILITIES',
  FIN: 'FINANCE',
  GOVT: 'GOVERNMENT',
  HEAL: 'HEALTH',
  HEALT: 'HEALTH',
  HLTH: 'HEALTH',
  HLDG: 'HOLDINGS',
  HLDGS: 'HOLDINGS',
  HOSP: 'HOSPITAL',
  IMPT: 'IMPROVEMENT',
  NATL: 'NATIONAL',
  NA: 'NATIONAL ASSOCIATION',
  N: 'NATIONAL',
  PUB: 'PUBLIC',
  REV: 'REVENUE',
  SCH: 'SCHOOL',
  TRANS: 'TRANSPORTATION',
  TRANSN: 'TRANSPORTATION',
  TRANSPRTN: 'TRANSPORTATION',
  TR: 'TRUST',
  UNIV: 'UNIVERSITY',
  WTR: 'WATER',
};

const STATE_TOKEN_NAMES: Record<string, string> = {
  ALA: 'Alabama',
  ALABAMA: 'Alabama',
  ALASKA: 'Alaska',
  ARIZ: 'Arizona',
  ARIZONA: 'Arizona',
  ARK: 'Arkansas',
  ARKANSAS: 'Arkansas',
  CALIF: 'California',
  CALIFORNIA: 'California',
  COLO: 'Colorado',
  COLORADO: 'Colorado',
  CONN: 'Connecticut',
  CONNECTICUT: 'Connecticut',
  DEL: 'Delaware',
  DELAWARE: 'Delaware',
  FLA: 'Florida',
  FLORIDA: 'Florida',
  GA: 'Georgia',
  GEORGIA: 'Georgia',
  HAWAII: 'Hawaii',
  IDAHO: 'Idaho',
  ILL: 'Illinois',
  ILLINOIS: 'Illinois',
  IND: 'Indiana',
  INDIANA: 'Indiana',
  IOWA: 'Iowa',
  KAN: 'Kansas',
  KANSAS: 'Kansas',
  KY: 'Kentucky',
  KENTUCKY: 'Kentucky',
  LA: 'Louisiana',
  LOUISIANA: 'Louisiana',
  MAINE: 'Maine',
  MD: 'Maryland',
  MARYLAND: 'Maryland',
  MASS: 'Massachusetts',
  MASSACHUSETTS: 'Massachusetts',
  MICH: 'Michigan',
  MICHIGAN: 'Michigan',
  MINN: 'Minnesota',
  MINNESOTA: 'Minnesota',
  MISS: 'Mississippi',
  MISSISSIPPI: 'Mississippi',
  MO: 'Missouri',
  MISSOURI: 'Missouri',
  MONT: 'Montana',
  MONTANA: 'Montana',
  NEB: 'Nebraska',
  NEBRASKA: 'Nebraska',
  NEV: 'Nevada',
  NEVADA: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  OHIO: 'Ohio',
  OKLA: 'Oklahoma',
  OREGON: 'Oregon',
  ORE: 'Oregon',
  PA: 'Pennsylvania',
  PENN: 'Pennsylvania',
  PENNSYLVANIA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TENN: 'Tennessee',
  TENNESSEE: 'Tennessee',
  TEX: 'Texas',
  TEXAS: 'Texas',
  UTAH: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  VIRGINIA: 'Virginia',
  WASH: 'Washington',
  WASHINGTON: 'Washington',
  WIS: 'Wisconsin',
  WISCONSIN: 'Wisconsin',
  WYO: 'Wyoming',
  WYOMING: 'Wyoming',
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

const INSTRUMENT_IDENTIFIER_OVERRIDES: InstrumentIdentifierOverride[] = [
  {
    normalizedDescription: 'METROPOLITAN TRANSN 5% DUE 11/15/35',
    cusip: '59261A6A0',
    isin: 'US59261A6A01',
    figi: 'BBG01XBJ54B6',
    sourceUrl: 'https://www.mta.info/document/185586',
    sourceNote: 'CUSIP/FIGI inferred from MTA Series 2025B official statement for the 5.00% Nov. 15, 2035 maturity',
  },
];
