import { TrumpOgeDashboard } from './components/TrumpOgeDashboard';
import { loadTrumpOgeBootstrap } from '@/lib/oge/data';
import { loadTrumpOgeBootstrapFromPostgres } from '@/lib/oge/postgres';

// Enable ISR - revalidate every 6 hours (21600 seconds)
// OGE filings update infrequently, so aggressive caching improves load times
export const revalidate = 21600;

export default async function Home() {
  const bootstrap = await loadTrumpOgeBootstrapFromPostgres() || await loadTrumpOgeBootstrap();
  return <TrumpOgeDashboard initialData={bootstrap} />;
}
