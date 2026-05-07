'use client';

import { ClipboardList, Download, NotebookText, ShieldCheck, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Button, Card, EmptyState, HelpPopover, Modal } from '../components/ui';
import { patchJson, postJson } from '../services/api-client';
import type { Fill, Order, Position } from '../types/trading';
import { formatCompactUsd, formatUsd } from '../utils/format';

type OrdersPageProps = {
  fills: Fill[];
  openOrders: Order[];
  orderHistory: Order[];
  plannedOrders: Order[];
  positions: Position[];
};
type OrdersTab = 'positions' | 'orders' | 'history' | 'fills';
type OrdersConfirmation = { kind: 'cancel-order'; order: Order } | { kind: 'close-position'; position: Position } | null;

export function OrdersPage({ fills: initialFills, openOrders: initialOpenOrders, orderHistory: initialOrderHistory, plannedOrders: initialPlannedOrders, positions: initialPositions }: OrdersPageProps) {
  const [positions, setPositions] = useState(initialPositions);
  const [openOrders, setOpenOrders] = useState(initialOpenOrders);
  const [plannedOrders, setPlannedOrders] = useState(initialPlannedOrders);
  const [fills, setFills] = useState(initialFills);
  const [orderHistory, setOrderHistory] = useState(initialOrderHistory);
  const [activeTab, setActiveTab] = useState<OrdersTab>('positions');
  const [closeAllOpen, setCloseAllOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<OrdersConfirmation>(null);
  const [actionStatus, setActionStatus] = useState('Ready');
  const balance = 25000;
  const unrealizedPnl = positions.reduce((sum, position) => sum + position.pnl, 0);
  const realizedPnl = orderHistory.filter((order) => order.status === 'filled').length > 0 ? fills.reduce((sum, fill) => sum - fill.fee, 0) : 0;
  const marginUsed = positions.reduce((sum, position) => sum + position.margin, 0);
  const availableBalance = balance + realizedPnl + unrealizedPnl - marginUsed;

  async function closeAll() {
    setActionStatus('Closing');

    try {
      const result = await postJson<{ fills: Fill[]; orders: Order[] }>('/api/orders/close-all');
      setOrderHistory((currentHistory) => [...result.orders, ...openOrders, ...plannedOrders, ...currentHistory]);
      setFills((currentFills) => [...result.fills, ...currentFills]);
      setPositions([]);
      setOpenOrders([]);
      setPlannedOrders([]);
      setActionStatus('Closed');
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Close failed');
    }
  }

  async function closePosition(position: Position) {
    setActionStatus('Closing position');

    try {
      const result = await postJson<{ fill: Fill; order: Order }>(`/api/positions/${encodeURIComponent(position.id)}/close`);
      setPositions((currentPositions) => currentPositions.filter((item) => item.id !== position.id));
      setOrderHistory((currentHistory) => [result.order, ...currentHistory]);
      setFills((currentFills) => [result.fill, ...currentFills]);
      setActionStatus('Position closed');
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Close failed');
    }
  }

  function exportOrders() {
    const payload = {
      exportedAt: new Date().toISOString(),
      fills,
      openOrders,
      orderHistory,
      plannedOrders,
      positions,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = href;
    link.download = `thoon-orders-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(href);
    setActionStatus('Exported');
  }

  async function cancelOrder(order: Order) {
    setActionStatus('Cancelling');

    try {
      const cancelled = await patchJson<Order>(`/api/orders/${encodeURIComponent(order.id)}`, { status: 'cancelled' });
      setOpenOrders((currentOrders) => currentOrders.filter((item) => item.id !== order.id));
      setPlannedOrders((currentOrders) => currentOrders.filter((item) => item.id !== order.id));
      setOrderHistory((currentHistory) => [cancelled, ...currentHistory]);
      setActionStatus('Cancelled');
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Cancel failed');
    }
  }

  return (
    <section className="orders-page" aria-label="Orders workspace">
      <div className="workspace-header workspace-header--compact">
        <div>
          <h1>Orders</h1>
          <p>Monitor positions, pending orders, fills and history.</p>
        </div>
        <div className="workspace-header__right">
          <span className="sr-only" aria-live="polite">{actionStatus}</span>
          <Button icon={<X size={15} />} onClick={() => setCloseAllOpen(true)} size="sm" variant="danger">
            Close All
          </Button>
          <Button icon={<Download size={15} />} onClick={exportOrders} size="sm" variant="ghost">
            Export
          </Button>
          <Link className="ui-button ui-button--ghost ui-button--sm" href="/history">
            <span className="ui-button__icon">
              <NotebookText size={15} />
            </span>
            <span>Journal</span>
          </Link>
          <HelpPopover items={['Close and cancel actions require confirmation.', 'Live execution remains gated by risk checks.']} title="Orders" />
        </div>
      </div>

      <div className="orders-source-strip">
        <ShieldCheck size={15} />
        <span>Paper account state. Seed positions are hidden; only orders created in this workspace appear here.</span>
      </div>

      <div className="orders-summary-grid">
        <OrderSummary label="Paper Balance" value={formatCompactUsd(balance)} />
        <OrderSummary label="Unrealized" tone={unrealizedPnl >= 0 ? 'positive' : 'negative'} value={formatUsd(unrealizedPnl)} />
        <OrderSummary label="Realized" tone="positive" value={formatUsd(realizedPnl)} />
        <OrderSummary label="Margin Used" value={formatCompactUsd(marginUsed)} />
        <OrderSummary label="Available" tone="positive" value={formatCompactUsd(availableBalance)} />
      </div>

      <div className="orders-tabs" aria-label="Orders tabs">
        <button className={activeTab === 'positions' ? 'is-active' : undefined} onClick={() => setActiveTab('positions')} type="button">
          Open Positions
        </button>
        <button className={activeTab === 'orders' ? 'is-active' : undefined} onClick={() => setActiveTab('orders')} type="button">Open Orders</button>
        <button className={activeTab === 'history' ? 'is-active' : undefined} onClick={() => setActiveTab('history')} type="button">History</button>
        <button className={activeTab === 'fills' ? 'is-active' : undefined} onClick={() => setActiveTab('fills')} type="button">Fills</button>
      </div>

      <div className="orders-grid">
        {activeTab === 'positions' ? <Card className="orders-card orders-card--wide">
          <div className="market-section-header">
            <h2>Open Positions</h2>
            <span className="orders-count">{positions.length}</span>
          </div>
          <div className="orders-table orders-table--positions">
            <div className="orders-table__header">
              <span>Symbol</span>
              <span>Side</span>
              <span>Size</span>
              <span>Entry</span>
              <span>Mark</span>
              <span>PnL</span>
              <span>Margin</span>
              <span>TP/SL</span>
              <span>Action</span>
            </div>
            {positions.length > 0 ? (
              positions.map((position) => <PositionRow key={position.id} onClose={(nextPosition) => setConfirmation({ kind: 'close-position', position: nextPosition })} position={position} />)
            ) : (
              <EmptyState
                actionHref="/charts"
                actionLabel="Open Chart"
                description="Positions appear after paper or live execution."
                icon={<ClipboardList size={20} />}
                secondaryActionHref="/history"
                secondaryActionLabel="Journal"
                title="No open positions"
              />
            )}
          </div>
        </Card> : null}

        {activeTab === 'orders' ? <Card className="orders-card orders-card--wide">
          <div className="market-section-header">
            <h2>Open Orders</h2>
            <span className="orders-count">{openOrders.length + plannedOrders.length}</span>
          </div>
          <div className="orders-list-table">
            {[...openOrders, ...plannedOrders].length > 0 ? (
              [...openOrders, ...plannedOrders].map((order) => <OrderCompactRow key={order.id} onCancel={(nextOrder) => setConfirmation({ kind: 'cancel-order', order: nextOrder })} order={order} />)
            ) : (
              <EmptyState
                actionHref="/charts"
                actionLabel="Open Chart"
                description="Pending orders will appear here."
                icon={<ClipboardList size={20} />}
                secondaryActionHref="/alerts"
                secondaryActionLabel="Create Alert"
                title="No open orders"
              />
            )}
          </div>
        </Card> : null}

        {activeTab === 'fills' ? <Card className="orders-card orders-card--wide">
          <div className="market-section-header">
            <h2>Recent Fills</h2>
            <span className="orders-count">{fills.length}</span>
          </div>
          <div className="orders-list-table">
            {fills.length > 0 ? (
              fills.map((fill) => <FillRow fill={fill} key={fill.id} />)
            ) : (
              <EmptyState actionHref="/charts" actionLabel="Open Chart" description="Fills appear after execution." icon={<ClipboardList size={20} />} title="No fills" />
            )}
          </div>
        </Card> : null}

        {activeTab === 'history' ? <Card className="orders-card orders-card--wide">
          <div className="market-section-header">
            <h2>Order History</h2>
            <span className="orders-count">{orderHistory.length}</span>
          </div>
          <div className="orders-table orders-table--history">
            <div className="orders-table__header">
              <span>Symbol</span>
              <span>Side</span>
              <span>Type</span>
              <span>Price</span>
              <span>Size</span>
              <span>Status</span>
              <span>Opened</span>
              <span>Exchange</span>
            </div>
            {orderHistory.length > 0 ? (
              orderHistory.map((order) => <HistoryRow key={order.id} order={order} />)
            ) : (
              <EmptyState
                actionHref="/charts"
                actionLabel="Open Chart"
                description="Closed and cancelled orders will appear here."
                icon={<ClipboardList size={20} />}
                secondaryActionHref="/history"
                secondaryActionLabel="Journal"
                title="No order history"
              />
            )}
          </div>
        </Card> : null}
      </div>

      <Modal onClose={() => setCloseAllOpen(false)} open={closeAllOpen} title="Close All Positions">
        <div className="confirmation-modal-body">
          <p>Close every open position and cancel pending planned orders in paper mode.</p>
          <div>
            <Button onClick={() => setCloseAllOpen(false)} size="sm" variant="ghost">
              Cancel
            </Button>
            <Button
              onClick={() => {
                setCloseAllOpen(false);
                void closeAll();
              }}
              size="sm"
              variant="danger"
            >
              Confirm
            </Button>
          </div>
        </div>
      </Modal>

      <Modal onClose={() => setConfirmation(null)} open={confirmation !== null} title={confirmation?.kind === 'close-position' ? 'Close Position' : 'Cancel Order'}>
        <div className="confirmation-modal-body">
          {confirmation?.kind === 'close-position' ? (
            <p>
              Close {confirmation.position.side} {confirmation.position.symbol} at {formatUsd(confirmation.position.markPrice)}. Current PnL: {formatUsd(confirmation.position.pnl)}.
            </p>
          ) : null}
          {confirmation?.kind === 'cancel-order' ? (
            <p>
              Cancel {confirmation.order.side} {confirmation.order.symbol} {confirmation.order.type} order at {formatUsd(confirmation.order.price)}.
            </p>
          ) : null}
          <div>
            <Button onClick={() => setConfirmation(null)} size="sm" variant="ghost">
              Cancel
            </Button>
            <Button
              onClick={() => {
                const nextConfirmation = confirmation;
                setConfirmation(null);

                if (nextConfirmation?.kind === 'close-position') {
                  void closePosition(nextConfirmation.position);
                } else if (nextConfirmation?.kind === 'cancel-order') {
                  void cancelOrder(nextConfirmation.order);
                }
              }}
              size="sm"
              variant="danger"
            >
              Confirm
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

function OrderSummary({ label, tone = 'neutral', value }: { label: string; tone?: 'neutral' | 'positive' | 'negative'; value: string }) {
  return (
    <Card className="orders-summary-card">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </Card>
  );
}

function PositionRow({ onClose, position }: { onClose: (position: Position) => void; position: Position }) {
  return (
    <div className="orders-table__row">
      <Link href={`/charts?pair=${encodeURIComponent(position.symbol)}`}>{position.symbol}</Link>
      <span className={position.side === 'long' ? 'positive' : 'negative'}>{position.side}</span>
      <span>{position.size}</span>
      <span>{formatUsd(position.entryPrice)}</span>
      <span>{formatUsd(position.markPrice)}</span>
      <span className={position.pnl >= 0 ? 'positive' : 'negative'}>{formatUsd(position.pnl)}</span>
      <span>{formatCompactUsd(position.margin)}</span>
      <span>
        {formatUsd(position.takeProfit)} / {formatUsd(position.stopLoss)}
      </span>
      <span className="orders-actions">
        <button onClick={() => onClose(position)} type="button">Close</button>
      </span>
    </div>
  );
}

function OrderCompactRow({ onCancel, order }: { onCancel: (order: Order) => void; order: Order }) {
  return (
    <div className="orders-compact-row">
      <div>
        <strong>{order.symbol}</strong>
        <span>
          {order.side} · {order.type}
        </span>
      </div>
      <span>{formatUsd(order.price)}</span>
      <b className={order.status === 'planned' ? 'warning' : 'neutral'}>{order.status}</b>
      <button onClick={() => onCancel(order)} type="button">Cancel</button>
    </div>
  );
}

function FillRow({ fill }: { fill: Fill }) {
  return (
    <div className="orders-compact-row">
      <div>
        <strong>{fill.symbol}</strong>
        <span>
          {fill.side} · fee {formatUsd(fill.fee)}
        </span>
      </div>
      <span>{formatUsd(fill.price)}</span>
      <b>{fill.size}</b>
      <ShieldCheck className="positive" size={16} />
    </div>
  );
}

function HistoryRow({ order }: { order: Order }) {
  return (
    <div className="orders-table__row">
      <span>{order.symbol}</span>
      <span className={order.side === 'buy' ? 'positive' : 'negative'}>{order.side}</span>
      <span>{order.type}</span>
      <span>{formatUsd(order.price)}</span>
      <span>{order.size}</span>
      <span>{order.status}</span>
      <span>{new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(order.createdAt))}</span>
      <span>{order.exchange}</span>
    </div>
  );
}
