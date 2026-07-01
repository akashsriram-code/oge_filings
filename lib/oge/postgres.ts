import { promises as fs } from 'fs';
import path from 'path';
import { Pool, type PoolClient } from 'pg';
import {
  buildDashboardBootstrap,
  buildPageResponseFromParts,
  isTrumpOgePageName,
  ogeCacheHeaders,
} from './data';
import type {
  AssetIncomeHolding,
  BaselineHolding,
  CacheMeta,
  FixedIncomeIdentifierMatch,
  FinancialDisclosureReport,
  HistoricalSource,
  InstrumentIdentity,
  Liability,
  OgeEvent,
  OgeTransaction,
  ReviewQueueItem,
  SecurityEnrichment,
  SectorSummary,
  SourceFiling,
  TrumpIndexEntry,
  TrumpIndexRollup,
  TrumpOgeBootstrap,
  TrumpOgeDataset,
  TrumpOgeFilters,
  TrumpOgePageName,
  TrumpOgePageResponse,
  YearlyExposureSummary,
} from './types';

const MIGRATION_PATH = path.join(process.cwd(), 'db', 'migrations', '001_trump_oge_cache.sql');
const ROW_TABLES = [
  'trump_oge_transactions',
  'trump_oge_baseline_holdings',
  'trump_oge_historical_sources',
  'trump_oge_source_filings',
  'trump_oge_events',
  'trump_oge_trump_index_entries',
  'trump_oge_trump_index_rollups',
  'trump_oge_sector_summaries',
  'trump_oge_review_queue',
  'trump_oge_security_enrichments',
  'trump_oge_fixed_income_identifiers',
  'trump_oge_instrument_identities',
  'trump_oge_financial_disclosure_reports',
  'trump_oge_asset_income_holdings',
  'trump_oge_liabilities',
  'trump_oge_yearly_exposure_summaries',
] as const;

let pool: Pool | null = null;

interface CacheRunRow {
  cache_version: string;
  cache_meta: CacheMeta | string;
  bootstrap: TrumpOgeBootstrap | string;
}

interface JsonRow<T> {
  row_data: T | string;
}

export function isPostgresConfigured(): boolean {
  return Boolean(process.env.TRUMP_OGE_DATABASE_URL);
}

export function postgresCacheHeaders(cacheMeta: CacheMeta): HeadersInit {
  return {
    ...ogeCacheHeaders(cacheMeta),
    'x-cache-store': 'postgres',
  };
}

export async function ensureTrumpOgePostgresSchema(): Promise<boolean> {
  const currentPool = getPool();
  if (!currentPool) return false;
  const sql = await fs.readFile(MIGRATION_PATH, 'utf8');
  await currentPool.query(sql);
  return true;
}

export async function syncTrumpOgeDatasetToPostgres(dataset: TrumpOgeDataset): Promise<boolean> {
  const currentPool = getPool();
  if (!currentPool) return false;
  const client = await currentPool.connect();
  try {
    await client.query('BEGIN');
    await ensureTrumpOgeSchemaWithClient(client);
    await upsertCacheRun(client, dataset);
    for (const table of ROW_TABLES) {
      await client.query(`DELETE FROM ${table} WHERE cache_version = $1`, [dataset.cacheMeta.generatedAt]);
    }
    await insertTransactions(client, dataset.cacheMeta.generatedAt, dataset.transactions);
    await insertBaselineHoldings(client, dataset.cacheMeta.generatedAt, dataset.baselineHoldings);
    await insertHistoricalSources(client, dataset.cacheMeta.generatedAt, dataset.historicalSources);
    await insertSourceFilings(client, dataset.cacheMeta.generatedAt, dataset.sourceFilings);
    await insertEvents(client, dataset.cacheMeta.generatedAt, dataset.events);
    await insertIndexEntries(client, dataset.cacheMeta.generatedAt, dataset.trumpIndex);
    await insertIndexRollups(client, dataset.cacheMeta.generatedAt, dataset.trumpIndexRollups);
    await insertSectorSummaries(client, dataset.cacheMeta.generatedAt, dataset.sectorSummaries);
    await insertReviewQueue(client, dataset.cacheMeta.generatedAt, dataset.reviewQueue);
    await insertSecurityEnrichments(client, dataset.cacheMeta.generatedAt, dataset.securityEnrichments);
    await insertFixedIncomeIdentifiers(client, dataset.cacheMeta.generatedAt, dataset.fixedIncomeIdentifiers.entries);
    await insertInstrumentIdentities(client, dataset.cacheMeta.generatedAt, dataset.instrumentIdentities);
    await insertFinancialDisclosureReports(client, dataset.cacheMeta.generatedAt, dataset.financialDisclosureReports);
    await insertAssetIncomeHoldings(client, dataset.cacheMeta.generatedAt, dataset.assetIncomeHoldings);
    await insertLiabilities(client, dataset.cacheMeta.generatedAt, dataset.liabilities);
    await insertYearlyExposureSummaries(client, dataset.cacheMeta.generatedAt, dataset.yearlyExposureSummaries);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function loadTrumpOgeBootstrapFromPostgres(): Promise<TrumpOgeBootstrap | null> {
  const currentPool = getPool();
  if (!currentPool) return null;
  try {
    const run = await loadLatestCacheRun(currentPool);
    return run?.bootstrap || null;
  } catch (error) {
    console.warn(`[Trump OGE Postgres] Bootstrap fallback to JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function buildPageResponseFromPostgres(
  page: TrumpOgePageName,
  filters: TrumpOgeFilters = {}
): Promise<TrumpOgePageResponse | null> {
  if (!isTrumpOgePageName(page)) return null;
  const currentPool = getPool();
  if (!currentPool) return null;

  const client = await currentPool.connect();
  try {
    const run = await loadLatestCacheRun(client);
    if (!run) return null;
    const effectiveFilters = filtersForPostgresPage(page, filters);
    const needsTransactions = pageNeedsTransactions(page);
    const needsBaseline = pageNeedsBaseline(page);
    const needsIndex = pageNeedsIndex(page);
    const needsSources = pageNeedsSources(page);
    const needsSourceFilings = needsTransactions || needsIndex || page === 'filings';
    const [
      transactions,
      baselineHoldings,
      sourceFilings,
      historicalSources,
      reviewQueue,
      instrumentIdentities,
      yearlyExposureSummaries,
      events,
    ] = await Promise.all([
      needsTransactions ? queryTransactions(client, run.cacheVersion, effectiveFilters) : Promise.resolve([]),
      needsBaseline ? queryJsonRows<BaselineHolding>(client, 'trump_oge_baseline_holdings', run.cacheVersion, 'id') : Promise.resolve([]),
      needsSourceFilings ? queryJsonRows<SourceFiling>(client, 'trump_oge_source_filings', run.cacheVersion, 'filed_date DESC, id') : Promise.resolve([]),
      needsSources || needsIndex || page === 'timing' ? queryHistoricalSources(client, run.cacheVersion, effectiveFilters) : Promise.resolve([]),
      needsTransactions || page === 'review' ? queryJsonRows<ReviewQueueItem>(client, 'trump_oge_review_queue', run.cacheVersion, 'id') : Promise.resolve([]),
      page === 'identifier-review' ? queryJsonRows<InstrumentIdentity>(client, 'trump_oge_instrument_identities', run.cacheVersion, 'review_priority DESC, id') : Promise.resolve([]),
      needsIndex ? queryJsonRows<YearlyExposureSummary>(client, 'trump_oge_yearly_exposure_summaries', run.cacheVersion, 'year') : Promise.resolve(run.bootstrap.yearlyExposureSummaries),
      page === 'timing' ? queryJsonRows<OgeEvent>(client, 'trump_oge_events', run.cacheVersion, 'event_date, id') : Promise.resolve([]),
    ]);

    return buildPageResponseFromParts({
      page,
      filters: effectiveFilters,
      bootstrap: run.bootstrap,
      historicalSources,
      sourceFilings,
      transactions,
      baselineHoldings,
      yearlyExposureSummaries,
      sourceAudit: run.bootstrap.sourceAudit,
      reviewQueue,
      instrumentIdentities,
      events,
    });
  } catch (error) {
    console.warn(`[Trump OGE Postgres] Page fallback to JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    client.release();
  }
}

export function resetTrumpOgePostgresPoolForTests() {
  const current = pool;
  pool = null;
  return current?.end();
}

function getPool(): Pool | null {
  const connectionString = process.env.TRUMP_OGE_DATABASE_URL;
  if (!connectionString) return null;
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: Number(process.env.TRUMP_OGE_POSTGRES_POOL_MAX || 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}

async function ensureTrumpOgeSchemaWithClient(client: PoolClient): Promise<void> {
  const sql = await fs.readFile(MIGRATION_PATH, 'utf8');
  await client.query(sql);
}

async function loadLatestCacheRun(queryable: Pool | PoolClient): Promise<{
  cacheVersion: string;
  cacheMeta: CacheMeta;
  bootstrap: TrumpOgeBootstrap;
} | null> {
  const result = await queryable.query<CacheRunRow>(
    `SELECT cache_version, cache_meta, bootstrap
     FROM trump_oge_cache_runs
     ORDER BY generated_at DESC
     LIMIT 1`
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    cacheVersion: row.cache_version,
    cacheMeta: parseJsonValue<CacheMeta>(row.cache_meta),
    bootstrap: parseJsonValue<TrumpOgeBootstrap>(row.bootstrap),
  };
}

async function upsertCacheRun(client: PoolClient, dataset: TrumpOgeDataset): Promise<void> {
  const bootstrap = buildDashboardBootstrap(dataset);
  await client.query(
    `INSERT INTO trump_oge_cache_runs (cache_version, generated_at, data_through, cache_meta, bootstrap)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
     ON CONFLICT (cache_version)
     DO UPDATE SET
       generated_at = EXCLUDED.generated_at,
       data_through = EXCLUDED.data_through,
       cache_meta = EXCLUDED.cache_meta,
       bootstrap = EXCLUDED.bootstrap`,
    [
      dataset.cacheMeta.generatedAt,
      dataset.cacheMeta.generatedAt,
      dataset.cacheMeta.dataThrough,
      JSON.stringify(dataset.cacheMeta),
      JSON.stringify(bootstrap),
    ]
  );
}

async function queryTransactions(
  client: PoolClient,
  cacheVersion: string,
  filters: TrumpOgeFilters
): Promise<OgeTransaction[]> {
  const where = buildTransactionWhere(cacheVersion, filters);
  const result = await client.query<JsonRow<OgeTransaction>>(
    `SELECT row_data
     FROM trump_oge_transactions
     WHERE ${where.sql}
     ORDER BY transaction_date DESC NULLS LAST, id`,
    where.values
  );
  return result.rows.map((row) => parseJsonValue<OgeTransaction>(row.row_data));
}

async function queryHistoricalSources(
  client: PoolClient,
  cacheVersion: string,
  filters: TrumpOgeFilters
): Promise<HistoricalSource[]> {
  const values: unknown[] = [cacheVersion];
  const conditions = ['cache_version = $1'];
  if (filters.year && filters.year !== 'All') {
    values.push(Number(filters.year), String(filters.year));
    conditions.push(`(report_year = $${values.length - 1} OR filed_date::text LIKE $${values.length} || '%')`);
  }
  if (filters.sourceReliability && filters.sourceReliability !== 'All') {
    values.push(filters.sourceReliability);
    conditions.push(`source_reliability = $${values.length}`);
  }
  const result = await client.query<JsonRow<HistoricalSource>>(
    `SELECT row_data
     FROM trump_oge_historical_sources
     WHERE ${conditions.join(' AND ')}
     ORDER BY filed_date DESC NULLS LAST, id`,
    values
  );
  return result.rows.map((row) => parseJsonValue<HistoricalSource>(row.row_data));
}

async function queryJsonRows<T>(
  client: PoolClient,
  table: string,
  cacheVersion: string,
  orderBy: string
): Promise<T[]> {
  const result = await client.query<JsonRow<T>>(
    `SELECT row_data FROM ${table} WHERE cache_version = $1 ORDER BY ${orderBy}`,
    [cacheVersion]
  );
  return result.rows.map((row) => parseJsonValue<T>(row.row_data));
}

function buildTransactionWhere(cacheVersion: string, filters: TrumpOgeFilters): { sql: string; values: unknown[] } {
  const values: unknown[] = [cacheVersion];
  const conditions = ['cache_version = $1'];
  const add = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (filters.year && String(filters.year) !== 'All') {
    conditions.push(`transaction_year = ${add(Number(filters.year))}`);
  }
  if (filters.startDate) {
    conditions.push(`transaction_date >= ${add(filters.startDate)}`);
  }
  if (filters.endDate) {
    conditions.push(`transaction_date <= ${add(filters.endDate)}`);
  }
  if (filters.assetType && filters.assetType !== 'All') {
    conditions.push(`asset_type = ${add(filters.assetType)}`);
  }
  if (filters.sector && filters.sector !== 'All') {
    conditions.push(`sector = ${add(filters.sector)}`);
  }
  if (filters.transactionType && filters.transactionType !== 'All') {
    conditions.push(`transaction_type = ${add(filters.transactionType)}`);
  }
  if (filters.lateOnly) {
    conditions.push('late_filing_flag = true');
  }
  if (filters.confidence !== null && filters.confidence !== undefined) {
    conditions.push(`classification_confidence >= ${add(filters.confidence)}`);
  }
  if (filters.ticker && filters.ticker !== 'All') {
    const ticker = String(filters.ticker).toUpperCase();
    conditions.push(`(
      upper(coalesce(resolved_ticker, '')) = ${add(ticker)}
      OR upper(coalesce(ticker, '')) = ${add(ticker)}
      OR upper(coalesce(issuer_context_ticker, '')) = ${add(ticker)}
    )`);
  }
  if (filters.issuer) {
    const issuer = `%${String(filters.issuer).trim()}%`;
    conditions.push(`(
      resolved_issuer_name ILIKE ${add(issuer)}
      OR issuer_context_issuer_name ILIKE ${add(issuer)}
      OR row_data::text ILIKE ${add(issuer)}
    )`);
  }
  if (filters.query) {
    conditions.push(`row_data::text ILIKE ${add(`%${String(filters.query).trim()}%`)}`);
  }

  return { sql: conditions.join(' AND '), values };
}

function filtersForPostgresPage(page: TrumpOgePageName, filters: TrumpOgeFilters): TrumpOgeFilters {
  const next = { ...filters };
  const assetType = assetTypeForPage(page);
  if (assetType) next.assetType = assetType;
  if (page === 'timing') {
    next.year = 'All';
    next.startDate = '';
    next.endDate = '';
  }
  return next;
}

function pageNeedsTransactions(page: TrumpOgePageName): boolean {
  return page === 'index' ||
    page === 'holdings' ||
    page === 'sectors' ||
    page === 'timing' ||
    page === 'transactions' ||
    Boolean(assetTypeForPage(page));
}

function pageNeedsBaseline(page: TrumpOgePageName): boolean {
  return page === 'holdings' || pageNeedsIndex(page);
}

function pageNeedsIndex(page: TrumpOgePageName): boolean {
  return page === 'index' || Boolean(assetTypeForPage(page));
}

function pageNeedsSources(page: TrumpOgePageName): boolean {
  return page === 'index' || page === 'filings' || Boolean(assetTypeForPage(page));
}

function assetTypeForPage(page: TrumpOgePageName) {
  const assetTypes = {
    equities: 'Equity',
    'corporate-bonds': 'Corporate Bond',
    'municipal-bonds': 'Municipal Bond',
    funds: 'ETF / Fund',
    preferred: 'Preferred / Hybrid',
    other: 'Other',
  } satisfies Partial<Record<TrumpOgePageName, OgeTransaction['assetType']>>;
  return assetTypes[page as keyof typeof assetTypes] || null;
}

async function insertTransactions(client: PoolClient, cacheVersion: string, rows: OgeTransaction[]) {
  await batchInsert(client, 'trump_oge_transactions', [
    'cache_version',
    'id',
    'transaction_date',
    'transaction_year',
    'asset_type',
    'sector',
    'transaction_type',
    'late_filing_flag',
    'resolved_ticker',
    'ticker',
    'issuer_context_ticker',
    'resolved_issuer_name',
    'issuer_context_issuer_name',
    'source_url',
    'amount_midpoint',
    'classification_confidence',
    'row_data',
  ], rows.map((row) => [
    cacheVersion,
    row.id,
    dateOrNull(row.date),
    yearOrNull(row.date),
    row.assetType,
    row.sector,
    row.type,
    row.lateFilingFlag,
    row.resolvedTicker,
    row.ticker,
    row.issuerContextTicker,
    row.resolvedIssuerName,
    row.issuerContextIssuerName,
    row.sourceUrl,
    row.amount.midpoint,
    row.classificationConfidence,
    JSON.stringify(row),
  ]));
}

async function insertBaselineHoldings(client: PoolClient, cacheVersion: string, rows: BaselineHolding[]) {
  await batchInsert(client, 'trump_oge_baseline_holdings', [
    'cache_version',
    'id',
    'asset_type',
    'sector',
    'resolved_ticker',
    'issuer_context_ticker',
    'resolved_issuer_name',
    'issuer_context_issuer_name',
    'value_midpoint',
    'confidence',
    'row_data',
  ], rows.map((row) => [
    cacheVersion,
    row.id,
    row.assetType,
    row.sector,
    row.resolvedTicker,
    row.issuerContextTicker,
    row.resolvedIssuerName,
    row.issuerContextIssuerName,
    row.value.midpoint,
    row.confidence,
    JSON.stringify(row),
  ]));
}

async function insertHistoricalSources(client: PoolClient, cacheVersion: string, rows: HistoricalSource[]) {
  await batchInsert(client, 'trump_oge_historical_sources', [
    'cache_version',
    'id',
    'filed_date',
    'report_year',
    'filing_type',
    'source_reliability',
    'source_url',
    'row_data',
  ], rows.map((row) => [
    cacheVersion,
    row.id,
    dateOrNull(row.filedDate),
    row.reportYear,
    row.filingType,
    row.sourceReliability,
    row.sourceUrl,
    JSON.stringify(row),
  ]));
}

async function insertSourceFilings(client: PoolClient, cacheVersion: string, rows: SourceFiling[]) {
  await batchInsert(client, 'trump_oge_source_filings', [
    'cache_version',
    'id',
    'filed_date',
    'document_type',
    'oge_url',
    'row_data',
  ], rows.map((row) => [
    cacheVersion,
    row.id,
    dateOrNull(row.filedDate),
    row.documentType,
    row.ogeUrl,
    JSON.stringify(row),
  ]));
}

async function insertEvents(client: PoolClient, cacheVersion: string, rows: OgeEvent[]) {
  await batchInsert(client, 'trump_oge_events', [
    'cache_version',
    'id',
    'event_date',
    'event_year',
    'category',
    'importance',
    'row_data',
  ], rows.map((row) => [
    cacheVersion,
    row.id,
    dateOrNull(row.date),
    yearOrNull(row.date),
    row.category,
    row.importance,
    JSON.stringify(row),
  ]));
}

async function insertIndexEntries(client: PoolClient, cacheVersion: string, rows: TrumpIndexEntry[]) {
  await batchInsert(client, 'trump_oge_trump_index_entries', [
    'cache_version',
    'id',
    'asset_type',
    'sector',
    'resolved_ticker',
    'issuer_context_ticker',
    'resolved_issuer_name',
    'issuer_context_issuer_name',
    'source_reliability',
    'score',
    'current_midpoint',
    'row_data',
  ], rows.map((row) => [
    cacheVersion,
    row.id,
    row.assetType,
    row.sector,
    row.resolvedTicker,
    row.issuerContextTicker,
    row.resolvedIssuerName,
    row.issuerContextIssuerName,
    row.sourceReliability,
    row.score,
    row.currentMidpoint,
    JSON.stringify(row),
  ]));
}

async function insertIndexRollups(client: PoolClient, cacheVersion: string, rows: TrumpIndexRollup[]) {
  await batchInsert(client, 'trump_oge_trump_index_rollups', [
    'cache_version',
    'id',
    'rollup_type',
    'key',
    'row_data',
  ], rows.map((row) => [
    cacheVersion,
    row.id,
    row.rollupType,
    row.key,
    JSON.stringify(row),
  ]));
}

async function insertSectorSummaries(client: PoolClient, cacheVersion: string, rows: SectorSummary[]) {
  await batchInsert(client, 'trump_oge_sector_summaries', [
    'cache_version',
    'id',
    'asset_type',
    'sector',
    'row_data',
  ], rows.map((row) => [
    cacheVersion,
    row.key,
    row.assetType,
    row.sector,
    JSON.stringify(row),
  ]));
}

async function insertReviewQueue(client: PoolClient, cacheVersion: string, rows: ReviewQueueItem[]) {
  await batchInsert(client, 'trump_oge_review_queue', [
    'cache_version',
    'id',
    'severity',
    'kind',
    'row_data',
  ], rows.map((row) => [
    cacheVersion,
    row.id,
    row.severity,
    row.kind,
    JSON.stringify(row),
  ]));
}

async function insertSecurityEnrichments(client: PoolClient, cacheVersion: string, rows: SecurityEnrichment[]) {
  await batchInsert(client, 'trump_oge_security_enrichments', [
    'cache_version',
    'id',
    'resolved_ticker',
    'issuer_context_ticker',
    'row_data',
  ], rows.map((row) => [
    cacheVersion,
    row.id,
    row.resolvedTicker,
    row.issuerContextTicker,
    JSON.stringify(row),
  ]));
}

async function insertFixedIncomeIdentifiers(client: PoolClient, cacheVersion: string, rows: FixedIncomeIdentifierMatch[]) {
  await batchInsert(client, 'trump_oge_fixed_income_identifiers', [
    'cache_version',
    'id',
    'asset_type',
    'status',
    'resolved_figi',
    'issuer_context_ticker',
    'total_midpoint',
    'row_data',
  ], rows.map((row) => [
    cacheVersion,
    row.id,
    row.assetType,
    row.status,
    row.resolvedFigi,
    row.issuerContextTicker,
    row.totalMidpoint,
    JSON.stringify(row),
  ]));
}

async function insertInstrumentIdentities(client: PoolClient, cacheVersion: string, rows: InstrumentIdentity[]) {
  await batchInsert(client, 'trump_oge_instrument_identities', [
    'cache_version',
    'id',
    'asset_type',
    'sector',
    'reference_status',
    'review_status',
    'source_reliability',
    'review_priority',
    'row_data',
  ], rows.map((row) => [
    cacheVersion,
    row.id,
    row.assetType,
    row.sector,
    row.referenceStatus,
    row.reviewStatus,
    row.sourceReliability,
    row.reviewPriority,
    JSON.stringify(row),
  ]));
}

async function insertFinancialDisclosureReports(client: PoolClient, cacheVersion: string, rows: FinancialDisclosureReport[]) {
  await batchInsert(client, 'trump_oge_financial_disclosure_reports', [
    'cache_version',
    'id',
    'filed_date',
    'report_year',
    'filing_type',
    'source_reliability',
    'row_data',
  ], rows.map((row) => [
    cacheVersion,
    row.id,
    dateOrNull(row.filedDate),
    row.reportYear,
    row.filingType,
    row.sourceReliability,
    JSON.stringify(row),
  ]));
}

async function insertAssetIncomeHoldings(client: PoolClient, cacheVersion: string, rows: AssetIncomeHolding[]) {
  await batchInsert(client, 'trump_oge_asset_income_holdings', [
    'cache_version',
    'id',
    'asset_type',
    'sector',
    'source_reliability',
    'value_midpoint',
    'income_midpoint',
    'row_data',
  ], rows.map((row) => [
    cacheVersion,
    row.id,
    row.assetType,
    row.sector,
    row.sourceReliability,
    row.value.midpoint,
    row.income.midpoint,
    JSON.stringify(row),
  ]));
}

async function insertLiabilities(client: PoolClient, cacheVersion: string, rows: Liability[]) {
  await batchInsert(client, 'trump_oge_liabilities', [
    'cache_version',
    'id',
    'source_reliability',
    'amount_midpoint',
    'row_data',
  ], rows.map((row) => [
    cacheVersion,
    row.id,
    row.sourceReliability,
    row.amount.midpoint,
    JSON.stringify(row),
  ]));
}

async function insertYearlyExposureSummaries(client: PoolClient, cacheVersion: string, rows: YearlyExposureSummary[]) {
  await batchInsert(client, 'trump_oge_yearly_exposure_summaries', [
    'cache_version',
    'year',
    'row_data',
  ], rows.map((row) => [
    cacheVersion,
    row.year,
    JSON.stringify(row),
  ]));
}

async function batchInsert(
  client: PoolClient,
  table: string,
  columns: string[],
  rows: unknown[][]
): Promise<void> {
  if (rows.length === 0) return;
  const batchSize = 300;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const chunk = rows.slice(offset, offset + batchSize);
    const values: unknown[] = [];
    const groups = chunk.map((row) => {
      const placeholders = row.map((value) => {
        values.push(value);
        return `$${values.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    await client.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${groups.join(', ')}`,
      values
    );
  }
}

function parseJsonValue<T>(value: T | string): T {
  return typeof value === 'string' ? JSON.parse(value) as T : value;
}

function dateOrNull(value: string | null | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function yearOrNull(value: string | null | undefined): number | null {
  const year = value?.slice(0, 4);
  const parsed = Number(year);
  return Number.isFinite(parsed) ? parsed : null;
}
