import { buildSecurityKey, normalizeSecurityDescription } from './classify';
import type {
  InstrumentIdentity,
  InstrumentReferenceStatus,
  InstrumentReviewStatus,
  SourceReliability,
  TrumpIndexEntry,
} from './types';

export function buildInstrumentIdentities(entries: TrumpIndexEntry[]): InstrumentIdentity[] {
  const byKey = new Map<string, InstrumentIdentity>();

  for (const entry of entries) {
    const identity = identityFromEntry(entry);
    if (!identity) continue;
    const existing = byKey.get(identity.id);
    if (!existing) {
      byKey.set(identity.id, identity);
      continue;
    }
    byKey.set(identity.id, mergeIdentity(existing, identity));
  }

  return Array.from(byKey.values())
    .map((identity) => ({
      ...identity,
      sourceEntryIds: unique(identity.sourceEntryIds),
      sourceUrls: unique(identity.sourceUrls),
      reviewReason: identityReviewReason(identity),
      reviewPriority: identityReviewPriority(identity),
    }))
    .sort((a, b) =>
      b.reviewPriority - a.reviewPriority ||
      b.score - a.score ||
      b.currentMidpoint - a.currentMidpoint ||
      a.displayName.localeCompare(b.displayName)
    );
}

export function buildIdentifierReviewItems(identities: InstrumentIdentity[]): InstrumentIdentity[] {
  return identities
    .filter((identity) => identity.referenceStatus === 'needs_identifier' || identity.reviewStatus === 'needs_review')
    .sort((a, b) =>
      b.reviewPriority - a.reviewPriority ||
      b.score - a.score ||
      b.currentMidpoint - a.currentMidpoint ||
      a.displayName.localeCompare(b.displayName)
    );
}

export function isGenericInstrumentSearchUrl(url: string | null | undefined): boolean {
  const value = String(url || '').toLowerCase();
  return value.includes('openfigi.com/search') ||
    /emma\.msrb\.org\/search/i.test(value) ||
    /api\.openfigi\.com\/v3\/mapping\/(id_|ticker|cusip|isin|bbg)/i.test(value);
}

function identityFromEntry(entry: TrumpIndexEntry): InstrumentIdentity | null {
  const hasInstrumentIdentity = Boolean(
    entry.instrumentKind ||
    entry.instrumentCusip ||
    entry.instrumentIsin ||
    entry.instrumentFigi ||
    entry.instrumentReferenceUrl ||
    entry.issuerContextTicker
  );
  if (!hasInstrumentIdentity) return null;

  const referenceStatus = normalizedReferenceStatus(entry.instrumentReferenceStatus, entry);
  const sourceUrls = unique(entry.citations.map((citation) => citation.sourceUrl).filter((url): url is string => Boolean(url)));
  const evidenceSourceUrl = entry.instrumentEvidenceSourceUrl || sourceUrls[0] || entry.instrumentReferenceUrl || null;
  const id = stableId(`instrument-identity|${identityKey(entry)}`);

  return {
    id,
    displayName: entry.displayName,
    assetType: entry.assetType,
    sector: entry.sector,
    referenceStatus,
    reviewStatus: normalizedReviewStatus(entry.instrumentReviewStatus, referenceStatus),
    cusip: entry.instrumentCusip,
    isin: entry.instrumentIsin,
    figi: entry.instrumentFigi,
    instrumentReferenceLabel: entry.instrumentReferenceLabel,
    instrumentReferenceSource: entry.instrumentReferenceSource,
    instrumentReferenceUrl: isGenericInstrumentSearchUrl(entry.instrumentReferenceUrl) ? null : entry.instrumentReferenceUrl,
    evidenceSourceUrl,
    evidenceNote: entry.instrumentEvidenceNote || entry.instrumentSummary || null,
    parsedIssuerName: entry.instrumentIssuerName || entry.issuerContextIssuerName || entry.resolvedIssuerName,
    coupon: entry.instrumentCoupon,
    maturityDate: entry.instrumentMaturityDate,
    issuerState: entry.instrumentIssuerState,
    issuerCategory: entry.instrumentIssuerCategory,
    sourceEntryIds: [entry.id],
    sourceUrls,
    score: entry.score,
    currentMidpoint: entry.currentMidpoint,
    transactionCount: entry.transactionCount,
    filingCount: entry.filingCount,
    sourceReliability: entry.sourceReliability,
    reviewPriority: 0,
    reviewReason: '',
    reviewerNotes: null,
  };
}

function mergeIdentity(left: InstrumentIdentity, right: InstrumentIdentity): InstrumentIdentity {
  const referenceStatus = strongestReferenceStatus(left.referenceStatus, right.referenceStatus);
  return {
    ...left,
    displayName: left.score >= right.score ? left.displayName : right.displayName,
    sector: left.currentMidpoint >= right.currentMidpoint ? left.sector : right.sector,
    referenceStatus,
    reviewStatus: strongestReviewStatus(left.reviewStatus, right.reviewStatus),
    cusip: left.cusip || right.cusip,
    isin: left.isin || right.isin,
    figi: left.figi || right.figi,
    instrumentReferenceLabel: left.instrumentReferenceLabel || right.instrumentReferenceLabel,
    instrumentReferenceSource: left.instrumentReferenceSource || right.instrumentReferenceSource,
    instrumentReferenceUrl: left.instrumentReferenceUrl || right.instrumentReferenceUrl,
    evidenceSourceUrl: left.evidenceSourceUrl || right.evidenceSourceUrl,
    evidenceNote: left.evidenceNote || right.evidenceNote,
    parsedIssuerName: left.parsedIssuerName || right.parsedIssuerName,
    coupon: left.coupon ?? right.coupon,
    maturityDate: left.maturityDate || right.maturityDate,
    issuerState: left.issuerState || right.issuerState,
    issuerCategory: left.issuerCategory || right.issuerCategory,
    sourceEntryIds: [...left.sourceEntryIds, ...right.sourceEntryIds],
    sourceUrls: [...left.sourceUrls, ...right.sourceUrls],
    score: Math.max(left.score, right.score),
    currentMidpoint: left.currentMidpoint + right.currentMidpoint,
    transactionCount: left.transactionCount + right.transactionCount,
    filingCount: Math.max(left.filingCount, right.filingCount),
    sourceReliability: strongestReliability([left.sourceReliability, right.sourceReliability]),
  };
}

function identityKey(entry: TrumpIndexEntry): string {
  if (entry.instrumentCusip) return `cusip|${entry.instrumentCusip}`;
  if (entry.instrumentIsin) return `isin|${entry.instrumentIsin}`;
  if (entry.instrumentFigi) return `figi|${entry.instrumentFigi}`;
  if (entry.resolvedTicker) return `ticker|${entry.resolvedTicker}`;
  if (entry.issuerContextTicker && !entry.instrumentKind) return `issuer-context|${entry.issuerContextTicker}`;
  return [
    'parsed',
    entry.assetType,
    normalizeSecurityDescription(entry.instrumentIssuerName || entry.displayName),
    entry.instrumentCoupon ?? '',
    entry.instrumentMaturityDate || '',
    buildSecurityKey(entry.displayName),
  ].join('|');
}

function normalizedReferenceStatus(
  status: InstrumentReferenceStatus,
  entry: TrumpIndexEntry
): InstrumentReferenceStatus {
  if (entry.instrumentCusip || entry.instrumentIsin || entry.instrumentFigi) return 'exact';
  if (entry.instrumentKind === 'corporate bond/note' || entry.instrumentKind === 'municipal bond' || entry.instrumentKind === 'preferred/hybrid security') {
    return 'needs_identifier';
  }
  if (entry.issuerContextTicker) return 'issuer_context_only';
  return status || 'not_applicable';
}

function normalizedReviewStatus(status: InstrumentReviewStatus, referenceStatus: InstrumentReferenceStatus): InstrumentReviewStatus {
  if (status === 'rejected') return 'rejected';
  if (referenceStatus === 'needs_identifier') return 'needs_review';
  return status || (referenceStatus === 'exact' ? 'needs_review' : 'verified');
}

function identityReviewReason(identity: InstrumentIdentity): string {
  if (identity.referenceStatus === 'needs_identifier') {
    return 'Needs CUSIP, ISIN, or FIGI before an exact instrument page can be cited.';
  }
  if (identity.reviewStatus === 'needs_review') {
    return 'Identifier or evidence should be reviewed before publication use.';
  }
  if (identity.referenceStatus === 'issuer_context_only') {
    return 'Only issuer context is available; this is not a direct instrument identifier.';
  }
  return 'Verified exact instrument evidence available.';
}

function identityReviewPriority(identity: InstrumentIdentity): number {
  const exposure = Math.log1p(Math.max(0, identity.currentMidpoint)) * 4;
  const activity = Math.log1p(Math.max(0, identity.transactionCount)) * 8;
  const statusBoost = identity.referenceStatus === 'needs_identifier'
    ? 45
    : identity.reviewStatus === 'needs_review'
      ? 25
      : 0;
  const reliabilityBoost = identity.sourceReliability === 'metadata_only' ? 15 : identity.sourceReliability === 'archived_copy' ? 8 : 0;
  return Math.round((statusBoost + reliabilityBoost + exposure + activity + identity.score) * 10) / 10;
}

function strongestReferenceStatus(...statuses: InstrumentReferenceStatus[]): InstrumentReferenceStatus {
  const order: InstrumentReferenceStatus[] = ['not_applicable', 'issuer_context_only', 'needs_identifier', 'exact'];
  return statuses.reduce((best, status) => order.indexOf(status) > order.indexOf(best) ? status : best, 'not_applicable');
}

function strongestReviewStatus(...statuses: InstrumentReviewStatus[]): InstrumentReviewStatus {
  if (statuses.includes('rejected')) return 'rejected';
  if (statuses.includes('needs_review')) return 'needs_review';
  return 'verified';
}

function strongestReliability(values: SourceReliability[]): SourceReliability {
  if (values.includes('official')) return 'official';
  if (values.includes('archived_copy')) return 'archived_copy';
  return 'metadata_only';
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function stableId(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
