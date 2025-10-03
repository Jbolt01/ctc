"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import NavBar from '../../../components/NavBar';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import MiniCandleChart from '../../../components/MiniCandleChart';
import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  createChart,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
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
import { useMarketData, type Candle } from '../../../hooks/useMarketData';

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
  const timeframePresets = ['1m', '5m', '15m', '1H', '4H', '1D'];
  const [timeframe, setTimeframe] = useState<string>('1H');
  const [chartMode, setChartMode] = useState<'area' | 'line'>('area');
  
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

  const sortedMarketTrades = useMemo(() => {
    const list = marketTrades?.trades ?? [];
    return list
      .slice()
      .sort((a, b) => new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime());
  }, [marketTrades?.trades]);

  const priceSeries = useMemo(
    () =>
      sortedMarketTrades.map((trade) => ({
        time: Math.floor(new Date(trade.executed_at).getTime() / 1000) as UTCTimestamp,
        value: trade.price,
      })),
    [sortedMarketTrades],
  );

  const lastTradePrice = priceSeries.length ? priceSeries[priceSeries.length - 1].value : null;
  const firstTradePrice = priceSeries.length ? priceSeries[0].value : null;
  const priceChange =
    lastTradePrice !== null && firstTradePrice !== null ? lastTradePrice - firstTradePrice : null;
  const priceChangePct =
    priceChange !== null && firstTradePrice ? (priceChange / firstTradePrice) * 100 : null;
  const sessionHigh = priceSeries.length
    ? priceSeries.reduce((max, point) => Math.max(max, point.value), Number.NEGATIVE_INFINITY)
    : null;
  const sessionLow = priceSeries.length
    ? priceSeries.reduce((min, point) => Math.min(min, point.value), Number.POSITIVE_INFINITY)
    : null;
  const sessionVolume = sortedMarketTrades.reduce((sum, trade) => sum + trade.quantity, 0);
  const watchlistCandles = useMemo(
    () => buildCandlesFromTrades(sortedMarketTrades),
    [sortedMarketTrades],
  );
  const quotedSpread = useMemo(() => {
    const bestBid = ob?.bids?.[0]?.price ?? null;
    const bestAsk = ob?.asks?.[0]?.price ?? null;
    if (bestBid === null || bestAsk === null) return null;
    return bestAsk - bestBid;
  }, [ob]);

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
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <SideDock
        onOpenDocs={() => window.open('https://tradingview.com', '_blank')}
        onToggleTheme={() => setChartMode((prev) => (prev === 'area' ? 'line' : 'area'))}
      />
      <div className="flex flex-1 flex-col">
        <NavBar />
        <main className="flex-1 overflow-hidden px-6 py-6">
          <TopToolbar
            symbol={symbol}
            symbolOptions={symbolOptions}
            onSymbolChange={(value) => setSymbol(value)}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
            timeframePresets={timeframePresets}
            chartMode={chartMode}
            onChartModeChange={setChartMode}
            lastPrice={lastTradePrice}
            priceChange={priceChange}
            priceChangePct={priceChangePct}
            quote={quote}
            teamName={userInfo?.teams?.[0]?.name}
            teamRole={userInfo?.teams?.[0]?.role}
            onOpenTicket={() => setShowOrderForm(true)}
          />

          {!hasSymbols ? (
            <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/70 p-12 text-center shadow-2xl">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-cyan-500/40 bg-cyan-500/10">
                <svg className="h-8 w-8 text-cyan-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <p className="text-base text-slate-300 font-mono">No symbols available. Ask an admin to add symbols on the Admin page.</p>
            </div>
          ) : (
            <PanelGroup direction="horizontal" className="mt-4 h-[calc(100vh-220px)] gap-4">
              <Panel defaultSize={18} minSize={12} className="flex">
                <div className="h-full w-full overflow-hidden">
                  <WatchlistPanel
                    symbols={symbolOptions}
                    activeSymbol={symbol}
                    onSelectSymbol={setSymbol}
                    candles={watchlistCandles}
                    quote={quote}
                    lastPrice={lastTradePrice}
                    priceChangePct={priceChangePct}
                    sessionVolume={sessionVolume}
                    timeframe={timeframe}
                  />
                </div>
              </Panel>
              <ResizeHandle />
              <Panel defaultSize={50} minSize={36} className="flex">
                <PanelGroup direction="vertical" className="h-full w-full gap-4">
                  <Panel defaultSize={62} minSize={35} className="flex">
                    <PriceChart
                      symbol={symbol}
                      data={priceSeries}
                      lastPrice={lastTradePrice}
                      priceChange={priceChange}
                      priceChangePct={priceChangePct}
                      timeframe={timeframe}
                      mode={chartMode}
                    />
                  </Panel>
                  <ResizeHandle vertical={false} />
                  <Panel minSize={28} className="flex">
                    <PanelGroup direction="horizontal" className="h-full w-full gap-4">
                      <Panel minSize={30} className="flex">
                        <OrderBookLadder
                          orderbook={ob}
                          quote={quote}
                          onPriceClick={handleLadderClick}
                          symbol={symbol}
                        />
                      </Panel>
                      <ResizeHandle />
                      <Panel minSize={20} className="flex">
                        <TradesPanel trades={trades?.trades || []} />
                      </Panel>
                    </PanelGroup>
                  </Panel>
                  <ResizeHandle vertical={false} />
                  <Panel minSize={20} className="flex">
                    <MarketPulseBar
                      lastPrice={lastTradePrice}
                      change={priceChange}
                      changePct={priceChangePct}
                      high={sessionHigh}
                      low={sessionLow}
                      volume={sessionVolume}
                      spread={quotedSpread}
                    />
                  </Panel>
                </PanelGroup>
              </Panel>
              <ResizeHandle />
              <Panel defaultSize={32} minSize={24} className="flex">
                <PanelGroup direction="vertical" className="h-full w-full gap-4">
                  <Panel minSize={35} className="flex">
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
                  </Panel>
                  <ResizeHandle vertical={false} />
                  <Panel minSize={25} className="flex">
                    <PanelGroup direction="vertical" className="h-full w-full gap-4">
                      <Panel minSize={30} className="flex">
                        <PositionsPanel positions={positions} />
                      </Panel>
                      <ResizeHandle vertical={false} />
                      <Panel minSize={30} className="flex">
                        <OrdersPanel
                          orders={allOrders?.orders || []}
                          onCancelOrder={handleCancelOrder}
                          cancelLoading={cancelOrderMutation.isPending}
                        />
                      </Panel>
                    </PanelGroup>
                  </Panel>
                </PanelGroup>
              </Panel>
            </PanelGroup>
          )}
        </main>
      </div>
    </div>
  );
}

type SymbolOption = { symbol: string; name?: string; [key: string]: unknown };

function SideDock({ onOpenDocs, onToggleTheme }: { onOpenDocs: () => void; onToggleTheme: () => void }) {
  const navItems = [
    { label: 'Chart', icon: '📈' },
    { label: 'Orders', icon: '📑' },
    { label: 'News', icon: '📰' },
    { label: 'Calendar', icon: '🗓️' },
  ];

  return (
    <aside className="hidden xl:flex w-20 flex-col border-r border-slate-900 bg-slate-950/90 backdrop-blur">
      <div className="flex h-16 items-center justify-center border-b border-slate-900">
        <span className="text-lg font-bold tracking-[0.6em] text-cyan-300">CTC</span>
      </div>
      <nav className="flex-1 flex flex-col items-center gap-4 py-8">
        {navItems.map((item) => (
          <button
            key={item.label}
            type="button"
            className="group relative flex h-12 w-12 items-center justify-center rounded-2xl border border-transparent bg-slate-900/60 text-slate-400 transition-all hover:border-cyan-500/60 hover:text-cyan-300 hover:shadow-lg hover:shadow-cyan-500/20"
          >
            <span className="text-xl" aria-hidden>{item.icon}</span>
            <span className="pointer-events-none absolute left-14 rounded-lg bg-slate-900/95 px-3 py-1 text-xs font-mono text-slate-200 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
              {item.label}
            </span>
          </button>
        ))}
      </nav>
      <div className="flex flex-col items-center gap-3 border-t border-slate-900 p-4">
        <button
          onClick={onToggleTheme}
          type="button"
          className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-800 bg-slate-900/80 text-slate-300 transition-all hover:border-cyan-500/60 hover:text-cyan-200"
        >
          <span className="text-lg" aria-hidden>🎨</span>
        </button>
        <button
          onClick={onOpenDocs}
          type="button"
          className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-800 bg-slate-900/80 text-slate-300 transition-all hover:border-cyan-500/60 hover:text-cyan-200"
        >
          <span className="text-lg" aria-hidden>📚</span>
        </button>
      </div>
    </aside>
  );
}

const ResizeHandle = ({ vertical = true }: { vertical?: boolean }) => (
  <PanelResizeHandle className="group flex items-center justify-center transition-colors">
    <div
      className={`rounded-full bg-slate-800/80 shadow-inner shadow-slate-950/40 transition-colors group-hover:bg-cyan-500/40 ${
        vertical ? 'h-8 w-1.5' : 'h-1.5 w-8'
      }`}
    />
  </PanelResizeHandle>
);

function TopToolbar({
  symbol,
  symbolOptions,
  onSymbolChange,
  timeframe,
  onTimeframeChange,
  timeframePresets,
  chartMode,
  onChartModeChange,
  lastPrice,
  priceChange,
  priceChangePct,
  quote,
  teamName,
  teamRole,
  onOpenTicket,
}: {
  symbol: string;
  symbolOptions: SymbolOption[];
  onSymbolChange: (value: string) => void;
  timeframe: string;
  onTimeframeChange: (value: string) => void;
  timeframePresets: string[];
  chartMode: 'area' | 'line';
  onChartModeChange: (mode: 'area' | 'line') => void;
  lastPrice: number | null;
  priceChange: number | null;
  priceChangePct: number | null;
  quote: { bid?: number | null; ask?: number | null } | null;
  teamName?: string;
  teamRole?: string;
  onOpenTicket: () => void;
}) {
  const positive = (priceChange ?? 0) >= 0;
  const priceLabel = lastPrice !== null ? `$${lastPrice.toFixed(2)}` : '—';
  const changeLabel =
    priceChange !== null && priceChangePct !== null
      ? `${positive ? '+' : ''}${priceChange.toFixed(2)} (${positive ? '+' : ''}${priceChangePct.toFixed(2)}%)`
      : '—';

  return (
    <section className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-900 bg-slate-900/70 px-6 py-5 shadow-2xl backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <label className="text-xs font-mono uppercase tracking-[0.4em] text-slate-400">Instrument</label>
            <div className="mt-1 flex items-center gap-3">
              <select
                value={symbol}
                onChange={(e) => onSymbolChange(e.target.value)}
                className="min-w-[160px] rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-base font-semibold text-slate-100 transition-colors hover:border-cyan-500 focus:border-cyan-500 focus:outline-none"
              >
                {symbolOptions.map((s) => (
                  <option key={s.symbol} value={s.symbol} className="bg-slate-900 text-slate-100">
                    {s.symbol} {s.name ? `• ${s.name}` : ''}
                  </option>
                ))}
              </select>
              <div className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm font-mono text-slate-300">
                {teamName ? (
                  <span>
                    {teamName}
                    {teamRole ? <span className="ml-2 text-cyan-400">{teamRole}</span> : null}
                  </span>
                ) : (
                  '—'
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-mono uppercase tracking-[0.4em] text-slate-400">Timeframe</label>
            <div className="mt-1 flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/80 p-1">
              {timeframePresets.map((preset) => {
                const active = preset === timeframe;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => onTimeframeChange(preset)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-mono transition-all ${
                      active
                        ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/60 shadow shadow-cyan-500/20'
                        : 'text-slate-400 hover:text-cyan-200 hover:bg-slate-800'
                    }`}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-xs font-mono uppercase tracking-[0.4em] text-slate-400">Chart</label>
            <div className="mt-1 flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/80 p-1">
              <button
                type="button"
                onClick={() => onChartModeChange('area')}
                className={`rounded-lg px-3 py-1.5 text-sm font-mono transition-all ${
                  chartMode === 'area'
                    ? 'bg-blue-500/20 text-blue-200 border border-blue-400/60 shadow shadow-blue-500/20'
                    : 'text-slate-400 hover:text-blue-200 hover:bg-slate-800'
                }`}
              >
                Area
              </button>
              <button
                type="button"
                onClick={() => onChartModeChange('line')}
                className={`rounded-lg px-3 py-1.5 text-sm font-mono transition-all ${
                  chartMode === 'line'
                    ? 'bg-purple-500/20 text-purple-200 border border-purple-400/60 shadow shadow-purple-500/20'
                    : 'text-slate-400 hover:text-purple-200 hover:bg-slate-800'
                }`}
              >
                Line
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3">
            <div className="text-xs font-mono text-slate-400 uppercase tracking-[0.3em]">Last</div>
            <div className="mt-1 flex items-end gap-2">
              <span className="text-2xl font-mono font-bold text-slate-100">{priceLabel}</span>
              <span className={`text-sm font-mono ${positive ? 'text-emerald-400' : 'text-red-400'}`}>{changeLabel}</span>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-sm font-mono text-slate-300">
            <div className="flex items-center gap-4">
              <div>
                <span className="text-xs text-slate-400 uppercase tracking-[0.3em]">Bid</span>
                <div className="mt-1 text-emerald-300 font-semibold">{quote?.bid ? `$${quote.bid.toFixed(2)}` : '—'}</div>
              </div>
              <div>
                <span className="text-xs text-slate-400 uppercase tracking-[0.3em]">Ask</span>
                <div className="mt-1 text-rose-300 font-semibold">{quote?.ask ? `$${quote.ask.toFixed(2)}` : '—'}</div>
              </div>
            </div>
          </div>
          <button
            onClick={onOpenTicket}
            type="button"
            className="rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-500 px-6 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-500/30 transition-transform hover:scale-[1.02]"
          >
            Open Ticket
          </button>
        </div>
      </div>
    </section>
  );
}

function WatchlistPanel({
  symbols,
  activeSymbol,
  onSelectSymbol,
  candles,
  quote,
  lastPrice,
  priceChangePct,
  sessionVolume,
  timeframe,
}: {
  symbols: SymbolOption[];
  activeSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  candles: Candle[];
  quote: { bid?: number | null; ask?: number | null } | null;
  lastPrice: number | null;
  priceChangePct: number | null;
  sessionVolume: number;
  timeframe: string;
}) {
  const volumeLabel = sessionVolume ? `${sessionVolume.toLocaleString()} shares` : '—';
  const changeColor = (priceChangePct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400';

  return (
    <section className="rounded-2xl border border-slate-900 bg-slate-900/70 p-5 shadow-2xl backdrop-blur">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.4em] text-slate-400">Watchlist</h2>
          <p className="mt-1 text-xs text-slate-500">{timeframe.toUpperCase()} snapshot of tracked symbols</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-1 text-xs font-mono text-slate-400">
          Volume {volumeLabel}
        </div>
      </div>
      <div className="space-y-2">
        {symbols.map((item) => {
          const isActive = item.symbol === activeSymbol;
          return (
            <button
              key={item.symbol}
              type="button"
              onClick={() => onSelectSymbol(item.symbol)}
              className={`group flex w-full items-center justify-between rounded-2xl border border-slate-900 bg-slate-950/60 px-4 py-3 text-left transition-all hover:border-cyan-500/60 hover:bg-slate-900/80 hover:shadow-lg hover:shadow-cyan-500/15 ${
                isActive ? 'border-cyan-500/60 shadow-lg shadow-cyan-500/20' : ''
              }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold text-slate-100">{item.symbol}</span>
                  {item.name && <span className="text-xs text-slate-500">{item.name}</span>}
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs font-mono text-slate-400">
                  <span className="text-slate-200 font-semibold">
                    {isActive && lastPrice !== null ? `$${lastPrice.toFixed(2)}` : '—'}
                  </span>
                  <span className={`text-xs font-semibold ${isActive ? changeColor : 'text-slate-500'}`}>
                    {isActive && priceChangePct !== null ? `${priceChangePct >= 0 ? '+' : ''}${priceChangePct.toFixed(2)}%` : '--'}
                  </span>
                  {isActive && quote ? (
                    <span className="text-xs text-slate-500">
                      <span className="text-emerald-300">B {quote.bid ? quote.bid.toFixed(2) : '—'}</span>
                      <span className="mx-1">•</span>
                      <span className="text-rose-300">A {quote.ask ? quote.ask.toFixed(2) : '—'}</span>
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-10 w-24">
                  <MiniCandleChart candles={isActive ? candles : []} />
                </div>
                <span className="text-slate-500 transition-transform group-hover:translate-x-1">›</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function MarketPulseBar({
  lastPrice,
  change,
  changePct,
  high,
  low,
  volume,
  spread,
}: {
  lastPrice: number | null;
  change: number | null;
  changePct: number | null;
  high: number | null;
  low: number | null;
  volume: number;
  spread: number | null;
}) {
  const cards = [
    { label: 'Last Price', value: lastPrice !== null ? `$${lastPrice.toFixed(2)}` : '—', accent: 'text-cyan-300' },
    {
      label: 'Change',
      value:
        change !== null && changePct !== null
          ? `${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`
          : '—',
      accent: change !== null && change >= 0 ? 'text-emerald-400' : 'text-red-400',
    },
    { label: 'Session High', value: high !== null ? `$${high.toFixed(2)}` : '—', accent: 'text-emerald-300' },
    { label: 'Session Low', value: low !== null ? `$${low.toFixed(2)}` : '—', accent: 'text-rose-300' },
    { label: 'Volume', value: volume ? volume.toLocaleString() : '—', accent: 'text-slate-200' },
    { label: 'Spread', value: spread !== null ? `$${spread.toFixed(2)}` : '—', accent: 'text-slate-200' },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-2xl border border-slate-900 bg-slate-900/80 px-4 py-3 shadow-inner shadow-slate-950/40"
        >
          <div className="text-[10px] font-mono uppercase tracking-[0.4em] text-slate-500">{card.label}</div>
          <div className={`mt-2 text-lg font-semibold ${card.accent}`}>{card.value}</div>
        </div>
      ))}
    </div>
  );
}

// Price Chart Component
function PriceChart({
  symbol,
  data,
  lastPrice,
  priceChange,
  priceChangePct,
  timeframe,
  mode,
}: {
  symbol: string;
  data: { time: UTCTimestamp; value: number }[];
  lastPrice: number | null;
  priceChange: number | null;
  priceChangePct: number | null;
  timeframe: string;
  mode: 'area' | 'line';
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area' | 'Line'> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

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
        tickMarkFormatter: (time: UTCTimestamp) => new Date(time * 1000).toLocaleTimeString(),
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

    chartRef.current = chart;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        chart.applyOptions({ width, height });
      }
    });

    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      if (seriesRef.current) {
        chart.removeSeries(seriesRef.current);
      }
      chartRef.current = null;
      seriesRef.current = null;
      chart.remove();
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (seriesRef.current) {
      chart.removeSeries(seriesRef.current);
      seriesRef.current = null;
    }

    const baseOptions = {
      lineWidth: 3,
      priceLineVisible: true,
      priceLineColor: '#38BDF8',
      priceLineWidth: 1,
    } as const;

    const series = chart.addSeries(
      mode === 'line' ? LineSeries : AreaSeries,
      mode === 'line'
        ? {
            ...baseOptions,
            color: '#38BDF8',
          }
        : {
            ...baseOptions,
            lineColor: '#0EA5E9',
            topColor: 'rgba(14, 165, 233, 0.45)',
            bottomColor: 'rgba(14, 165, 233, 0.05)',
          },
    ) as ISeriesApi<'Area' | 'Line'>;

    seriesRef.current = series;
  }, [mode]);

  useEffect(() => {
    if (!seriesRef.current) return;
    if (!data.length) {
      seriesRef.current.setData([]);
      return;
    }
    seriesRef.current.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [data, mode]);

  const changeLabel =
    priceChange !== null && priceChangePct !== null
      ? `${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)} (${priceChangePct >= 0 ? '+' : ''}${priceChangePct.toFixed(2)}%)`
      : '—';

  return (
    <div className="rounded-2xl border border-slate-900 bg-slate-900/70 p-6 shadow-2xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-900 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">{symbol} • {timeframe.toUpperCase()} chart</h2>
          <p className="mt-1 text-xs uppercase tracking-[0.35em] text-cyan-400/70">real-time market feed</p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm font-mono">
          <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-1">
            <span className="text-xs text-slate-500 uppercase tracking-[0.3em]">Last</span>
            <span className="text-lg font-semibold text-slate-100">{lastPrice !== null ? `$${lastPrice.toFixed(2)}` : '—'}</span>
          </div>
          <div className={`rounded-xl px-3 py-1 text-xs font-semibold ${priceChange !== null && priceChange >= 0 ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30' : 'bg-red-500/10 text-red-300 border border-red-500/30'}`}>
            {changeLabel}
          </div>
        </div>
      </div>
      <div className="relative h-80">
        <div ref={containerRef} className="absolute inset-0" />
        {!data.length && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-slate-700">
                <svg className="h-7 w-7 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
              <p className="text-sm font-mono text-slate-500">Waiting for trades…</p>
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

function buildCandlesFromTrades(trades: TradeRecord[], bucketMs = 60_000): Candle[] {
  if (!trades.length) return [];
  const sorted = trades
    .slice()
    .sort((a, b) => new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime());

  const buckets = new Map<number, Candle>();

  for (const trade of sorted) {
    const ts = new Date(trade.executed_at).getTime();
    const bucket = Math.floor(ts / bucketMs) * bucketMs;
    const existing = buckets.get(bucket);
    if (!existing) {
      buckets.set(bucket, {
        t: bucket,
        o: trade.price,
        h: trade.price,
        l: trade.price,
        c: trade.price,
        v: trade.quantity,
      });
    } else {
      existing.h = Math.max(existing.h, trade.price);
      existing.l = Math.min(existing.l, trade.price);
      existing.c = trade.price;
      existing.v += trade.quantity;
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.t - b.t);
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
