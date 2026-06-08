import type { OgeTransaction, TrumpOgeFilters } from './types';

export function filterTransactions(transactions: OgeTransaction[], filters: TrumpOgeFilters): OgeTransaction[] {
  const query = filters.query?.trim().toLowerCase() || '';
  const minConfidence = filters.confidence ?? null;

  return transactions.filter((tx) => {
    if (filters.startDate && tx.date < filters.startDate) return false;
    if (filters.endDate && tx.date > filters.endDate) return false;
    if (filters.assetType && filters.assetType !== 'All' && tx.assetType !== filters.assetType) return false;
    if (filters.sector && filters.sector !== 'All' && tx.sector !== filters.sector) return false;
    if (filters.transactionType && filters.transactionType !== 'All' && tx.type !== filters.transactionType) return false;
    if (filters.lateOnly && !tx.lateFilingFlag) return false;
    if (minConfidence !== null && tx.classificationConfidence < minConfidence) return false;
    if (query) {
      const haystack = [
        tx.description,
        tx.ticker || '',
        tx.resolvedTicker || '',
        tx.resolvedIssuerName || '',
        tx.resolvedExchange || '',
        tx.resolvedCik ? String(tx.resolvedCik) : '',
        tx.resolvedSector || '',
        tx.sector,
        tx.assetType,
        ...tx.enrichmentFlags,
      ].join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export function filtersFromSearchParams(params: URLSearchParams): TrumpOgeFilters {
  return {
    startDate: clean(params.get('startDate')),
    endDate: clean(params.get('endDate')),
    assetType: clean(params.get('assetType')),
    sector: clean(params.get('sector')),
    transactionType: clean(params.get('transactionType')),
    lateOnly: params.get('lateOnly') === 'true',
    query: clean(params.get('query')),
    confidence: parseConfidence(params.get('confidence')),
  };
}

function clean(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function parseConfidence(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
