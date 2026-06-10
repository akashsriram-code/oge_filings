CREATE TABLE IF NOT EXISTS trump_oge_cache_runs (
  cache_version text PRIMARY KEY,
  generated_at timestamptz NOT NULL,
  data_through date,
  cache_meta jsonb NOT NULL,
  bootstrap jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trump_oge_transactions (
  cache_version text NOT NULL REFERENCES trump_oge_cache_runs(cache_version) ON DELETE CASCADE,
  id text NOT NULL,
  transaction_date date,
  transaction_year integer,
  asset_type text,
  sector text,
  transaction_type text,
  late_filing_flag boolean,
  resolved_ticker text,
  ticker text,
  issuer_context_ticker text,
  resolved_issuer_name text,
  issuer_context_issuer_name text,
  source_url text,
  amount_midpoint double precision,
  classification_confidence double precision,
  row_data jsonb NOT NULL,
  PRIMARY KEY (cache_version, id)
);

CREATE INDEX IF NOT EXISTS trump_oge_transactions_filter_idx
  ON trump_oge_transactions (cache_version, transaction_date, asset_type, sector, transaction_type);

CREATE INDEX IF NOT EXISTS trump_oge_transactions_ticker_idx
  ON trump_oge_transactions (cache_version, resolved_ticker, issuer_context_ticker);

CREATE TABLE IF NOT EXISTS trump_oge_baseline_holdings (
  cache_version text NOT NULL REFERENCES trump_oge_cache_runs(cache_version) ON DELETE CASCADE,
  id text NOT NULL,
  asset_type text,
  sector text,
  resolved_ticker text,
  issuer_context_ticker text,
  resolved_issuer_name text,
  issuer_context_issuer_name text,
  value_midpoint double precision,
  confidence double precision,
  row_data jsonb NOT NULL,
  PRIMARY KEY (cache_version, id)
);

CREATE INDEX IF NOT EXISTS trump_oge_baseline_holdings_filter_idx
  ON trump_oge_baseline_holdings (cache_version, asset_type, sector, resolved_ticker, issuer_context_ticker);

CREATE TABLE IF NOT EXISTS trump_oge_historical_sources (
  cache_version text NOT NULL REFERENCES trump_oge_cache_runs(cache_version) ON DELETE CASCADE,
  id text NOT NULL,
  filed_date date,
  report_year integer,
  filing_type text,
  source_reliability text,
  source_url text,
  row_data jsonb NOT NULL,
  PRIMARY KEY (cache_version, id)
);

CREATE INDEX IF NOT EXISTS trump_oge_historical_sources_filter_idx
  ON trump_oge_historical_sources (cache_version, filed_date, report_year, source_reliability);

CREATE TABLE IF NOT EXISTS trump_oge_source_filings (
  cache_version text NOT NULL REFERENCES trump_oge_cache_runs(cache_version) ON DELETE CASCADE,
  id text NOT NULL,
  filed_date date,
  document_type text,
  oge_url text,
  row_data jsonb NOT NULL,
  PRIMARY KEY (cache_version, id)
);

CREATE TABLE IF NOT EXISTS trump_oge_events (
  cache_version text NOT NULL REFERENCES trump_oge_cache_runs(cache_version) ON DELETE CASCADE,
  id text NOT NULL,
  event_date date,
  event_year integer,
  category text,
  importance integer,
  row_data jsonb NOT NULL,
  PRIMARY KEY (cache_version, id)
);

CREATE INDEX IF NOT EXISTS trump_oge_events_filter_idx
  ON trump_oge_events (cache_version, event_date, category);

CREATE TABLE IF NOT EXISTS trump_oge_trump_index_entries (
  cache_version text NOT NULL REFERENCES trump_oge_cache_runs(cache_version) ON DELETE CASCADE,
  id text NOT NULL,
  asset_type text,
  sector text,
  resolved_ticker text,
  issuer_context_ticker text,
  resolved_issuer_name text,
  issuer_context_issuer_name text,
  source_reliability text,
  score double precision,
  current_midpoint double precision,
  row_data jsonb NOT NULL,
  PRIMARY KEY (cache_version, id)
);

CREATE INDEX IF NOT EXISTS trump_oge_index_filter_idx
  ON trump_oge_trump_index_entries (cache_version, asset_type, sector, source_reliability, score DESC);

CREATE TABLE IF NOT EXISTS trump_oge_trump_index_rollups (
  cache_version text NOT NULL REFERENCES trump_oge_cache_runs(cache_version) ON DELETE CASCADE,
  id text NOT NULL,
  rollup_type text,
  key text,
  row_data jsonb NOT NULL,
  PRIMARY KEY (cache_version, id)
);

CREATE TABLE IF NOT EXISTS trump_oge_sector_summaries (
  cache_version text NOT NULL REFERENCES trump_oge_cache_runs(cache_version) ON DELETE CASCADE,
  id text NOT NULL,
  asset_type text,
  sector text,
  row_data jsonb NOT NULL,
  PRIMARY KEY (cache_version, id)
);

CREATE TABLE IF NOT EXISTS trump_oge_review_queue (
  cache_version text NOT NULL REFERENCES trump_oge_cache_runs(cache_version) ON DELETE CASCADE,
  id text NOT NULL,
  severity text,
  kind text,
  row_data jsonb NOT NULL,
  PRIMARY KEY (cache_version, id)
);

CREATE TABLE IF NOT EXISTS trump_oge_security_enrichments (
  cache_version text NOT NULL REFERENCES trump_oge_cache_runs(cache_version) ON DELETE CASCADE,
  id text NOT NULL,
  resolved_ticker text,
  issuer_context_ticker text,
  row_data jsonb NOT NULL,
  PRIMARY KEY (cache_version, id)
);

CREATE TABLE IF NOT EXISTS trump_oge_financial_disclosure_reports (
  cache_version text NOT NULL REFERENCES trump_oge_cache_runs(cache_version) ON DELETE CASCADE,
  id text NOT NULL,
  filed_date date,
  report_year integer,
  filing_type text,
  source_reliability text,
  row_data jsonb NOT NULL,
  PRIMARY KEY (cache_version, id)
);

CREATE TABLE IF NOT EXISTS trump_oge_asset_income_holdings (
  cache_version text NOT NULL REFERENCES trump_oge_cache_runs(cache_version) ON DELETE CASCADE,
  id text NOT NULL,
  asset_type text,
  sector text,
  source_reliability text,
  value_midpoint double precision,
  income_midpoint double precision,
  row_data jsonb NOT NULL,
  PRIMARY KEY (cache_version, id)
);

CREATE TABLE IF NOT EXISTS trump_oge_liabilities (
  cache_version text NOT NULL REFERENCES trump_oge_cache_runs(cache_version) ON DELETE CASCADE,
  id text NOT NULL,
  source_reliability text,
  amount_midpoint double precision,
  row_data jsonb NOT NULL,
  PRIMARY KEY (cache_version, id)
);

CREATE TABLE IF NOT EXISTS trump_oge_yearly_exposure_summaries (
  cache_version text NOT NULL REFERENCES trump_oge_cache_runs(cache_version) ON DELETE CASCADE,
  year integer NOT NULL,
  row_data jsonb NOT NULL,
  PRIMARY KEY (cache_version, year)
);
