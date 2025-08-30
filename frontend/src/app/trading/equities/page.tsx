"use client";
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import NavBar from '../../../components/NavBar';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  TimeScale,
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { 
  fetchSymbols, 
  fetchPositions, 
  fetchTrades,
  fetchMarketTrades,
  fetchAllOrders,
  placeOrder as apiPlaceOrder, 
  cancelOrder as apiCancelOrder,
  type PositionsResponse, 
  type TradeRecord,
  type OrderSummary
} from '../../../lib/api';
import { useMarketData } from '../../../hooks/useMarketData';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, TimeScale);

// Custom hooks
function useSymbols() {
  return useQuery({ queryKey: ['symbols'], queryFn: fetchSymbols });
}

function usePositions() {
  return useQuery({ queryKey: ['positions'], queryFn: fetchPositions, refetchInterval: 2000 });
}

function useTrades(symbol: string) {
  return useQuery({ 
    queryKey: ['trades', symbol], 
    queryFn: () => fetchTrades(symbol),
    refetchInterval: 1000 
  });
}

function useMarketTrades(symbol: string) {
  return useQuery({ 
    queryKey: ['marketTrades', symbol], 
    queryFn: () => fetchMarketTrades(symbol),
    refetchInterval: 1000 
  });
}

function useAllOrders(symbol: string) {
  return useQuery({ 
    queryKey: ['orders', 'all', symbol], 
    queryFn: () => fetchAllOrders(undefined, symbol),
    refetchInterval: 1000 
  });
}

export default function EquitiesTradingPage() {
  const router = useRouter();
  const [symbol, setSymbol] = useState('AAPL');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [type, setType] = useState<'market' | 'limit'>('limit');
  const [qty, setQty] = useState(100);
  const [price, setPrice] = useState<number | ''>('');
  const [showOrderForm, setShowOrderForm] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userInfo, setUserInfo] = useState<{user: any, teams: any[]} | null>(null);
  
  // Check authentication on mount
  useEffect(() => {
    const apiKey = localStorage.getItem('apiKey');
    const user = localStorage.getItem('user');
    const teams = localStorage.getItem('teams');
    
    if (!apiKey || !user || !teams) {
      router.push('/login');
      return;
    }
    
    setIsAuthenticated(true);
    setUserInfo({
      user: JSON.parse(user),
      teams: JSON.parse(teams)
    });
  }, [router]);
  
  const qc = useQueryClient();
  const { data: symbols } = useSymbols();
  const { quote, orderbook: ob } = useMarketData(symbol, ['quotes', 'orderbook', 'trades']);
  const { data: positions } = usePositions();
  const { data: trades } = useTrades(symbol);  // Team-filtered trades for recent trades panel
  const { data: marketTrades } = useMarketTrades(symbol);  // All market trades for price chart
  const { data: allOrders } = useAllOrders(symbol);

  // Mutations for order operations
  const placeOrderMutation = useMutation({
    mutationFn: apiPlaceOrder,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['positions'] });
      qc.invalidateQueries({ queryKey: ['trades'] });
      qc.invalidateQueries({ queryKey: ['marketTrades'] });
      setPrice('');
      setQty(100);
    }
  });

  const cancelOrderMutation = useMutation({
    mutationFn: apiCancelOrder,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
    }
  });

  // Auto-fill price from order book
  useEffect(() => {
    if (ob && type === 'limit' && !price) {
      if (side === 'buy' && ob.bids?.[0]?.price) {
        setPrice(ob.bids[0].price);
      } else if (side === 'sell' && ob.asks?.[0]?.price) {
        setPrice(ob.asks[0].price);
      }
    }
  }, [ob, side, type, price]);

  const handleLadderClick = (clickedPrice: number, clickedSide: 'buy' | 'sell') => {
    setPrice(clickedPrice);
    setSide(clickedSide);
    setShowOrderForm(true);
  };

  const handlePlaceOrder = async () => {
    if (!qty || (type === 'limit' && !price)) return;
    
    await placeOrderMutation.mutateAsync({ 
      symbol, 
      side, 
      order_type: type, 
      quantity: qty, 
      ...(type === 'limit' ? { price: Number(price) } : {}) 
    });
  };

  const handleCancelOrder = async (orderId: string) => {
    await cancelOrderMutation.mutateAsync(orderId);
  };

  // Show loading screen while checking authentication
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-gray-900 to-black flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400 mx-auto"></div>
          <p className="text-slate-400 mt-4">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-gray-900 to-black">
      <NavBar />
      <main className="mx-auto max-w-[1920px] px-6 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between border-b border-gray-800 pb-6">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-white">
              <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                TRADING TERMINAL
              </span>
            </h1>
            <p className="mt-2 text-gray-400 font-mono tracking-wide">
              REAL-TIME MARKET DATA • ADVANCED ORDER MANAGEMENT • LIVE EXECUTION
            </p>
            {userInfo && userInfo.teams.length > 0 && (
              <div className="mt-3 flex items-center space-x-4">
                <div className="text-sm text-cyan-400 font-mono">
                  Trading as: <span className="text-white font-semibold">{userInfo.teams[0].name}</span>
                </div>
                <div className="text-xs text-gray-500 px-2 py-1 bg-gray-800 rounded">
                  {userInfo.teams[0].role}
                </div>
              </div>
            )}
          </div>
          <select 
            className="rounded-lg border border-gray-700 bg-gray-800/50 backdrop-blur-sm px-6 py-3 text-lg font-mono font-medium text-white shadow-lg transition-all hover:border-blue-500 hover:bg-gray-800/70 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 focus:outline-none" 
            value={symbol} 
            onChange={(e) => setSymbol(e.target.value)}
          >
            {(symbols?.symbols ?? [{ symbol: 'AAPL', name: 'Apple Inc.' }]).map((s) => (
              <option key={s.symbol} value={s.symbol} className="bg-gray-800 text-white">
                {s.symbol} — {s.name}
              </option>
            ))}
          </select>
        </div>

        {/* Main Trading Grid */}
        <div className="grid gap-6 lg:grid-cols-4">
          {/* Left Column - Charts */}
          <div className="space-y-6 lg:col-span-2">
            <PriceChart trades={marketTrades?.trades || []} symbol={symbol} />
            <OrderBookLadder 
              orderbook={ob} 
              quote={quote}
              onPriceClick={handleLadderClick}
              symbol={symbol}
            />
          </div>

          {/* Center Column - Order Entry */}
          <div className="space-y-6">
            <OrderEntryPanel
              symbol={symbol}
              side={side}
              setSide={setSide}
              type={type}
              setType={setType}
              qty={qty}
              setQty={setQty}
              price={price}
              setPrice={setPrice}
              onPlaceOrder={handlePlaceOrder}
              isLoading={placeOrderMutation.isPending}
              show={showOrderForm}
              onToggle={() => setShowOrderForm(!showOrderForm)}
            />
            <PositionsPanel positions={positions} />
          </div>

          {/* Right Column - Orders & Trades */}
          <div className="space-y-6">
            <OrdersPanel 
              orders={allOrders?.orders || []}
              onCancelOrder={handleCancelOrder}
              cancelLoading={cancelOrderMutation.isPending}
            />
            <TradesPanel trades={trades?.trades || []} />
          </div>
        </div>
      </main>
    </div>
  );
}

// Price Chart Component
function PriceChart({ trades, symbol }: { trades: TradeRecord[]; symbol: string }) {
  const chartData = useMemo(() => {
    if (!trades.length) return null;
    
    const sortedTrades = [...trades].sort((a, b) => 
      new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime()
    );

    return {
      labels: sortedTrades.map(t => new Date(t.executed_at)),
      datasets: [{
        label: 'Trade Price',
        data: sortedTrades.map(t => ({ x: new Date(t.executed_at), y: t.price })),
        borderColor: '#06B6D4',
        backgroundColor: 'rgba(6, 182, 212, 0.15)',
        borderWidth: 3,
        pointRadius: 5,
        pointHoverRadius: 8,
        pointBackgroundColor: '#06B6D4',
        pointBorderColor: '#0891B2',
        pointBorderWidth: 2,
        pointHoverBackgroundColor: '#67E8F9',
        pointHoverBorderColor: '#0891B2',
        tension: 0.3,
        fill: true,
      }]
    };
  }, [trades]);

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        type: 'time' as const,
        time: { 
          displayFormats: { minute: 'HH:mm' },
          tooltipFormat: 'MMM d, HH:mm:ss'
        },
        grid: { 
          color: 'rgba(59, 130, 246, 0.1)',
          borderColor: 'rgba(59, 130, 246, 0.2)'
        },
        ticks: { 
          color: 'rgba(156, 163, 175, 0.8)',
          font: { family: 'monospace', size: 11 }
        },
        border: { color: 'rgba(59, 130, 246, 0.2)' }
      },
      y: {
        grid: { 
          color: 'rgba(59, 130, 246, 0.1)',
          borderColor: 'rgba(59, 130, 246, 0.2)'
        },
        ticks: { 
          color: 'rgba(156, 163, 175, 0.8)',
          font: { family: 'monospace', size: 11 },
          callback: (value: any) => `$${Number(value).toFixed(2)}`
        },
        border: { color: 'rgba(59, 130, 246, 0.2)' }
      }
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(17, 24, 39, 0.95)',
        titleColor: '#60A5FA',
        bodyColor: '#E5E7EB',
        borderColor: '#3B82F6',
        borderWidth: 1,
        cornerRadius: 8,
        titleFont: { family: 'monospace', size: 12 },
        bodyFont: { family: 'monospace', size: 12 },
        callbacks: {
          label: (context: any) => `PRICE: $${context.parsed.y.toFixed(2)}`,
          title: (context: any) => `${context[0].label}`
        }
      }
    },
    interaction: { intersect: false, mode: 'index' as const }
  };

  return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-900/50 backdrop-blur-sm p-6 shadow-2xl">
      <div className="mb-4 flex items-center justify-between border-b border-gray-700/30 pb-3">
        <h2 className="text-xl font-bold text-white font-mono tracking-wide">
          PRICE CHART
        </h2>
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <div className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse"></div>
            <span className="text-sm text-cyan-400 font-mono">{trades.length} TRADES</span>
          </div>
          <div className="h-4 w-px bg-gray-700"></div>
          <span className="text-xs text-gray-500 font-mono">LIVE</span>
        </div>
      </div>
      <div className="h-72">
        {chartData ? (
          <Line data={chartData} options={chartOptions} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="h-16 w-16 mx-auto mb-4 rounded-full border-2 border-gray-700 flex items-center justify-center">
                <svg className="h-8 w-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <p className="text-gray-500 font-mono text-sm">NO TRADE DATA AVAILABLE</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Order Book Ladder Component
function OrderBookLadder({ 
  orderbook, 
  quote, 
  onPriceClick, 
  symbol 
}: { 
  orderbook: any; 
  quote: any; 
  onPriceClick: (price: number, side: 'buy' | 'sell') => void;
  symbol: string;
}) {
  const ladderData = useMemo(() => {
    if (!orderbook) return { bids: [], asks: [], spread: null };
    
    const bids = orderbook.bids || [];
    const asks = orderbook.asks || [];
    const spread = asks[0] && bids[0] ? asks[0].price - bids[0].price : null;
    
    return { bids, asks, spread };
  }, [orderbook]);

    return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-900/50 backdrop-blur-sm shadow-2xl overflow-hidden">
      <div className="bg-gradient-to-r from-gray-800/80 to-gray-900/80 p-4 border-b border-gray-700/50">
        <h2 className="text-xl font-bold text-white font-mono tracking-wide">ORDER BOOK</h2>
        {quote && (
          <div className="mt-3 flex items-center space-x-6 text-sm">
            <div className="flex items-center space-x-2">
              <div className="h-2 w-2 rounded-full bg-emerald-400"></div>
              <span className="text-emerald-400 font-mono font-medium">
                BID: ${quote.bid?.toFixed(2) || 'N/A'}
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="h-2 w-2 rounded-full bg-red-400"></div>
              <span className="text-red-400 font-mono font-medium">
                ASK: ${quote.ask?.toFixed(2) || 'N/A'}
              </span>
            </div>
            {ladderData.spread && (
              <>
                <div className="h-4 w-px bg-gray-600"></div>
                <span className="text-cyan-400 font-mono text-xs">
                  SPREAD: ${ladderData.spread.toFixed(2)}
                </span>
              </>
            )}
          </div>
        )}
            </div>

      <div className="max-h-96 overflow-y-auto">
        {/* Asks (Sell Orders) */}
        <div className="space-y-0.5 p-3 bg-gradient-to-b from-red-950/20 to-transparent">
          <div className="text-xs font-mono text-red-400 mb-2 tracking-wider">ASKS</div>
          {ladderData.asks.slice(0, 10).reverse().map((ask: any, idx: number) => (
            <div
              key={`ask-${ask.price}`}
              className="group flex cursor-pointer items-center justify-between rounded-md p-2 transition-all hover:bg-red-900/30 hover:shadow-lg hover:shadow-red-500/10 border border-transparent hover:border-red-500/30"
              onClick={() => onPriceClick(ask.price, 'sell')}
            >
              <div className="flex items-center justify-between w-full">
                <span className="font-mono text-sm font-bold text-red-400 min-w-[80px]">
                  ${ask.price.toFixed(2)}
                </span>
                <span className="font-mono text-xs text-gray-400 min-w-[60px] text-right">{ask.quantity.toLocaleString()}</span>
              </div>
              <div className="ml-3 flex-1 relative">
                <div 
                  className="h-1.5 bg-gradient-to-r from-red-500/60 to-red-400/40 transition-all group-hover:from-red-400 group-hover:to-red-300 rounded-full"
                  style={{ width: `${Math.min(100, (ask.quantity / Math.max(...ladderData.asks.map((a: any) => a.quantity))) * 100)}%` }}
                />
              </div>
            </div>
          ))}
            </div>

        {/* Spread Indicator */}
        {ladderData.spread && (
          <div className="bg-gray-800/50 py-3 text-center border-y border-gray-700/30">
            <span className="text-xs font-mono text-cyan-400 tracking-wider">
              SPREAD: ${ladderData.spread.toFixed(2)}
            </span>
          </div>
        )}
        
        {/* Bids (Buy Orders) */}
        <div className="space-y-0.5 p-3 bg-gradient-to-b from-emerald-950/20 to-transparent">
          <div className="text-xs font-mono text-emerald-400 mb-2 tracking-wider">BIDS</div>
          {ladderData.bids.slice(0, 10).map((bid: any, idx: number) => (
            <div
              key={`bid-${bid.price}`}
              className="group flex cursor-pointer items-center justify-between rounded-md p-2 transition-all hover:bg-emerald-900/30 hover:shadow-lg hover:shadow-emerald-500/10 border border-transparent hover:border-emerald-500/30"
              onClick={() => onPriceClick(bid.price, 'buy')}
            >
              <div className="flex items-center justify-between w-full">
                <span className="font-mono text-sm font-bold text-emerald-400 min-w-[80px]">
                  ${bid.price.toFixed(2)}
                </span>
                <span className="font-mono text-xs text-gray-400 min-w-[60px] text-right">{bid.quantity.toLocaleString()}</span>
              </div>
              <div className="ml-3 flex-1 relative">
                <div 
                  className="h-1.5 bg-gradient-to-r from-emerald-500/60 to-emerald-400/40 transition-all group-hover:from-emerald-400 group-hover:to-emerald-300 rounded-full"
                  style={{ width: `${Math.min(100, (bid.quantity / Math.max(...ladderData.bids.map((b: any) => b.quantity))) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Order Entry Panel Component
function OrderEntryPanel({
  symbol,
  side,
  setSide,
  type,
  setType,
  qty,
  setQty,
  price,
  setPrice,
  onPlaceOrder,
  isLoading,
  show,
  onToggle
}: {
  symbol: string;
  side: 'buy' | 'sell';
  setSide: (side: 'buy' | 'sell') => void;
  type: 'market' | 'limit';
  setType: (type: 'market' | 'limit') => void;
  qty: number;
  setQty: (qty: number) => void;
  price: number | '';
  setPrice: (price: number | '') => void;
  onPlaceOrder: () => void;
  isLoading: boolean;
  show: boolean;
  onToggle: () => void;
}) {
  const [focusedField, setFocusedField] = useState<string | null>(null);

    return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-900/50 backdrop-blur-sm shadow-2xl overflow-hidden">
      <div className="bg-gradient-to-r from-gray-800/80 to-gray-900/80 p-4 border-b border-gray-700/50">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white font-mono tracking-wide">ORDER ENTRY</h2>
          <button
            onClick={onToggle}
            className="rounded-lg p-2 hover:bg-gray-700/50 transition-colors border border-gray-600/30 hover:border-cyan-400/50"
          >
            <svg className={`h-5 w-5 transition-transform text-gray-400 hover:text-cyan-400 ${show ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      {show && (
        <div className="p-6 space-y-6">
          {/* Buy/Sell Toggle */}
          <div className="flex rounded-xl bg-gray-800/50 p-1 border border-gray-700/50">
            <button
              className={`flex-1 rounded-lg px-4 py-3 font-bold font-mono transition-all ${
                side === 'buy' 
                  ? 'bg-gradient-to-r from-emerald-500 to-green-500 text-black shadow-lg shadow-emerald-500/25 transform scale-105 border border-emerald-400' 
                  : 'text-gray-400 hover:text-emerald-400 hover:bg-emerald-900/20 border border-transparent'
              }`}
              onClick={() => setSide('buy')}
            >
              <div className="flex items-center justify-center space-x-2">
                <span className="text-lg">▲</span>
                <span>BUY</span>
              </div>
                  </button>
            <button
              className={`flex-1 rounded-lg px-4 py-3 font-bold font-mono transition-all ${
                side === 'sell' 
                  ? 'bg-gradient-to-r from-red-500 to-rose-500 text-white shadow-lg shadow-red-500/25 transform scale-105 border border-red-400' 
                  : 'text-gray-400 hover:text-red-400 hover:bg-red-900/20 border border-transparent'
              }`}
              onClick={() => setSide('sell')}
            >
              <div className="flex items-center justify-center space-x-2">
                <span className="text-lg">▼</span>
                <span>SELL</span>
              </div>
                  </button>
                </div>

                    {/* Order Type */}
          <div className="space-y-3">
            <label className="text-sm font-bold text-gray-300 font-mono tracking-wider">ORDER TYPE</label>
            <select
              className="w-full rounded-lg border border-gray-600 bg-gray-800/70 text-white p-3 font-mono transition-all focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 focus:outline-none hover:bg-gray-800/90"
              value={type}
              onChange={(e) => setType(e.target.value as 'market' | 'limit')}
            >
              <option value="market" className="bg-gray-800">MARKET ORDER</option>
              <option value="limit" className="bg-gray-800">LIMIT ORDER</option>
                  </select>
          </div>

          {/* Quantity */}
          <div className="space-y-3">
            <label className="text-sm font-bold text-gray-300 font-mono tracking-wider">QUANTITY</label>
            <div className="relative">
              <input
                type="number"
                className={`w-full rounded-lg border p-3 pr-16 font-mono text-white bg-gray-800/70 transition-all ${
                  focusedField === 'qty' 
                    ? 'border-cyan-400 ring-2 ring-cyan-400/20 bg-gray-800/90' 
                    : 'border-gray-600 hover:border-gray-500'
                } focus:outline-none`}
                value={qty}
                onChange={(e) => setQty(parseInt(e.target.value || '0'))}
                onFocus={() => setFocusedField('qty')}
                onBlur={() => setFocusedField(null)}
                placeholder="0"
              />
              <div className="absolute right-3 top-3 text-sm text-gray-400 font-mono">SHARES</div>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {[25, 50, 100, 250, 500].map(preset => (
                <button
                  key={preset}
                  onClick={() => setQty(preset)}
                  className="rounded-md border border-gray-600 bg-gray-800/50 py-2 text-xs font-mono text-gray-300 hover:bg-gray-700/70 hover:border-gray-500 hover:text-white transition-all"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Price (for limit orders) */}
          {type === 'limit' && (
            <div className="space-y-3">
              <label className="text-sm font-bold text-gray-300 font-mono tracking-wider">LIMIT PRICE</label>
              <div className="relative">
                <span className="absolute left-3 top-3 text-gray-400 font-mono">$</span>
                <input
                  type="number"
                  step="0.01"
                  className={`w-full rounded-lg border p-3 pl-8 font-mono text-white bg-gray-800/70 transition-all ${
                    focusedField === 'price' 
                      ? 'border-cyan-400 ring-2 ring-cyan-400/20 bg-gray-800/90' 
                      : 'border-gray-600 hover:border-gray-500'
                  } focus:outline-none`}
                  value={price}
                  onChange={(e) => setPrice(e.target.value === '' ? '' : Number(e.target.value))}
                  onFocus={() => setFocusedField('price')}
                  onBlur={() => setFocusedField(null)}
                  placeholder="0.00"
                />
              </div>
            </div>
          )}

                    {/* Submit Button */}
          <button
            onClick={onPlaceOrder}
            disabled={isLoading || !qty || (type === 'limit' && !price)}
            className={`w-full rounded-lg py-4 font-bold font-mono text-lg tracking-wide transition-all transform shadow-lg ${
              side === 'buy'
                ? 'bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-400 hover:to-green-400 text-black shadow-emerald-500/25 hover:shadow-emerald-400/40 hover:scale-105 active:scale-95'
                : 'bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-400 hover:to-rose-400 text-white shadow-red-500/25 hover:shadow-red-400/40 hover:scale-105 active:scale-95'
            } disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none border ${
              side === 'buy' ? 'border-emerald-400' : 'border-red-400'
            }`}
          >
            {isLoading ? (
              <div className="flex items-center justify-center space-x-3">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                <span>EXECUTING...</span>
              </div>
            ) : (
              <div className="flex items-center justify-center space-x-2">
                <span>{side === 'buy' ? '▲' : '▼'}</span>
                <span>{side.toUpperCase()} {qty} {symbol}</span>
              </div>
            )}
          </button>

          {/* Order Summary */}
          {qty && (type === 'market' || price) && (
            <div className="rounded-lg bg-gray-800/60 border border-gray-700/50 p-4 text-sm">
              <div className="font-bold text-cyan-400 font-mono mb-2 tracking-wider">ORDER PREVIEW</div>
              <div className="space-y-2 text-gray-300 font-mono">
                <div className="flex justify-between">
                  <span>ACTION:</span>
                  <span className={side === 'buy' ? 'text-emerald-400' : 'text-red-400'}>
                    {side.toUpperCase()} {qty} {symbol}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>PRICE:</span>
                  <span className="text-cyan-400">
                    {type === 'market' ? 'MARKET' : `$${Number(price).toFixed(2)}`}
                  </span>
                </div>
                {type === 'limit' && (
                  <div className="flex justify-between border-t border-gray-700 pt-2">
                    <span className="text-yellow-400">EST. TOTAL:</span>
                    <span className="text-yellow-400 font-bold">
                      ${(Number(price) * qty).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Orders Panel Component
function OrdersPanel({ 
  orders, 
  onCancelOrder, 
  cancelLoading 
}: { 
  orders: OrderSummary[]; 
  onCancelOrder: (orderId: string) => void;
  cancelLoading: boolean;
}) {
  const openOrders = orders.filter(o => ['pending', 'partial'].includes(o.status));

  return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-900/50 backdrop-blur-sm shadow-2xl">
      <div className="bg-gradient-to-r from-gray-800/80 to-gray-900/80 p-4 border-b border-gray-700/50">
        <h2 className="text-xl font-bold text-white font-mono tracking-wide">ACTIVE ORDERS</h2>
        <div className="flex items-center space-x-2 mt-1">
          <div className="h-2 w-2 rounded-full bg-orange-400 animate-pulse"></div>
          <p className="text-sm text-orange-400 font-mono">{openOrders.length} ORDERS</p>
        </div>
      </div>
      
      <div className="max-h-96 overflow-y-auto">
        {openOrders.length > 0 ? (
          <div className="divide-y divide-gray-700/30">
            {openOrders.map((order) => (
              <div key={order.order_id} className="p-4 hover:bg-gray-800/30 transition-colors border-l-2 border-transparent hover:border-cyan-400/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`h-3 w-3 rounded-full ${
                      order.side === 'buy' ? 'bg-emerald-400 shadow-emerald-400/50' : 'bg-red-400 shadow-red-400/50'
                    } shadow-lg`} />
                    <div>
                      <div className="font-bold text-white font-mono">
                        <span className={order.side === 'buy' ? 'text-emerald-400' : 'text-red-400'}>
                          {order.side.toUpperCase()}
                        </span>{' '}
                        {order.quantity.toLocaleString()} {order.symbol}
                      </div>
                      <div className="text-sm text-gray-400 font-mono">
                        {order.order_type === 'limit' ? `@ $${order.price?.toFixed(2)}` : 'MARKET'} 
                        <span className="text-cyan-400 ml-2">• {order.status.toUpperCase()}</span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => onCancelOrder(order.order_id)}
                    disabled={cancelLoading}
                    className="rounded-md bg-red-900/50 border border-red-500/50 px-3 py-1.5 text-xs font-mono font-bold text-red-400 hover:bg-red-900/70 hover:border-red-400 hover:text-red-300 transition-all disabled:opacity-50 shadow-lg hover:shadow-red-500/20"
                  >
                    CANCEL
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center">
            <div className="h-16 w-16 mx-auto mb-4 rounded-full border-2 border-gray-700 flex items-center justify-center">
              <svg className="h-8 w-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-gray-500 font-mono text-sm">NO ACTIVE ORDERS</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Trades Panel Component
function TradesPanel({ trades }: { trades: TradeRecord[] }) {
  const recentTrades = trades.slice(-10).reverse();

  return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-900/50 backdrop-blur-sm shadow-2xl">
      <div className="bg-gradient-to-r from-gray-800/80 to-gray-900/80 p-4 border-b border-gray-700/50">
        <h2 className="text-xl font-bold text-white font-mono tracking-wide">RECENT TRADES</h2>
        <div className="flex items-center space-x-2 mt-1">
          <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse"></div>
          <p className="text-sm text-blue-400 font-mono">{trades.length} TOTAL TRADES</p>
        </div>
      </div>
      
      <div className="max-h-96 overflow-y-auto">
        {recentTrades.length > 0 ? (
          <div className="divide-y divide-gray-700/30">
            {recentTrades.map((trade) => (
              <div key={trade.trade_id} className="p-4 hover:bg-gray-800/30 transition-colors border-l-2 border-transparent hover:border-blue-400/50">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold text-white font-mono">
                      {trade.quantity.toLocaleString()} {trade.symbol}
                    </div>
                    <div className="text-sm text-cyan-400 font-mono">
                      @ ${trade.price.toFixed(2)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-blue-400 font-mono">
                      ${(trade.price * trade.quantity).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </div>
                    <div className="text-xs text-gray-500 font-mono">
                      {new Date(trade.executed_at).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center">
            <div className="h-16 w-16 mx-auto mb-4 rounded-full border-2 border-gray-700 flex items-center justify-center">
              <svg className="h-8 w-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <p className="text-gray-500 font-mono text-sm">NO TRADES YET</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Positions Panel Component
function PositionsPanel({ positions }: { positions?: PositionsResponse }) {
  return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-900/50 backdrop-blur-sm shadow-2xl">
      <div className="bg-gradient-to-r from-gray-800/80 to-gray-900/80 p-4 border-b border-gray-700/50">
        <h2 className="text-xl font-bold text-white font-mono tracking-wide">POSITIONS</h2>
        <div className="flex items-center space-x-2 mt-1">
          <div className="h-2 w-2 rounded-full bg-purple-400 animate-pulse"></div>
          <p className="text-sm text-purple-400 font-mono">{positions?.positions.length || 0} POSITIONS</p>
        </div>
      </div>
      
      <div className="max-h-80 overflow-y-auto">
        {positions?.positions.length ? (
          <div className="divide-y divide-gray-700/30">
            {positions.positions.map((position) => (
              <div key={position.symbol} className="p-4 hover:bg-gray-800/30 transition-colors border-l-2 border-transparent hover:border-purple-400/50">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold text-white font-mono text-lg">{position.symbol}</div>
                    <div className="text-sm text-cyan-400 font-mono">
                      AVG: ${position.average_price?.toFixed(2) || 'N/A'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-bold font-mono text-lg ${
                      position.quantity >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {position.quantity > 0 ? '+' : ''}{position.quantity.toLocaleString()}
                    </div>
                    <div className={`text-sm font-mono ${
                      (position.unrealized_pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {(position.unrealized_pnl || 0) >= 0 ? '+' : ''}${(position.unrealized_pnl || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center">
            <div className="h-16 w-16 mx-auto mb-4 rounded-full border-2 border-gray-700 flex items-center justify-center">
              <svg className="h-8 w-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <p className="text-gray-500 font-mono text-sm">NO POSITIONS</p>
          </div>
        )}
      </div>
    </div>
  );
}
