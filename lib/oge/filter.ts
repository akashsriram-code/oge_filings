import type { OgeTransaction, TrumpOgeFilters } from './types';

export function filterTransactions(transactions: OgeTransaction[], filters: TrumpOgeFilters): OgeTransaction[] {
  const query = filters.query?.trim().toLowerCase() || '';
  const minConfidence = filters.confidence ?? null;

  return transactions.filter((tx) => {
    if (filters.year && String(filters.year) !== 'All' && !tx.date.startsWith(String(filters.year))) return false;
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
        tx.issuerContextTicker || '',
        tx.resolvedIssuerName || '',
        tx.issuerContextIssuerName || '',
        tx.instrumentIssuerName || '',
        tx.instrumentSummary || '',
        tx.resolvedExchange || '',
        tx.issuerContextExchange || '',
        tx.resolvedCik ? String(tx.resolvedCik) : '',
        tx.issuerContextCik ? String(tx.issuerContextCik) : '',
        tx.resolvedSector || '',
        tx.issuerContextSector || '',
        tx.sector,
        tx.assetType,
        ...tx.enrichmentFlags,
        ...(tx.instrumentContextFlags || []),
        ...(tx.issuerContextFlags || []),
      ].join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (filters.ticker && filters.ticker !== 'All') {
      const ticker = String(filters.ticker).toUpperCase();
      const tickers = [tx.resolvedTicker, tx.ticker, tx.issuerContextTicker].filter(Boolean).map((value) => String(value).toUpperCase());
      if (!tickers.includes(ticker)) return false;
    }
    if (filters.issuer) {
      const issuer = String(filters.issuer).trim().toLowerCase();
      const haystack = [
        tx.resolvedIssuerName || '',
        tx.issuerContextIssuerName || '',
        tx.instrumentIssuerName || '',
        tx.description,
      ].join(' ').toLowerCase();
      if (issuer && !haystack.includes(issuer)) return false;
    }
    return true;
  });
}

export function filtersFromSearchParams(params: URLSearchParams): TrumpOgeFilters {
  return {
    year: clean(params.get('year')),
    startDate: clean(params.get('startDate')),
    endDate: clean(params.get('endDate')),
    assetType: clean(params.get('assetType')),
    sector: clean(params.get('sector')),
    transactionType: clean(params.get('transactionType')),
    sourceReliability: clean(params.get('sourceReliability')),
    ticker: clean(params.get('ticker')),
    issuer: clean(params.get('issuer')),
    dataClass: clean(params.get('dataClass')),
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
