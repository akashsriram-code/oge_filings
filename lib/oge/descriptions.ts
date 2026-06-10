import type { AssetType, OgeTransaction, SectorSummary } from './types';

export function describeAssetType(assetType: AssetType | string): string {
  const descriptions: Record<string, string> = {
    Equity: 'Public-company common or ordinary shares inferred from issuer language.',
    'Corporate Bond': 'Company debt, notes, debentures, or bond-like securities.',
    'Municipal Bond': 'State, local, authority, school, hospital, or university municipal debt.',
    'ETF / Fund': 'Exchange-traded funds, mutual funds, trusts, or broad pooled vehicles.',
    'Preferred / Hybrid': 'Preferred stock, depositary shares, convertible preferreds, or hybrid securities.',
    Other: 'Rows that need a human read before a stronger label is assigned.',
  };
  return descriptions[assetType] || 'Rules-based category inferred from the security description.';
}

export function describeSector(sector: string): string {
  const descriptions: Record<string, string> = {
    'Information Technology': 'Software, semiconductors, payment technology, data platforms, and technology services.',
    'Communication Services': 'Streaming, internet platforms, media, social, gaming, and digital advertising names.',
    'Consumer Discretionary': 'Restaurants, retail, travel, autos, leisure, and other cyclical consumer exposure.',
    'Consumer Staples': 'Food, household products, discount retail, packaged goods, and defensive consumer names.',
    Financials: 'Banks, brokers, asset managers, exchanges, insurers, lenders, and financial technology.',
    Energy: 'Oil, gas, services, refining, pipelines, and energy-adjacent issuers.',
    'Health Care': 'Pharma, biotech, care delivery, devices, insurers, and health-service companies.',
    Industrials: 'Aerospace, machinery, transport, services, construction, and industrial suppliers.',
    Utilities: 'Power generation, regulated utilities, grid, electric, and gas utility exposure.',
    'Real Estate': 'REITs, mortgage REITs, towers, hospitality real estate, and property vehicles.',
    Materials: 'Chemicals, metals, mining, packaging, and raw-materials producers.',
    'Municipal Bonds': 'Tax-exempt or public-purpose debt tied to states, cities, schools, hospitals, and authorities.',
    'ETF / Funds': 'Pooled market exposure where the underlying sector may be broader than the name.',
    'Corporate Credit': 'Corporate debt where the issuer sector was not confidently inferred.',
    'Preferred / Hybrid': 'Preferred or hybrid securities where issuer sector was not confidently inferred.',
    'Unclassified Equity': 'Company-like securities that need enrichment before sector assignment.',
    Other: 'Rows without enough signal for a confident sector assignment.',
  };
  return descriptions[sector] || 'Rules-based sector inferred from the security description.';
}

export function summarizeSector(summary: SectorSummary): string {
  const direction = summary.net.midpoint >= 0 ? 'net buying' : 'net selling';
  const enrichment = summary.publicCompanyCount > 0
    ? `${summary.publicCompanyCount.toLocaleString('en-US')} public-company matches`
    : 'no public-company matches';
  return `${summary.transactionCount.toLocaleString('en-US')} visible transactions, ${direction} by midpoint estimate, ${enrichment}. ${describeSector(summary.sector)}`;
}

export function describeTransaction(tx: OgeTransaction): string {
  const action = tx.type === 'Purchase' ? 'Bought' : tx.type === 'Sale' ? 'Sold' : 'Reported';
  const confidence = `${Math.round(tx.classificationConfidence * 100)}% classifier confidence`;
  const late = tx.lateFilingFlag ? 'reported late' : 'not flagged late';
  const enrichment = tx.resolvedTicker
    ? `public match ${tx.resolvedTicker}${tx.resolvedExchange ? ` on ${tx.resolvedExchange}` : ''}`
    : tx.issuerContextTicker
      ? `issuer context ${tx.issuerContextTicker}${tx.issuerContextExchange ? ` on ${tx.issuerContextExchange}` : ''}`
    : 'no public-security match';
  const instrument = tx.instrumentSummary ? ` ${tx.instrumentSummary}` : '';
  return `${action} ${tx.assetType.toLowerCase()} exposure in ${tx.sector}; ${late}; ${confidence}; ${enrichment}.${instrument}`;
}

export function confidenceLabel(value: number): string {
  if (value >= 0.85) return 'High';
  if (value >= 0.7) return 'Medium';
  return 'Review';
}
