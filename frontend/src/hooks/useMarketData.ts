"use client";
import { useEffect, useMemo, useRef, useState } from 'react';

type QuoteMsg = {
  type: 'quote';
  symbol: string;
  bid: number;
  ask: number;
  bid_size: number;
  ask_size: number;
  timestamp: string;
};

type OrderbookMsg = {
  type: 'orderbook';
  symbol: string;
  bids: { price: number; quantity: number }[];
  asks: { price: number; quantity: number }[];
  timestamp: string;
};

type TradeMsg = {
  type: 'trade';
  symbol: string;
  price: number;
  quantity: number;
  timestamp: string;
};

type MarketMsg = QuoteMsg | OrderbookMsg | TradeMsg;

export function useMarketData(symbol: string, channels: Array<'quotes' | 'orderbook' | 'trades'> = ['quotes', 'orderbook', 'trades']) {
  const [quote, setQuote] = useState<QuoteMsg | null>(null);
  const [orderbook, setOrderbook] = useState<{ bids: { price: number; quantity: number }[]; asks: { price: number; quantity: number }[] }>({ bids: [], asks: [] });
  const [lastTrade, setLastTrade] = useState<TradeMsg | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const url = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const env = process.env.NEXT_PUBLIC_WS_URL || '/ws/v1/market-data';
    if (env.startsWith('ws://') || env.startsWith('wss://')) return env;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const port = window.location.port ? `:${window.location.port}` : '';
    return `${proto}//${host}${port}${env.startsWith('/') ? env : `/${env}`}`;
  }, []);
  const subPayload = useMemo(
    () => ({ action: 'subscribe' as const, symbols: [symbol], channels }),
    [symbol, channels]
  );

  useEffect(() => {
    if (!symbol) return;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify(subPayload));
    };
    ws.onmessage = (ev) => {
      try {
        const msg: MarketMsg = JSON.parse(ev.data);
        if (msg.type === 'quote' && msg.symbol === symbol) setQuote(msg);
        if (msg.type === 'orderbook' && msg.symbol === symbol) setOrderbook({ bids: msg.bids, asks: msg.asks });
        if (msg.type === 'trade' && msg.symbol === symbol) setLastTrade(msg);
      } catch {
        // ignore
      }
    };
    ws.onclose = () => {
      // attempt light reconnect after a delay
      setTimeout(() => {
        if (wsRef.current === ws) wsRef.current = null;
      }, 500);
    };
    return () => {
      ws.close();
    };
  }, [url, subPayload, symbol]);

  return { quote, orderbook, lastTrade };
}

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
export function useSyntheticCandles(lastTrade: TradeMsg | null, bucketMs = 60_000, lookback = 60) {
  const [candles, setCandles] = useState<Candle[]>([]);
  useEffect(() => {
    if (!lastTrade) return;
    const ts = new Date(lastTrade.timestamp).getTime();
    const bucket = Math.floor(ts / bucketMs) * bucketMs;
    setCandles((prev) => {
      const arr = [...prev];
      const existingIdx = arr.findIndex((c) => c.t === bucket);
      if (existingIdx >= 0) {
        const c = arr[existingIdx];
        c.h = Math.max(c.h, lastTrade.price);
        c.l = Math.min(c.l, lastTrade.price);
        c.c = lastTrade.price;
        c.v += lastTrade.quantity;
      } else {
        const prevClose = arr.length ? arr[arr.length - 1].c : lastTrade.price;
        arr.push({ t: bucket, o: prevClose, h: lastTrade.price, l: lastTrade.price, c: lastTrade.price, v: lastTrade.quantity });
      }
      // trim
      while (arr.length > lookback) arr.shift();
      return arr;
    });
  }, [lastTrade, bucketMs, lookback]);
  return candles;
}

