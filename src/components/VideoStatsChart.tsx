"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  type IChartApi,
  type UTCTimestamp,
  ColorType,
  AreaSeries,
  LineStyle,
} from "lightweight-charts";
import { formatCount } from "@/lib/format";

interface VideoStatsChartProps {
  data: { time: UTCTimestamp; value: number }[];
  milestone: number;
  metricLabel: "views" | "likes";
}

export function VideoStatsChart({
  data,
  milestone,
  metricLabel,
}: VideoStatsChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

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
      height: 280,
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
        formatter: (p: number) => formatCount(p),
      },
    });

    if (data.length > 0) {
      series.setData(data);
      chart.timeScale().fitContent();
    }

    series.createPriceLine({
      price: milestone,
      color: "#f59e0b",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: `Target: ${formatCount(milestone)} ${metricLabel}`,
    });

    chartRef.current = chart;

    const observer = new ResizeObserver((entries) => {
      chart.applyOptions({ width: entries[0].contentRect.width });
    });
    observer.observe(chartContainerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [data, milestone, metricLabel]);

  return <div ref={chartContainerRef} />;
}
