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

type SubscriptionAckMsg = {
  type: 'subscription_ack';
  symbols: string[];
  channels: string[];
  timestamp: string;
};

type HeartbeatMsg = {
  type: 'heartbeat';
  timestamp: string;
};

type MarketMsg = QuoteMsg | OrderbookMsg | TradeMsg | SubscriptionAckMsg | HeartbeatMsg;

export function useMarketData(symbol: string, channels: Array<'quotes' | 'orderbook' | 'trades'> = ['quotes', 'orderbook', 'trades']) {
  const [quote, setQuote] = useState<QuoteMsg | null>(null);
  const [orderbook, setOrderbook] = useState<{ bids: { price: number; quantity: number }[]; asks: { price: number; quantity: number }[] }>({ bids: [], asks: [] });
  const [lastTrade, setLastTrade] = useState<TradeMsg | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  
  const url = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const env = process.env.NEXT_PUBLIC_WS_URL || '/ws/v1/market-data';
    
    // If env is already a full WebSocket URL, use it directly
    if (env.startsWith('ws://') || env.startsWith('wss://')) return env;
    
    // Build WebSocket URL based on current location
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    
    // For Docker Compose setup: when accessing via port 80 (nginx), don't add port
    // For direct frontend access: when on port 3000, also don't add port (Next.js proxy handles it)
    const port = (window.location.port && window.location.port !== '80' && window.location.port !== '3000') 
      ? `:${window.location.port}` : '';
    
    return `${proto}//${host}${port}${env.startsWith('/') ? env : `/${env}`}`;
  }, []);
  
  // Stabilize channels array to prevent unnecessary reconnections
  const stableChannels = useMemo(() => channels.join(','), [channels]);
  const channelsArray = useMemo(() => stableChannels.split(','), [stableChannels]);

  useEffect(() => {
    if (!symbol || !url) return;
    
    // Don't reconnect if there's already a connection to the same symbol
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected, not reconnecting');
      return;
    }
    
    let isCleanup = false;
    
    const connect = () => {
      if (isCleanup) return;
      
      // Clear any existing timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      
      console.log('Connecting to WebSocket:', url);
      const ws = new WebSocket(url);
      wsRef.current = ws;
      
      ws.onopen = () => {
        console.log('WebSocket connected successfully');
        // Send subscription with current channels and symbol
        const payload = { action: 'subscribe' as const, symbols: [symbol], channels: channelsArray };
        ws.send(JSON.stringify(payload));
        console.log('Subscription sent:', payload);
      };
      
      ws.onmessage = (ev) => {
        try {
          const msg: MarketMsg = JSON.parse(ev.data);
          
          if (msg.type === 'subscription_ack') {
            console.log('Subscription acknowledged for:', msg.symbols);
          } else if (msg.type === 'heartbeat') {
            // Heartbeat received - connection is alive
          } else if (msg.type === 'quote' && msg.symbol === symbol) {
            setQuote(msg);
          } else if (msg.type === 'orderbook' && msg.symbol === symbol) {
            setOrderbook({ bids: msg.bids, asks: msg.asks });
          } else if (msg.type === 'trade' && msg.symbol === symbol) {
            setLastTrade(msg);
          }
        } catch (error) {
          console.warn('Failed to parse WebSocket message:', error);
        }
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
      
      ws.onclose = (event) => {
        console.log(`WebSocket closed: ${event.code} - ${event.reason}`);
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
        
        // Only reconnect on abnormal closures and if not cleaning up
        if (!isCleanup && event.code !== 1000 && event.code !== 1001) {
          console.log('Reconnecting in 5 seconds...');
          reconnectTimeoutRef.current = setTimeout(connect, 5000);
        }
      };
    };
    
    // Delay initial connection to avoid rapid reconnections
    const connectTimeout = setTimeout(connect, 100);
    
    return () => {
      console.log('Cleaning up WebSocket connection');
      isCleanup = true;
      clearTimeout(connectTimeout);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounting');
        wsRef.current = null;
      }
    };
  }, [url, symbol, channelsArray]); // Include channelsArray dependency

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

