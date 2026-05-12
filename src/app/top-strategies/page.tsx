import { TopStrategiesPage } from '../../screens/TopStrategiesPage';
import { listEndorsedStrategies } from '../../services/thoon-data-service';

export const dynamic = 'force-dynamic';

export default function TopStrategiesRoute() {
  return <TopStrategiesPage endorsedStrategies={listEndorsedStrategies()} />;
}
