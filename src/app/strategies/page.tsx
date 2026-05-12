import { StrategiesListPage } from '../../screens/strategies/StrategiesListPage';
import { listEndorsedStrategies, listStrategies } from '../../services/thoon-data-service';

export const dynamic = 'force-dynamic';

export default function StrategiesRoute() {
  return <StrategiesListPage endorsedStrategies={listEndorsedStrategies()} strategies={listStrategies()} />;
}
