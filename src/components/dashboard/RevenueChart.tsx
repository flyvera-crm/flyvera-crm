"use client";

import { useEffect, useRef, useState } from "react";
import type { MonthlyRevenue } from "@/types/crm";
import { formatCurrency } from "@/lib/format";

const HEIGHT = 260;
const PAD = { top: 20, right: 56, bottom: 28, left: 48 };
const LINE = "var(--color-sky-brand-dark)";

function niceMax(max: number) {
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? rough;
  return { top: Math.ceil(max / step) * step, step };
}

export function RevenueChart({ data }: { data: MonthlyRevenue[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  // Start with a sensible width so the chart renders on the server (no blank box
  // before JavaScript loads); the ResizeObserver then snaps it to the real width.
  const [width, setWidth] = useState(640);
  const [measured, setMeasured] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
      setMeasured(true);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { top, step } = niceMax(Math.max(...data.map((d) => d.revenue)));
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const innerW = Math.max(width - PAD.left - PAD.right, 0);
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / (data.length - 1)) * innerW;
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;

  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d.revenue)}`).join(" ");
  const area = `${line} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const last = data.length - 1;

  function handleMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    setHover(Math.round(rel * (data.length - 1)));
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") setHover((h) => Math.min((h ?? -1) + 1, last));
    if (e.key === "ArrowLeft") setHover((h) => Math.max((h ?? last + 1) - 1, 0));
    if (e.key === "Escape") setHover(null);
  }

  const active = hover !== null ? data[hover] : null;
  const prev = hover ? data[hover - 1] : null;
  const change = active && prev ? ((active.revenue - prev.revenue) / prev.revenue) * 100 : null;

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height: HEIGHT }}>
      {width > 0 && (
        <svg
          width="100%"
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Monthly revenue, last 12 months. Use left and right arrow keys to inspect months."
          tabIndex={0}
          onKeyDown={handleKey}
          onBlur={() => setHover(null)}
          className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sky-brand/40"
        >
          <defs>
            <linearGradient id="rev-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#0284c7" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#0284c7" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* axis labels + end label are hidden until the real width is known */}
          <g opacity={measured ? 1 : 0}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-navy-50)" strokeWidth={1} />
              <text x={PAD.left - 10} y={y(t)} dy="0.32em" textAnchor="end" className="fill-navy-400 text-[11px] tabular-nums">
                {t === 0 ? "0" : `${t / 1000}K`}
              </text>
            </g>
          ))}

          {data.map((d, i) => (
            <text key={d.month} x={x(i)} y={HEIGHT - 8} textAnchor="middle" className="fill-navy-400 text-[11px]">
              {/* thin out month labels on narrow screens */}
              {innerW < 420 && i % 2 === 1 && i !== last ? "" : d.month}
            </text>
          ))}

          </g>

          <path d={area} fill="url(#rev-fill)" />
          <path d={line} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {/* end-point marker + direct label */}
          <g opacity={measured ? 1 : 0}>
          <circle cx={x(last)} cy={y(data[last].revenue)} r={5} fill={LINE} stroke="white" strokeWidth={2} />
          <text x={x(last) + 10} y={y(data[last].revenue)} dy="0.32em" className="fill-navy-900 text-xs font-semibold">
            {formatCurrency(data[last].revenue, { compact: true })}
          </text>
          </g>

          {hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={y(0)} stroke="var(--color-navy-200)" strokeWidth={1} />
              <circle cx={x(hover)} cy={y(data[hover].revenue)} r={5} fill={LINE} stroke="white" strokeWidth={2} />
            </g>
          )}

          <rect
            x={PAD.left}
            y={PAD.top}
            width={innerW}
            height={innerH}
            fill="transparent"
            onPointerMove={handleMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}

      {active && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 min-w-36 -translate-x-1/2 rounded-xl bg-navy-900 px-3 py-2 text-xs text-white shadow-xl"
          style={{
            left: Math.min(Math.max(x(hover), 80), width - 80),
            top: Math.max(y(active.revenue) - 76, 0),
          }}
        >
          <p className="text-navy-200">{active.month}</p>
          <p className="text-sm font-semibold">{formatCurrency(active.revenue)}</p>
          {change !== null && (
            <p className={change >= 0 ? "text-emerald-300" : "text-rose-300"}>
              {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(1)}% vs {prev?.month}
            </p>
          )}
        </div>
      )}

      {/* Screen-reader data table */}
      <table className="sr-only">
        <caption>Monthly revenue</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.month}>
              <th scope="row">{d.month}</th>
              <td>{formatCurrency(d.revenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
