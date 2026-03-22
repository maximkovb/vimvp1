"use client";

import { useEffect, useRef } from "react";
import { createChart, type IChartApi, ColorType, AreaSeries } from "lightweight-charts";

interface PriceChartProps {
  data: { time: number; value: number }[];
}

export function PriceChart({ data }: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current || data.length === 0) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#71717a",
      },
      grid: {
        vertLines: { color: "#2a2a3a" },
        horzLines: { color: "#2a2a3a" },
      },
      width: chartContainerRef.current.clientWidth,
      height: 200,
      rightPriceScale: {
        borderColor: "#2a2a3a",
      },
      timeScale: {
        borderColor: "#2a2a3a",
        timeVisible: true,
      },
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: "#6366f1",
      topColor: "rgba(99, 102, 241, 0.3)",
      bottomColor: "rgba(99, 102, 241, 0.0)",
      lineWidth: 2,
      priceFormat: {
        type: "custom",
        formatter: (p: number) => `${(p * 100).toFixed(0)}%`,
      },
    });

    series.setData(data as never);
    chart.timeScale().fitContent();
    chartRef.current = chart;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [data]);

  return <div ref={chartContainerRef} />;
}
