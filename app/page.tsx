import { buildApiResponse, loadTrumpOgeDataset } from '@/lib/oge/data';
import { TrumpOgeDashboard } from './components/TrumpOgeDashboard';

export default async function Home() {
  const dataset = await loadTrumpOgeDataset();
  const initialData = buildApiResponse(dataset);

  return <TrumpOgeDashboard initialData={initialData} />;
}
