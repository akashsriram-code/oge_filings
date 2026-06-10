import * as XLSX from 'xlsx';
import { formatRange } from './amounts';
import { describeAssetType, describeSector, describeTransaction } from './descriptions';
import { buildEquityStockSummaries, deriveEquityStockName } from './stocks';
import type { TrumpOgeApiResponse } from './types';

export function buildTrumpOgeWorkbook(response: TrumpOgeApiResponse): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(response.trumpIndex.map((entry) => ({
      score: entry.score,
      display_name: entry.displayName,
      asset_type: entry.assetType,
      sector: entry.sector,
      resolved_ticker: entry.resolvedTicker || '',
      resolved_issuer_name: entry.resolvedIssuerName || '',
      resolved_exchange: entry.resolvedExchange || '',
      resolved_cik: entry.resolvedCik || '',
      issuer_context_ticker: entry.issuerContextTicker || '',
      issuer_context_name: entry.issuerContextIssuerName || '',
      issuer_context_exchange: entry.issuerContextExchange || '',
      issuer_context_cik: entry.issuerContextCik || '',
      issuer_context_sector: entry.issuerContextSector || '',
      issuer_context_source: entry.issuerContextSource || '',
      issuer_context_confidence: entry.issuerContextConfidence,
      instrument_kind: entry.instrumentKind || '',
      instrument_issuer_name: entry.instrumentIssuerName || '',
      instrument_coupon: entry.instrumentCoupon ?? '',
      instrument_maturity_date: entry.instrumentMaturityDate || '',
      instrument_callable: entry.instrumentCallable === null ? '' : entry.instrumentCallable ? 'yes' : 'no',
      instrument_call_date: entry.instrumentCallDate || '',
      instrument_call_price: entry.instrumentCallPrice ?? '',
      instrument_yield_to_call: entry.instrumentYieldToCall ?? '',
      instrument_yield_to_maturity: entry.instrumentYieldToMaturity ?? '',
      instrument_cusip: entry.instrumentCusip || '',
      instrument_isin: entry.instrumentIsin || '',
      instrument_figi: entry.instrumentFigi || '',
      instrument_summary: entry.instrumentSummary || '',
      instrument_flags: entry.instrumentContextFlags.join('; '),
      issuer_context_flags: entry.issuerContextFlags.join('; '),
      current_range: formatRange(entry.currentRange),
      current_midpoint: entry.currentMidpoint,
      previous_range: formatRange(entry.previousRange),
      change_midpoint: entry.changeMidpoint,
      change_pct: entry.changePct ?? '',
      purchase_midpoint: entry.purchaseMidpoint,
      sale_midpoint: entry.saleMidpoint,
      net_flow_midpoint: entry.netFlowMidpoint,
      net_direction: entry.netDirection,
      transaction_count: entry.transactionCount,
      filing_count: entry.filingCount,
      first_seen_date: entry.firstSeenDate || '',
      last_seen_date: entry.lastSeenDate || '',
      exposure_component: entry.exposureComponent,
      change_component: entry.changeComponent,
      activity_component: entry.activityComponent,
      confidence: entry.confidence,
      source_reliability: entry.sourceReliability,
      review_flags: entry.reviewFlags.join('; '),
      citations: entry.citations.map((citation) => citation.sourceUrl || citation.label).join('; '),
    }))),
    'Trump Index'
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(response.trumpIndexRollups.map((rollup) => ({
      rollup_type: rollup.rollupType,
      key: rollup.key,
      entry_count: rollup.entryCount,
      current_midpoint: rollup.currentMidpoint,
      purchase_midpoint: rollup.purchaseMidpoint,
      sale_midpoint: rollup.saleMidpoint,
      net_flow_midpoint: rollup.netFlowMidpoint,
      average_score: rollup.averageScore,
      top_entry_ids: rollup.topEntryIds.join('; '),
    }))),
    'Trump Index Rollups'
  );

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
      issuer_context_ticker: tx.issuerContextTicker || '',
      issuer_context_name: tx.issuerContextIssuerName || '',
      issuer_context_exchange: tx.issuerContextExchange || '',
      issuer_context_cik: tx.issuerContextCik || '',
      issuer_context_sector: tx.issuerContextSector || '',
      issuer_context_source: tx.issuerContextSource || '',
      issuer_context_confidence: tx.issuerContextConfidence,
      issuer_context_flags: tx.issuerContextFlags.join('; '),
      instrument_kind: tx.instrumentKind || '',
      instrument_issuer_name: tx.instrumentIssuerName || '',
      instrument_coupon: tx.instrumentCoupon ?? '',
      instrument_maturity_date: tx.instrumentMaturityDate || '',
      instrument_callable: tx.instrumentCallable === null ? '' : tx.instrumentCallable ? 'yes' : 'no',
      instrument_call_date: tx.instrumentCallDate || '',
      instrument_call_price: tx.instrumentCallPrice ?? '',
      instrument_yield_to_call: tx.instrumentYieldToCall ?? '',
      instrument_yield_to_maturity: tx.instrumentYieldToMaturity ?? '',
      instrument_cusip: tx.instrumentCusip || '',
      instrument_isin: tx.instrumentIsin || '',
      instrument_figi: tx.instrumentFigi || '',
      instrument_summary: tx.instrumentSummary || '',
      instrument_match_source: tx.instrumentMatchSource,
      instrument_match_confidence: tx.instrumentMatchConfidence,
      instrument_flags: tx.instrumentContextFlags.join('; '),
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
      issuer_context_ticker: holding.issuerContextTicker || '',
      issuer_context_name: holding.issuerContextIssuerName || '',
      issuer_context_exchange: holding.issuerContextExchange || '',
      issuer_context_cik: holding.issuerContextCik || '',
      issuer_context_sector: holding.issuerContextSector || '',
      issuer_context_source: holding.issuerContextSource || '',
      issuer_context_confidence: holding.issuerContextConfidence,
      issuer_context_flags: holding.issuerContextFlags.join('; '),
      instrument_kind: holding.instrumentKind || '',
      instrument_issuer_name: holding.instrumentIssuerName || '',
      instrument_coupon: holding.instrumentCoupon ?? '',
      instrument_maturity_date: holding.instrumentMaturityDate || '',
      instrument_callable: holding.instrumentCallable === null ? '' : holding.instrumentCallable ? 'yes' : 'no',
      instrument_call_date: holding.instrumentCallDate || '',
      instrument_call_price: holding.instrumentCallPrice ?? '',
      instrument_yield_to_call: holding.instrumentYieldToCall ?? '',
      instrument_yield_to_maturity: holding.instrumentYieldToMaturity ?? '',
      instrument_cusip: holding.instrumentCusip || '',
      instrument_isin: holding.instrumentIsin || '',
      instrument_figi: holding.instrumentFigi || '',
      instrument_summary: holding.instrumentSummary || '',
      instrument_match_source: holding.instrumentMatchSource,
      instrument_match_confidence: holding.instrumentMatchConfidence,
      instrument_flags: holding.instrumentContextFlags.join('; '),
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
      source_filing_id: holding.sourceFilingId || '',
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
      issuer_context_ticker: item.issuerContextTicker || '',
      issuer_context_name: item.issuerContextIssuerName || '',
      issuer_context_exchange: item.issuerContextExchange || '',
      issuer_context_cik: item.issuerContextCik || '',
      issuer_context_sector: item.issuerContextSector || '',
      issuer_context_source: item.issuerContextSource || '',
      issuer_context_confidence: item.issuerContextConfidence,
      issuer_context_flags: item.issuerContextFlags.join('; '),
      instrument_kind: item.instrumentKind || '',
      instrument_issuer_name: item.instrumentIssuerName || '',
      instrument_coupon: item.instrumentCoupon ?? '',
      instrument_maturity_date: item.instrumentMaturityDate || '',
      instrument_callable: item.instrumentCallable === null ? '' : item.instrumentCallable ? 'yes' : 'no',
      instrument_call_date: item.instrumentCallDate || '',
      instrument_call_price: item.instrumentCallPrice ?? '',
      instrument_yield_to_call: item.instrumentYieldToCall ?? '',
      instrument_yield_to_maturity: item.instrumentYieldToMaturity ?? '',
      instrument_cusip: item.instrumentCusip || '',
      instrument_isin: item.instrumentIsin || '',
      instrument_figi: item.instrumentFigi || '',
      instrument_summary: item.instrumentSummary || '',
      instrument_match_source: item.instrumentMatchSource,
      instrument_match_confidence: item.instrumentMatchConfidence,
      instrument_flags: item.instrumentContextFlags.join('; '),
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
    XLSX.utils.json_to_sheet(response.events.map((event) => ({
      date: event.date,
      end_date: event.endDate || '',
      category: event.category,
      importance: event.importance,
      title: event.title,
      summary: event.summary,
      source_name: event.sourceName,
      source_url: event.sourceUrl,
      tickers: event.tickers.join('; '),
      sectors: event.sectors.join('; '),
      tags: event.tags.join('; '),
    }))),
    'Events'
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(response.eventWindows.map((window) => {
      const event = response.events.find((item) => item.id === window.eventId);
      return {
        event_date: event?.date || '',
        event_category: event?.category || '',
        event_title: event?.title || '',
        window_days: window.windowDays,
        transaction_count: window.transactionCount,
        purchase_midpoint: window.purchaseMidpoint,
        sale_midpoint: window.saleMidpoint,
        net_midpoint: window.netMidpoint,
        matched_tickers: window.matchedTickers.join('; '),
        matched_sectors: window.matchedSectors.join('; '),
        first_transaction_date: window.firstTransactionDate || '',
        last_transaction_date: window.lastTransactionDate || '',
      };
    })),
    'Event Windows'
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
    XLSX.utils.json_to_sheet(response.historicalSources.map((source) => ({
      filed_date: source.filedDate,
      report_year: source.reportYear || '',
      filing_type: source.filingType,
      source_type: source.sourceType,
      source_reliability: source.sourceReliability,
      fetch_status: source.fetchStatus,
      source_review_status: source.sourceReviewStatus,
      title: source.title,
      filename: source.localFilename,
      bytes: source.bytes || '',
      sha256: source.sha256 || '',
      source_url: source.sourceUrl,
      provenance_note: source.provenanceNote,
    }))),
    'Historical Sources'
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(response.financialDisclosureReports.map((report) => ({
      filed_date: report.filedDate,
      report_year: report.reportYear || '',
      filing_type: report.filingType,
      source_reliability: report.sourceReliability,
      parser_status: report.parserStatus,
      asset_income_count: report.assetIncomeCount,
      liability_count: report.liabilityCount,
      source_id: report.sourceId,
      notes: report.notes,
    }))),
    'Disclosure Reports'
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(response.assetIncomeHoldings.map((holding) => ({
      source_id: holding.sourceId,
      description: holding.description,
      value_range: formatRange(holding.value),
      value_midpoint: holding.value.midpoint,
      income_type: holding.incomeType || '',
      income_range: formatRange(holding.income),
      income_midpoint: holding.income.midpoint,
      asset_type: holding.assetType,
      sector: holding.sector,
      source_reliability: holding.sourceReliability,
      confidence: holding.confidence,
      review_flags: holding.reviewFlags.join('; '),
    }))),
    'Asset Income Holdings'
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(response.liabilities.map((liability) => ({
      source_id: liability.sourceId,
      creditor_name: liability.creditorName,
      type: liability.type,
      amount_range: formatRange(liability.amount),
      amount_midpoint: liability.amount.midpoint,
      year_incurred: liability.yearIncurred || '',
      rate: liability.rate || '',
      term: liability.term || '',
      source_reliability: liability.sourceReliability,
      confidence: liability.confidence,
      review_flags: liability.reviewFlags.join('; '),
    }))),
    'Liabilities'
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(response.yearlyExposureSummaries.map((summary) => ({
      year: summary.year,
      source_reliability: summary.sourceReliability,
      asset_income_count: summary.assetIncomeCount,
      liability_count: summary.liabilityCount,
      transaction_count: summary.transactionCount,
      current_midpoint: summary.currentMidpoint,
      purchase_midpoint: summary.purchaseMidpoint,
      sale_midpoint: summary.saleMidpoint,
      net_flow_midpoint: summary.netFlowMidpoint,
      source_ids: summary.sourceIds.join('; '),
    }))),
    'Yearly Exposure'
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
      { field: 'trump_index_formula', value: 'Score is 50% log-scaled current midpoint exposure rank, 30% absolute midpoint change rank, and 20% gross transaction activity rank.' },
      { field: 'trump_index_confidence', value: 'Confidence and source reliability are displayed beside the score but do not reduce the score.' },
      { field: 'historical_coverage', value: 'Source registry starts on Jan. 1, 2015 and separates official OGE PDFs, archived public copies, and request-only metadata.' },
      { field: 'holdings_estimates', value: 'Holdings are transaction-implied until the annual 278e baseline is extracted and reviewed.' },
      { field: 'classification', value: 'Asset type labels remain rules-based and carry confidence/review flags.' },
      { field: 'security_enrichment', value: 'Resolved tickers, exchanges, CIKs, and SIC-derived broad sectors use public SEC and Nasdaq Trader reference data.' },
      { field: 'instrument_context', value: 'Bond/security instrument summaries are parsed from OGE descriptions. Issuer-context tickers identify likely public-company issuer context and are not direct bond identifiers.' },
      { field: 'sector_labels', value: 'Resolved sectors are SEC/SIC-derived broad sectors, not proprietary GICS classifications.' },
      { field: 'security_reference_count', value: String(response.cacheMeta.securityReferenceCount) },
      { field: 'security_enrichment_count', value: String(response.cacheMeta.securityEnrichmentCount) },
      { field: 'instrument_context_count', value: String(response.cacheMeta.instrumentContextCount) },
      { field: 'enriched_transaction_count', value: String(response.cacheMeta.enrichedTransactionCount) },
      { field: 'event_overlay', value: 'Events are used for proximity analysis only; event proximity does not imply motive or causation.' },
      { field: 'event_count', value: String(response.cacheMeta.eventCount) },
      { field: 'event_window_count', value: String(response.cacheMeta.eventWindowCount) },
      { field: 'historical_source_count', value: String(response.cacheMeta.historicalSourceCount) },
      { field: 'financial_disclosure_report_count', value: String(response.cacheMeta.financialDisclosureReportCount) },
      { field: 'asset_income_holding_count', value: String(response.cacheMeta.assetIncomeHoldingCount) },
      { field: 'liability_count', value: String(response.cacheMeta.liabilityCount) },
      { field: 'trump_index_count', value: String(response.cacheMeta.trumpIndexCount) },
    ]),
    'Methodology'
  );

  return workbook;
}

export function trumpOgeWorkbookFilename(response: Pick<TrumpOgeApiResponse, 'cacheMeta'>): string {
  return `trump-oge-dashboard-${response.cacheMeta.dataThrough || 'latest'}.xlsx`;
}
