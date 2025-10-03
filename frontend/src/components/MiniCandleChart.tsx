"use client";

import { useEffect, useMemo, useRef } from 'react';
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { ColorType, CrosshairMode, createChart } from 'lightweight-charts';
import type { Candle } from '../hooks/useMarketData';

export default function MiniCandleChart({ candles }: { candles: Candle[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);

  const data = useMemo(() => {
    if (!candles.length) return [] as { time: UTCTimestamp; value: number }[];
    return candles.map((c) => ({
      time: Math.floor(c.t / 1000) as UTCTimestamp,
      value: c.c,
    }));
  }, [candles]);

  useEffect(() => {
    if (!containerRef.current || chartRef.current) {
      return;
    }

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#CBD5F5',
      },
      rightPriceScale: {
        visible: false,
      },
      timeScale: {
        visible: false,
        borderVisible: false,
      },
      grid: {
        horzLines: { visible: false },
        vertLines: { visible: false },
      },
      handleScale: false,
      handleScroll: false,
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { visible: false },
        horzLine: { visible: false },
      },
      autoSize: true,
    });

    const series = chart.addAreaSeries({
      lineColor: '#6366F1',
      topColor: 'rgba(99, 102, 241, 0.45)',
      bottomColor: 'rgba(99, 102, 241, 0.05)',
      lineWidth: 2,
      priceLineVisible: false,
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
    if (!data.length) {
      seriesRef.current.setData([]);
      return;
    }
    seriesRef.current.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  return <div ref={containerRef} className="h-24 w-full" />;
}
