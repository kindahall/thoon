import { OrdersPage } from '../../screens/OrdersPage';
import { listFills, listOpenOrders, listOrderHistory, listPlannedOrders, listPositions } from '../../services/thoon-data-service';

export const dynamic = 'force-dynamic';

export default function OrdersRoute() {
  return <OrdersPage fills={listFills()} openOrders={listOpenOrders()} orderHistory={listOrderHistory()} plannedOrders={listPlannedOrders()} positions={listPositions()} />;
}
