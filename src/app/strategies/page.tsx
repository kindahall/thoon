import { StrategiesListPage } from '../../screens/strategies/StrategiesListPage';
import { listStrategies } from '../../services/thoon-data-service';

export const dynamic = 'force-dynamic';

export default function StrategiesRoute() {
  return <StrategiesListPage strategies={listStrategies()} />;
}
