import { TrumpOgeDashboard } from './components/TrumpOgeDashboard';
import { loadTrumpOgeBootstrap } from '@/lib/oge/data';
import { loadTrumpOgeBootstrapFromPostgres } from '@/lib/oge/postgres';

export default async function Home() {
  const bootstrap = await loadTrumpOgeBootstrapFromPostgres() || await loadTrumpOgeBootstrap();
  return <TrumpOgeDashboard initialData={bootstrap} />;
}
