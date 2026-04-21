"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
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
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  // Initialize chart once. Re-initialize only if milestone/metricLabel change (stable after creation).
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
      localization: {
        timeFormatter: (time: UTCTimestamp) =>
          new Date(time * 1000).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }),
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

    series.createPriceLine({
      price: milestone,
      color: "#f59e0b",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: `Target: ${formatCount(milestone)} ${metricLabel}`,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const observer = new ResizeObserver((entries) => {
      chart.applyOptions({ width: entries[0].contentRect.width });
    });
    observer.observe(chartContainerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [milestone, metricLabel]);

  // Update data without recreating the chart.
  useEffect(() => {
    if (!seriesRef.current || data.length === 0) return;
    seriesRef.current.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  return <div ref={chartContainerRef} />;
}
