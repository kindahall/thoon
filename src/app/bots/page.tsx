import { BotsListPage } from '../../screens/bots/BotsListPage';
import { listAlerts, listBots, listStrategies } from '../../services/thoon-data-service';

export const dynamic = 'force-dynamic';

export default function BotsRoute() {
  return <BotsListPage alerts={listAlerts()} bots={listBots()} strategies={listStrategies()} />;
}
