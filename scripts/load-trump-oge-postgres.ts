import { loadTrumpOgeDataset } from '../lib/oge/data';
import { isPostgresConfigured, syncTrumpOgeDatasetToPostgres } from '../lib/oge/postgres';

async function main() {
  if (!isPostgresConfigured()) {
    throw new Error('TRUMP_OGE_DATABASE_URL is not set. Add the Neon pooled connection string before loading Trump OGE caches into Postgres.');
  }

  const dataset = await loadTrumpOgeDataset();
  const synced = await syncTrumpOgeDatasetToPostgres(dataset);
  console.log(JSON.stringify({
    postgresSynced: synced,
    cacheVersion: dataset.cacheMeta.generatedAt,
    transactionCount: dataset.transactions.length,
    trumpIndexCount: dataset.trumpIndex.length,
    historicalSourceCount: dataset.historicalSources.length,
    eventCount: dataset.events.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
