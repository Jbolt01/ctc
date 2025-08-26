"use client";
import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from 'chart.js';
import type { Candle } from '../hooks/useMarketData';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

export default function MiniCandleChart({ candles }: { candles: Candle[] }) {
  const data = useMemo(() => {
    const labels = candles.map((c) => new Date(c.t).toLocaleTimeString());
    return {
      labels,
      datasets: [
        {
          label: 'Close',
          data: candles.map((c) => c.c),
          borderColor: '#6366F1',
          backgroundColor: 'rgba(99,102,241,0.2)',
          tension: 0.3,
          fill: true,
        },
      ],
    };
  }, [candles]);

  return <Line data={data} options={{ responsive: true, plugins: { legend: { display: false } }, scales: { x: { display: false } } }} />;
}

