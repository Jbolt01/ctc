import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import EquitiesTradingPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('lightweight-charts', () => {
  const chartApi = {
    addSeries: jest.fn(() => ({
      setData: jest.fn(),
    })),
    timeScale: () => ({ fitContent: jest.fn() }),
    removeSeries: jest.fn(),
    applyOptions: jest.fn(),
    remove: jest.fn(),
  };
  return {
    createChart: jest.fn(() => chartApi),
    AreaSeries: 'AreaSeries',
    LineSeries: 'LineSeries',
    ColorType: { Solid: 'solid' },
    CrosshairMode: { Magnet: 'magnet' },
  };
},{ virtual: true });

jest.mock('../../../lib/api', () => ({
  fetchSymbols: jest.fn(),
  fetchPositions: jest.fn(),
  fetchTrades: jest.fn(),
  fetchMarketTrades: jest.fn(),
  fetchAllOrders: jest.fn(),
  placeOrder: jest.fn(),
  cancelOrder: jest.fn(),
}));

jest.mock('../../../hooks/useMarketData', () => ({
  useMarketData: jest.fn(),
}));

const { fetchSymbols, fetchPositions, fetchTrades, fetchMarketTrades, fetchAllOrders } = require('../../../lib/api');
const { useMarketData } = require('../../../hooks/useMarketData');

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={client}>
      <EquitiesTradingPage />
    </QueryClientProvider>,
  );
}

describe('EquitiesTradingPage', () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as any).ResizeObserver = ResizeObserverMock;
    window.open = jest.fn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).localStorage = {
      _store: new Map<string, string>(),
      getItem(key: string) { return this._store.get(key) ?? null; },
      setItem(key: string, value: string) { this._store.set(key, value); },
      removeItem(key: string) { this._store.delete(key); },
      clear() { this._store.clear(); },
    };
    localStorage.setItem('apiKey', 'test');
    localStorage.setItem('user', JSON.stringify({ id: 'u1', email: 'user@example.com', name: 'Trader' }));
    localStorage.setItem('teams', JSON.stringify([{ id: 't1', name: 'Alpha Fund', role: 'admin' }]));

    (fetchSymbols as jest.Mock).mockResolvedValue({
      symbols: [
        { symbol: 'AAPL', name: 'Apple' },
        { symbol: 'TSLA', name: 'Tesla' },
      ],
    });
    (fetchPositions as jest.Mock).mockResolvedValue({
      positions: [
        { symbol: 'AAPL', quantity: 120, average_price: 190.12, current_price: 195.4, unrealized_pnl: 632.4 },
      ],
    });
    (fetchTrades as jest.Mock).mockResolvedValue({
      trades: [
        { trade_id: 't1', symbol: 'AAPL', quantity: 50, price: 198.2, executed_at: new Date().toISOString(), side: 'buy' },
      ],
    });
    (fetchMarketTrades as jest.Mock).mockResolvedValue({
      trades: [
        { trade_id: 'm1', symbol: 'AAPL', quantity: 20, price: 198.2, executed_at: new Date(Date.now() - 120000).toISOString(), side: 'buy' },
        { trade_id: 'm2', symbol: 'AAPL', quantity: 25, price: 199.6, executed_at: new Date(Date.now() - 60000).toISOString(), side: 'sell' },
        { trade_id: 'm3', symbol: 'AAPL', quantity: 30, price: 201.4, executed_at: new Date().toISOString(), side: 'buy' },
      ],
    });
    (fetchAllOrders as jest.Mock).mockResolvedValue({
      orders: [
        { order_id: 'o1', symbol: 'AAPL', side: 'buy', order_type: 'limit', quantity: 100, price: 197.5, status: 'pending' },
      ],
    });
    (useMarketData as jest.Mock).mockReturnValue({
      quote: { bid: 200.12, ask: 200.34 },
      orderbook: {
        bids: [
          { price: 200.12, quantity: 45 },
          { price: 199.9, quantity: 32 },
        ],
        asks: [
          { price: 200.34, quantity: 40 },
          { price: 200.56, quantity: 28 },
        ],
      },
    });
  });

  it('renders watchlist, chart metrics, and market pulse cards', async () => {
    renderPage();

    await waitFor(() => expect(fetchSymbols).toHaveBeenCalled());
    expect(await screen.findByTestId('watchlist-AAPL')).toBeInTheDocument();
    expect(screen.getByTestId('pulse-last-price')).toHaveTextContent('$201.40');
    expect(screen.getByTestId('pulse-change')).toHaveTextContent('+3.20');
    expect(screen.getByTestId('pulse-volume')).toHaveTextContent('75');
  });

  it('updates timeframe and chart mode via toolbar', async () => {
    renderPage();
    await screen.findByTestId('watchlist-AAPL');

    const button5m = screen.getByRole('button', { name: '5m' });
    await userEvent.click(button5m);
    expect(button5m).toHaveAttribute('data-active', 'true');

    const lineButton = screen.getByRole('button', { name: /Line/i });
    await userEvent.click(lineButton);
    expect(lineButton).toHaveAttribute('data-active', 'true');
  });

  it('allows collapsing and reopening the order ticket', async () => {
    renderPage();
    await screen.findByTestId('watchlist-AAPL');

    const toggle = screen.getByLabelText('Collapse order ticket');
    await userEvent.click(toggle);
    expect(screen.queryByLabelText(/Price/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Open Ticket/i }));
    await waitFor(() => expect(screen.getByLabelText(/Price/)).toBeInTheDocument());
  });

  it('surfaces team trades in the recent trades panel', async () => {
    renderPage();
    await screen.findByTestId('watchlist-AAPL');

    expect(await screen.findByText(/BOUGHT/)).toBeInTheDocument();
    expect(screen.getByText(/50 AAPL/)).toBeInTheDocument();
  });
});
