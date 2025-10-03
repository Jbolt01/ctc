"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import NavBar from '../../../components/NavBar';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
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

// Custom hooks
function useSymbols(enabled = true) {
  return useQuery({ queryKey: ['symbols'], queryFn: fetchSymbols, enabled });
}

function usePositions(enabled = true) {
  return useQuery({ queryKey: ['positions'], queryFn: fetchPositions, refetchInterval: 2000, enabled });
}

function useTrades(symbol: string, enabled = true) {
  return useQuery({
    queryKey: ['trades', symbol],
    queryFn: () => fetchTrades(symbol),
    refetchInterval: 1000,
    enabled: enabled && !!symbol,
  });
}

function useMarketTrades(symbol: string, enabled = true) {
  return useQuery({
    queryKey: ['marketTrades', symbol],
    queryFn: () => fetchMarketTrades(symbol),
    refetchInterval: 1000,
    enabled: enabled && !!symbol,
  });
}

function useAllOrders(symbol: string, enabled = true) {
  return useQuery({
    queryKey: ['orders', 'all', symbol],
    queryFn: () => fetchAllOrders(undefined, symbol),
    refetchInterval: 1000,
    enabled: enabled && !!symbol,
  });
}

export default function EquitiesTradingPage() {
  const router = useRouter();
  const [symbol, setSymbol] = useState('');
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
      router.push('/');
      return;
    }
    
    setIsAuthenticated(true);
    setUserInfo({
      user: JSON.parse(user),
      teams: JSON.parse(teams)
    });
  }, [router]);
  
  const qc = useQueryClient();
  const { data: symbols, error: symbolsError } = useSymbols(isAuthenticated);
  const symbolOptions = useMemo(() => symbols?.symbols ?? [], [symbols?.symbols]);
  const hasSymbols = symbolOptions.length > 0;
  useEffect(() => {
    if (!symbol && hasSymbols) setSymbol(symbolOptions[0].symbol);
  }, [hasSymbols, symbol, symbolOptions]);
  const { quote, orderbook: ob } = useMarketData(symbol, ['quotes', 'orderbook', 'trades']);
  const { data: positions } = usePositions(isAuthenticated);
  const { data: trades } = useTrades(symbol, isAuthenticated);  // Team-filtered trades for recent trades panel
  const { data: marketTrades } = useMarketTrades(symbol, isAuthenticated);  // All market trades for price chart
  const { data: allOrders } = useAllOrders(symbol, isAuthenticated);

  // If the stored key is invalid or missing, bounce back to login
  useEffect(() => {
    if (!symbolsError) return;
    const msg = String((symbolsError as any)?.message || '');
    if (/401/.test(msg) || /Invalid API key/i.test(msg) || /Missing X-API-Key/i.test(msg)) {
      try {
        localStorage.removeItem('apiKey');
        localStorage.removeItem('user');
        localStorage.removeItem('teams');
      } catch {}
      router.push('/');
    }
  }, [symbolsError, router]);

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
    if (!symbol || !qty || (type === 'limit' && !price)) return;
    
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
            disabled={!hasSymbols}
          >
            {hasSymbols ? (
              symbolOptions.map((s) => (
                <option key={s.symbol} value={s.symbol} className="bg-gray-800 text-white">
                  {s.symbol} — {s.name}
                </option>
              ))
            ) : (
              <option value="" className="bg-gray-800 text-white">No symbols available</option>
            )}
          </select>
        </div>

        {/* Empty-state if no symbols */}
        {!hasSymbols ? (
          <div className="mt-8 rounded-xl border border-gray-700/50 bg-gray-900/50 p-10 text-center">
            <div className="mx-auto mb-4 h-16 w-16 rounded-full border-2 border-cyan-500/40 flex items-center justify-center">
              <svg className="h-8 w-8 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <p className="text-gray-300 font-mono">No symbols available. Ask an admin to add symbols on the Admin page.</p>
          </div>
        ) : (
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
        )}
      </main>
    </div>
  );
}

// Price Chart Component
function PriceChart({ trades, symbol }: { trades: TradeRecord[]; symbol: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);

  const sortedTrades = useMemo(() => (
    [...trades]
      .sort((a, b) => new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime())
  ), [trades]);

  const lineData = useMemo(() => (
    sortedTrades.map((trade) => ({
      time: Math.floor(new Date(trade.executed_at).getTime() / 1000) as UTCTimestamp,
      value: trade.price,
    }))
  ), [sortedTrades]);

  const firstPrice = sortedTrades[0]?.price ?? null;
  const lastPrice = sortedTrades[sortedTrades.length - 1]?.price ?? null;
  const change = firstPrice !== null && lastPrice !== null ? lastPrice - firstPrice : null;
  const changePct = change !== null && firstPrice ? (change / firstPrice) * 100 : null;

  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#CBD5F5',
      },
      grid: {
        vertLines: { color: 'rgba(8, 145, 178, 0.08)', style: 1 },
        horzLines: { color: 'rgba(8, 145, 178, 0.04)', style: 1 },
      },
      rightPriceScale: {
        borderColor: 'rgba(6, 182, 212, 0.3)',
        scaleMargins: { top: 0.1, bottom: 0.2 },
        textColor: '#E2E8F0',
      },
      timeScale: {
        borderColor: 'rgba(6, 182, 212, 0.3)',
        rightOffset: 6,
        tickMarkFormatter: (time) => new Date((time as number) * 1000).toLocaleTimeString(),
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: {
          color: 'rgba(59, 130, 246, 0.6)',
          style: 3,
          width: 1,
          labelBackgroundColor: 'rgba(30, 64, 175, 0.8)',
        },
        horzLine: {
          color: 'rgba(59, 130, 246, 0.6)',
          labelBackgroundColor: 'rgba(30, 64, 175, 0.8)',
        },
      },
      localization: {
        priceFormatter: (price: number) => `$${price.toFixed(2)}`,
      },
    });

    const series = chart.addAreaSeries({
      lineColor: '#0EA5E9',
      topColor: 'rgba(14, 165, 233, 0.45)',
      bottomColor: 'rgba(14, 165, 233, 0.05)',
      lineWidth: 3,
      priceLineVisible: true,
      priceLineColor: '#38BDF8',
      priceLineWidth: 1,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        chart.applyOptions({ width, height });
      }
    });

    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chartRef.current = null;
      seriesRef.current = null;
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current) return;
    if (!lineData.length) {
      seriesRef.current.setData([]);
      return;
    }

    seriesRef.current.setData(lineData);
    const lastPoint = lineData[lineData.length - 1];
    seriesRef.current.setMarkers([
      {
        time: lastPoint.time,
        position: 'aboveBar',
        color: '#38BDF8',
        shape: 'circle',
        text: 'last',
      },
    ]);
    chartRef.current?.timeScale().fitContent();
  }, [lineData]);

  const changeLabel = change !== null && changePct !== null
    ? `${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`
    : '—';

  return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-900/50 backdrop-blur-sm p-6 shadow-2xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-gray-700/30 pb-3">
        <div>
          <h2 className="text-xl font-bold text-white font-mono tracking-wide">PRICE ACTION</h2>
          <p className="text-xs uppercase tracking-[0.4em] text-cyan-400/70 font-semibold mt-1">{symbol}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm font-mono">
          <div className="flex items-center space-x-2">
            <div className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-cyan-300">LIVE</span>
          </div>
          <div className="h-4 w-px bg-gray-700" />
          <div className="text-gray-400">
            {trades.length} trades
          </div>
          <div className={`rounded-full px-3 py-1 text-xs ${change !== null && change >= 0 ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30' : 'bg-red-500/10 text-red-300 border border-red-500/30'}`}>
            {lastPrice !== null ? `$${lastPrice.toFixed(2)}` : '—'}
            <span className="ml-2 text-[11px] opacity-80">{changeLabel}</span>
          </div>
        </div>
      </div>
      <div className="relative h-72">
        <div ref={containerRef} className="absolute inset-0" />
        {!lineData.length && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-gray-700">
                <svg className="h-7 w-7 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
              <p className="text-gray-500 font-mono text-sm">Waiting for trades…</p>
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
                min="1"
                max="1000000"
                step="1"
                className={`w-full rounded-lg border p-3 pr-16 font-mono text-white bg-gray-800/70 transition-all ${
                  focusedField === 'qty' 
                    ? 'border-cyan-400 ring-2 ring-cyan-400/20 bg-gray-800/90' 
                    : 'border-gray-600 hover:border-gray-500'
                } focus:outline-none`}
                value={qty}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === '') {
                    setQty(0);
                  } else {
                    const numValue = parseInt(value);
                    if (!isNaN(numValue)) {
                      // Clamp between 1 and 1,000,000
                      setQty(Math.max(1, Math.min(1000000, numValue)));
                    }
                  }
                }}
                onFocus={() => setFocusedField('qty')}
                onBlur={() => setFocusedField(null)}
                placeholder="1"
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
                  min="1"
                  max="1000000"
                  step="0.01"
                  className={`w-full rounded-lg border p-3 pl-8 font-mono text-white bg-gray-800/70 transition-all ${
                    focusedField === 'price' 
                      ? 'border-cyan-400 ring-2 ring-cyan-400/20 bg-gray-800/90' 
                      : 'border-gray-600 hover:border-gray-500'
                  } focus:outline-none`}
                  value={price}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '') {
                      setPrice('');
                    } else {
                      const numValue = parseFloat(value);
                      if (!isNaN(numValue)) {
                        // Clamp between 1 and 1,000,000, round to 2 decimal places
                        const clampedValue = Math.max(1, Math.min(1000000, numValue));
                        setPrice(Math.round(clampedValue * 100) / 100);
                      }
                    }
                  }}
                  onFocus={() => setFocusedField('price')}
                  onBlur={() => setFocusedField(null)}
                  placeholder="1.00"
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
            {recentTrades.map((trade) => {
              const isBuy = trade.side === 'buy';
              const sidePill = (
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-bold font-mono ${
                    isBuy
                      ? 'bg-emerald-900/50 text-emerald-300 border border-emerald-500/40'
                      : 'bg-red-900/50 text-red-300 border border-red-500/40'
                  }`}
                >
                  {isBuy ? 'BOUGHT' : 'SOLD'}
                </span>
              );
              return (
                <div
                  key={trade.trade_id}
                  className={`p-4 transition-colors border-l-2 ${
                    isBuy
                      ? 'hover:bg-emerald-900/20 hover:border-emerald-400/50'
                      : 'hover:bg-red-900/20 hover:border-red-400/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-bold text-white font-mono">
                        <span className="mr-2">
                          {trade.quantity.toLocaleString()} {trade.symbol}
                        </span>
                        {trade.side ? sidePill : null}
                      </div>
                      <div
                        className={`text-sm font-mono ${
                          isBuy ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        @ ${trade.price.toFixed(2)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`font-bold font-mono ${
                          isBuy ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {(trade.price * trade.quantity).toLocaleString(
                          undefined,
                          { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                        )}
                      </div>
                      <div className="text-xs text-gray-500 font-mono">
                        {new Date(trade.executed_at).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
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
