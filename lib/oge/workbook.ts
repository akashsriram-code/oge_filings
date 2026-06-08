import * as XLSX from 'xlsx';
import { formatRange } from './amounts';
import { describeAssetType, describeSector, describeTransaction } from './descriptions';
import { buildEquityStockSummaries, deriveEquityStockName } from './stocks';
import type { TrumpOgeApiResponse } from './types';

export function buildTrumpOgeWorkbook(response: TrumpOgeApiResponse): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(response.transactions.map((tx) => ({
      date: tx.date,
      type: tx.type,
      description: tx.description,
      source_ticker: tx.ticker || '',
      derived_stock_name: tx.assetType === 'Equity' ? deriveEquityStockName(tx.description) : '',
      resolved_ticker: tx.resolvedTicker || '',
      resolved_issuer_name: tx.resolvedIssuerName || '',
      resolved_exchange: tx.resolvedExchange || '',
      resolved_cik: tx.resolvedCik || '',
      resolved_sic: tx.resolvedSic || '',
      resolved_sic_description: tx.resolvedSicDescription || '',
      resolved_sector: tx.resolvedSector || '',
      enrichment_source: tx.enrichmentSource,
      enrichment_confidence: tx.enrichmentConfidence,
      enrichment_flags: tx.enrichmentFlags.join('; '),
      asset_type: tx.assetType,
      sector: tx.sector,
      asset_description: describeAssetType(tx.assetType),
      sector_description: describeSector(tx.sector),
      transaction_read: describeTransaction(tx),
      amount_range: tx.amount.label,
      amount_min: tx.amount.min,
      amount_max: tx.amount.max,
      amount_midpoint: tx.amount.midpoint,
      late_filing: tx.lateFilingFlag ? 'yes' : 'no',
      classification_confidence: tx.classificationConfidence,
      parser_status: tx.parserStatus,
      review_flags: tx.reviewFlags.join('; '),
      source_url: tx.sourceUrl || '',
    }))),
    'Transactions'
  );

  const equityStocks = buildEquityStockSummaries(response.transactions);
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(equityStocks.map((stock) => ({
      stock_name: stock.stockName,
      source_ticker: stock.ticker || '',
      resolved_ticker: stock.resolvedTicker || '',
      resolved_issuer_name: stock.resolvedIssuerName || '',
      resolved_exchange: stock.resolvedExchange || '',
      resolved_cik: stock.resolvedCik || '',
      resolved_sic: stock.resolvedSic || '',
      resolved_sic_description: stock.resolvedSicDescription || '',
      resolved_sector: stock.resolvedSector || '',
      enrichment_source: stock.enrichmentSource,
      enrichment_confidence: stock.enrichmentConfidence,
      enrichment_flags: stock.enrichmentFlags.join('; '),
      sector: stock.sector,
      sector_description: describeSector(stock.sector),
      purchase_count: stock.purchaseCount,
      sale_count: stock.saleCount,
      transaction_count: stock.transactionCount,
      purchase_range: formatRange(stock.purchases),
      purchase_midpoint: stock.purchases.midpoint,
      sale_midpoint: stock.sales.midpoint,
      net_midpoint: stock.net.midpoint,
      net_direction: stock.netDirection,
      net_direction_note: stock.netDirectionNote,
      first_purchase_date: stock.firstPurchaseDate || '',
      last_purchase_date: stock.lastPurchaseDate || '',
      last_transaction_date: stock.lastTransactionDate || '',
      late_count: stock.lateCount,
      confidence: stock.confidence,
    }))),
    'Equity Stocks'
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(response.holdingsEstimates.map((holding) => ({
      description: holding.description,
      source_ticker: holding.ticker || '',
      resolved_ticker: holding.resolvedTicker || '',
      resolved_issuer_name: holding.resolvedIssuerName || '',
      resolved_exchange: holding.resolvedExchange || '',
      resolved_cik: holding.resolvedCik || '',
      resolved_sic: holding.resolvedSic || '',
      resolved_sic_description: holding.resolvedSicDescription || '',
      resolved_sector: holding.resolvedSector || '',
      enrichment_source: holding.enrichmentSource,
      enrichment_confidence: holding.enrichmentConfidence,
      enrichment_flags: holding.enrichmentFlags.join('; '),
      asset_type: holding.assetType,
      sector: holding.sector,
      asset_description: describeAssetType(holding.assetType),
      sector_description: describeSector(holding.sector),
      estimated_current_range: formatRange(holding.estimatedCurrent),
      estimated_current_min: holding.estimatedCurrent.min,
      estimated_current_midpoint: holding.estimatedCurrent.midpoint,
      estimated_current_max: holding.estimatedCurrent.max,
      purchases_midpoint: holding.purchases.midpoint,
      sales_midpoint: holding.sales.midpoint,
      transaction_count: holding.transactionCount,
      last_transaction_date: holding.lastTransactionDate || '',
      missing_baseline: holding.missingBaseline ? 'yes' : 'no',
      confidence: holding.confidence,
      review_flags: holding.reviewFlags.join('; '),
    }))),
    'Estimated Holdings'
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(response.sectorSummaries.map((summary) => ({
      asset_type: summary.assetType,
      sector: summary.sector,
      sector_description: describeSector(summary.sector),
      transaction_count: summary.transactionCount,
      purchases_midpoint: summary.purchases.midpoint,
      sales_midpoint: summary.sales.midpoint,
      net_midpoint: summary.net.midpoint,
      late_count: summary.lateCount,
      confidence: summary.confidence,
      enriched_transaction_count: summary.enrichedTransactionCount,
      public_company_count: summary.publicCompanyCount,
      enrichment_confidence: summary.enrichmentConfidence,
    }))),
    'Sector Summary'
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(response.securityEnrichments.map((item) => ({
      description: item.description,
      source_ticker: item.sourceTicker || '',
      resolved_ticker: item.resolvedTicker || '',
      resolved_issuer_name: item.resolvedIssuerName || '',
      resolved_exchange: item.resolvedExchange || '',
      resolved_cik: item.resolvedCik || '',
      resolved_sic: item.resolvedSic || '',
      resolved_sic_description: item.resolvedSicDescription || '',
      resolved_sector: item.resolvedSector || '',
      enrichment_source: item.enrichmentSource,
      enrichment_confidence: item.enrichmentConfidence,
      enrichment_flags: item.enrichmentFlags.join('; '),
      candidate_tickers: item.candidateTickers.join('; '),
      transaction_count: item.transactionCount,
      asset_types: item.assetTypes.join('; '),
    }))),
    'Security Enrichment'
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(response.sourceFilings.map((filing) => ({
      filed_date: filing.filedDate,
      document_type: filing.documentType,
      is_amendment: filing.isAmendment ? 'yes' : 'no',
      amended_at: filing.amendedAt || '',
      filename: filing.localFilename,
      bytes: filing.bytes || '',
      sha256: filing.sha256 || '',
      parser_status: filing.parserStatus,
      transaction_count: filing.transactionCount || '',
      oge_url: filing.ogeUrl,
      notes: filing.notes,
    }))),
    'Filing Sources'
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(response.reviewQueue.map((item) => ({
      severity: item.severity,
      kind: item.kind,
      title: item.title,
      detail: item.detail,
      related_id: item.relatedId || '',
      source_url: item.sourceUrl || '',
    }))),
    'Review Queue'
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([
      { field: 'generated_at', value: response.cacheMeta.generatedAt },
      { field: 'data_through', value: response.cacheMeta.dataThrough || '' },
      { field: 'source', value: response.cacheMeta.source },
      { field: 'methodology', value: 'Values are OGE statutory ranges. Midpoint totals are estimates, not exact trading values.' },
      { field: 'holdings_estimates', value: 'Holdings are transaction-implied until the annual 278e baseline is extracted and reviewed.' },
      { field: 'classification', value: 'Asset type labels remain rules-based and carry confidence/review flags.' },
      { field: 'security_enrichment', value: 'Resolved tickers, exchanges, CIKs, and SIC-derived broad sectors use public SEC and Nasdaq Trader reference data.' },
      { field: 'sector_labels', value: 'Resolved sectors are SEC/SIC-derived broad sectors, not proprietary GICS classifications.' },
      { field: 'security_reference_count', value: String(response.cacheMeta.securityReferenceCount) },
      { field: 'security_enrichment_count', value: String(response.cacheMeta.securityEnrichmentCount) },
      { field: 'enriched_transaction_count', value: String(response.cacheMeta.enrichedTransactionCount) },
    ]),
    'Methodology'
  );

  return workbook;
}

export function trumpOgeWorkbookFilename(response: Pick<TrumpOgeApiResponse, 'cacheMeta'>): string {
  return `trump-oge-dashboard-${response.cacheMeta.dataThrough || 'latest'}.xlsx`;
}
