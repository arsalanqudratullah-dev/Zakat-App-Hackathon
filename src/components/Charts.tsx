/**
 * All chart infrastructure and visualizations in one place: theming,
 * the shared ECharts wrapper, the card/table shell, and the four
 * concrete charts (classification bar, composition pie, hawl timeline,
 * zakat waterfall). Consolidated from the former src/charts/*.
 *
 * Note: these charts are no longer individually code-split via
 * React.lazy() the way they were before (see src/charts/lazy.tsx in the
 * original project) — they're now one bundle that loads together. Visually
 * and functionally identical; only the loading granularity changed.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import * as echarts from 'echarts/core';
import { LineChart, BarChart, PieChart, CustomChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  MarkAreaComponent,
  DataZoomComponent,
  GraphicComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import * as M from '../engine';
import type { Money, BalanceSeries, HawlEvaluation } from '../engine';
import { sampleForChart } from '../engine';
import type { Classification, ClassificationSummary, ZakatResult } from '../types';
import { CLASSIFICATION_LABELS } from '../types';

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  MarkAreaComponent,
  DataZoomComponent,
  GraphicComponent,
  CanvasRenderer,
]);

// ============================== theme (theme.ts) ==============================
export interface ChartTheme {
  ink: string;
  inkSoft: string;
  inkMute: string;
  surface: string;
  ground: string;
  line: string;
  lineSoft: string;
  accent: string;
  status: Record<Classification, string>;
  isDark: boolean;
}

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = styles.getPropertyValue(name).trim();
  return v || fallback;
}

export function readChartTheme(): ChartTheme {
  if (typeof window === 'undefined') return FALLBACK_THEME;
  const styles = getComputedStyle(document.documentElement);
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  return {
    ink: readVar(styles, '--ink', '#0c1b2e'),
    inkSoft: readVar(styles, '--ink-soft', '#40536b'),
    inkMute: readVar(styles, '--ink-mute', '#75859a'),
    surface: readVar(styles, '--surface', '#ffffff'),
    ground: readVar(styles, '--ground', '#faf8f4'),
    line: readVar(styles, '--line', '#e2ddd2'),
    lineSoft: readVar(styles, '--line-soft', '#efeae0'),
    accent: readVar(styles, '--accent', '#96700c'),
    status: {
      halal: readVar(styles, '--data-halal', '#04836e'),
      mixed: readVar(styles, '--data-mixed', '#b5710a'),
      tentative: readVar(styles, '--data-tentative', '#5561da'),
      haram: readVar(styles, '--data-haram', '#cb343a'),
      missing_information: readVar(styles, '--data-unknown', '#8a94a3'),
      excluded: readVar(styles, '--data-unknown', '#8a94a3'),
    },
    isDark,
  };
}

const FALLBACK_THEME: ChartTheme = {
  ink: '#0c1b2e',
  inkSoft: '#40536b',
  inkMute: '#75859a',
  surface: '#ffffff',
  ground: '#faf8f4',
  line: '#e2ddd2',
  lineSoft: '#efeae0',
  accent: '#96700c',
  status: {
    halal: '#04836e',
    mixed: '#b5710a',
    tentative: '#5561da',
    haram: '#cb343a',
    missing_information: '#8a94a3',
    excluded: '#8a94a3',
  },
  isDark: false,
};

export const FONT_SANS = '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif';
export const FONT_MONO = '"IBM Plex Mono", ui-monospace, monospace';

export function axisCommon(theme: ChartTheme) {
  return {
    axisLine: { lineStyle: { color: theme.line, width: 1 } },
    axisTick: { show: false },
    axisLabel: { color: theme.inkMute, fontFamily: FONT_SANS, fontSize: 11 },
    splitLine: { lineStyle: { color: theme.lineSoft, width: 1, type: 'solid' as const } },
  };
}

export function tooltipCommon(theme: ChartTheme) {
  return {
    backgroundColor: theme.surface,
    borderColor: theme.line,
    borderWidth: 1,
    padding: [10, 12] as [number, number],
    textStyle: { color: theme.ink, fontFamily: FONT_SANS, fontSize: 12 },
    extraCssText: `box-shadow: 0 10px 30px -12px rgba(0,0,0,${theme.isDark ? 0.7 : 0.2}); border-radius: 8px;`,
  };
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ====================== ECharts wrapper (EChart.tsx) =========================

interface EChartProps {
  build: (theme: ChartTheme) => EChartsOption;
  height?: number;
  className?: string;
  ariaLabel: string;
}

export function EChart({ build, height = 280, className = '', ariaLabel }: EChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [themeTick, setThemeTick] = useState(0);

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeTick((t) => t + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!hostRef.current) return;

    if (!chartRef.current) {
      chartRef.current = echarts.init(hostRef.current, undefined, {
        renderer: 'canvas',
        useDirtyRect: true,
      });
    }
    const chart = chartRef.current;
    const theme = readChartTheme();
    const option = build(theme);

    chart.setOption(
      {
        animation: !prefersReducedMotion(),
        animationDuration: 520,
        animationEasing: 'cubicOut',
        ...option,
      },
      { notMerge: true }
    );

    const resize = () => chart.resize();
    const ro = new ResizeObserver(resize);
    ro.observe(hostRef.current);
    window.addEventListener('resize', resize);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [build, themeTick]);

  useEffect(
    () => () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    },
    []
  );

  return <div ref={hostRef} className={className} style={{ height, width: '100%' }} role="img" aria-label={ariaLabel} />;
}

// ===================== Card shell + table (ChartCard.tsx) ====================
interface ChartCardProps {
  title: string;
  caption?: string;
  chart: ReactNode;
  table: ReactNode;
  actions?: ReactNode;
}

export function ChartCard({ title, caption, chart, table, actions }: ChartCardProps) {
  const [showTable, setShowTable] = useState(false);

  return (
    <figure className="m-0 rounded-xl border border-[var(--line)] bg-[var(--surface)] overflow-hidden [box-shadow:var(--shadow-card)]">
      <figcaption className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <h3 className="font-display text-[17px] leading-tight text-[var(--ink)]">{title}</h3>
          {caption && <p className="mt-1 text-[12.5px] leading-snug text-[var(--ink-mute)] max-w-prose">{caption}</p>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {actions}
          <button
            onClick={() => setShowTable((v) => !v)}
            aria-pressed={showTable}
            className="rounded-md border border-[var(--line)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink-soft)] transition-colors duration-200 hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            {showTable ? 'Chart' : 'Table'}
          </button>
        </div>
      </figcaption>

      <div className="px-2 pb-3">
        {showTable ? (
          <div className="animate-fade max-h-[320px] overflow-auto px-3">{table}</div>
        ) : (
          <div className="animate-fade">{chart}</div>
        )}
      </div>
    </figure>
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-[12.5px] tnum">
      <thead>
        <tr className="border-b border-[var(--line)] text-left">
          {head.map((h, i) => (
            <th
              key={h}
              className={`py-2 font-medium text-[var(--ink-mute)] text-[11px] uppercase tracking-wide ${i > 0 ? 'text-right' : ''}`}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-[var(--line-soft)] last:border-0">
            {r.map((cell, j) => (
              <td key={j} className={`py-1.5 ${j > 0 ? 'text-right text-[var(--ink)]' : 'text-[var(--ink-soft)]'}`}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// =================== Classification bar (ClassificationBar.tsx) ===============
const ORDER: Classification[] = ['halal', 'mixed', 'tentative', 'missing_information', 'haram'];
const TOKEN: Record<string, string> = {
  halal: '--data-halal',
  mixed: '--data-mixed',
  tentative: '--data-tentative',
  missing_information: '--data-unknown',
  haram: '--data-haram',
};

export function ClassificationBar({ summary }: { summary: ClassificationSummary }) {
  const present = ORDER.filter((c) => !M.isZero(summary.totalsByClassification[c]));

  const build = useCallback(
    (theme: ChartTheme): EChartsOption => {
      const read = (token: string) =>
        getComputedStyle(document.documentElement).getPropertyValue(token).trim() || theme.ink;
      const cats = [...present].reverse();

      return {
        grid: { left: 4, right: 76, top: 6, bottom: 4, containLabel: true },
        tooltip: {
          trigger: 'item',
          ...tooltipCommon(theme),
          formatter: (params: unknown) => {
            const p = params as { name: string; value: number; color: string; dataIndex: number };
            const cls = cats[p.dataIndex];
            return `
              <div style="font-family:${FONT_SANS}">
                <div style="display:flex;align-items:center;gap:7px;font-weight:600">
                  <span style="width:9px;height:9px;border-radius:2px;background:${p.color};display:inline-block"></span>
                  ${p.name}
                </div>
                <div style="font-size:14px;margin-top:4px">${M.format(M.fromDollars(p.value))}</div>
                <div style="color:${theme.inkMute};font-size:11px">
                  ${summary.counts[cls]} transaction${summary.counts[cls] === 1 ? '' : 's'}
                </div>
              </div>`;
          },
        },
        xAxis: {
          type: 'value',
          ...axisCommon(theme),
          axisLine: { show: false },
          axisLabel: {
            color: theme.inkMute,
            fontFamily: FONT_SANS,
            fontSize: 11,
            formatter: (v: number) => M.formatCompact(M.fromDollars(v)),
          },
        },
        yAxis: {
          type: 'category',
          data: cats.map((c) => CLASSIFICATION_LABELS[c]),
          ...axisCommon(theme),
          splitLine: { show: false },
          axisLabel: { color: theme.inkSoft, fontFamily: FONT_SANS, fontSize: 12 },
        },
        series: [
          {
            type: 'bar',
            barMaxWidth: 20,
            barMinHeight: 2,
            data: cats.map((c) => ({
              value: M.toDollars(summary.totalsByClassification[c]),
              itemStyle: { color: read(TOKEN[c]), borderRadius: [0, 1, 1, 0] },
            })),
            label: {
              show: true,
              position: 'right',
              distance: 8,
              color: theme.inkSoft,
              fontFamily: FONT_SANS,
              fontSize: 11,
              formatter: (p) => M.format(M.fromDollars(Number(p.value ?? 0))),
            },
          },
        ],
      };
    },
    [present, summary.counts, summary.totalsByClassification]
  );

  const rows = present.map((c) => [
    CLASSIFICATION_LABELS[c],
    String(summary.counts[c]),
    M.format(summary.totalsByClassification[c]),
  ]);

  return (
    <ChartCard
      title="Income by classification"
      caption="Every classified transaction, grouped by the verdict the rules produced."
      chart={
        <EChart
          height={Math.max(140, present.length * 38 + 40)}
          build={build}
          ariaLabel="Income by classification, one bar per verdict."
        />
      }
      table={<DataTable head={['Classification', 'Count', 'Amount']} rows={rows} />}
    />
  );
}

// ===================== Composition pie (CompositionPie.tsx) ===================
export interface Slice {
  key: string;
  label: string;
  value: Money;
  token: string;
}

interface CompositionPieProps {
  title: string;
  caption?: string;
  slices: Slice[];
  centreLabel?: string;
}

export function CompositionPie({ title, caption, slices, centreLabel }: CompositionPieProps) {
  const present = slices.filter((s) => !M.isZero(s.value));
  const total = M.sum(present.map((s) => s.value));

  const build = useCallback(
    (theme: ChartTheme): EChartsOption => {
      const read = (token: string) =>
        getComputedStyle(document.documentElement).getPropertyValue(token).trim() || theme.ink;

      return {
        tooltip: {
          trigger: 'item',
          ...tooltipCommon(theme),
          formatter: (params: unknown) => {
            const p = params as { name: string; value: number; color: string; percent: number };
            return `
              <div style="font-family:${FONT_SANS}">
                <div style="display:flex;align-items:center;gap:7px;font-weight:600">
                  <span style="width:9px;height:9px;border-radius:2px;background:${p.color};display:inline-block"></span>
                  ${p.name}
                </div>
                <div style="font-size:14px;margin-top:4px">${M.format(M.fromDollars(p.value))}</div>
                <div style="color:${theme.inkMute};font-size:11px">${p.percent}% of the total</div>
              </div>`;
          },
        },
        series: [
          {
            type: 'pie',
            radius: ['52%', '78%'],
            center: ['50%', '50%'],
            avoidLabelOverlap: true,
            minAngle: 2,
            padAngle: 1,
            itemStyle: { borderWidth: 0 },
            label: {
              show: true,
              formatter: (p) => `{n|${p.name}}\n{v|${M.formatCompact(M.fromDollars(Number(p.value ?? 0)))}}`,
              rich: {
                n: { color: theme.inkSoft, fontFamily: FONT_SANS, fontSize: 11, lineHeight: 15 },
                v: { color: theme.ink, fontFamily: FONT_SANS, fontSize: 12, fontWeight: 600, lineHeight: 15 },
              },
            },
            labelLine: { length: 10, length2: 12, lineStyle: { color: theme.line } },
            data: present.map((s) => ({
              name: s.label,
              value: M.toDollars(s.value),
              itemStyle: { color: read(s.token) },
            })),
          },
        ],
        graphic: centreLabel
          ? [
              {
                type: 'text',
                left: 'center',
                top: 'middle',
                style: {
                  text: `${centreLabel}\n${M.formatCompact(total)}`,
                  align: 'center',
                  fill: theme.ink,
                  fontFamily: FONT_SANS,
                  fontSize: 13,
                  lineHeight: 19,
                },
              },
            ]
          : undefined,
      };
    },
    [present, total, centreLabel]
  );

  const rows = present.map((s) => [
    s.label,
    M.format(s.value),
    M.toCents(total) === 0 ? '0%' : `${((M.toCents(s.value) / M.toCents(total)) * 100).toFixed(1)}%`,
  ]);
  rows.push(['Total', M.format(total), '100%']);

  return (
    <ChartCard
      title={title}
      caption={caption}
      chart={<EChart height={300} build={build} ariaLabel={`${title}. Composition ring.`} />}
      table={<DataTable head={['Category', 'Amount', 'Share']} rows={rows} />}
    />
  );
}

// ====================== Hawl timeline (HawlTimeline.tsx) ======================
interface HawlTimelineProps {
  series: BalanceSeries;
  hawl: HawlEvaluation;
  nisabThreshold: Money;
}

export function HawlTimeline({ series, hawl, nisabThreshold }: HawlTimelineProps) {
  const points = sampleForChart(series, 400);

  const build = useCallback(
    (theme: ChartTheme): EChartsOption => {
      const data = points.map((p) => [p.date, M.toDollars(p.balance)] as [string, number]);
      const nisabDollars = M.toDollars(nisabThreshold);

      const belowBands: { xAxis: string }[][] = [];
      let runStart: string | null = null;
      for (const p of points) {
        const below = !M.gte(p.balance, nisabThreshold);
        if (below && runStart === null) runStart = p.date;
        if (!below && runStart !== null) {
          belowBands.push([{ xAxis: runStart }, { xAxis: p.date }]);
          runStart = null;
        }
      }
      if (runStart !== null) belowBands.push([{ xAxis: runStart }, { xAxis: points[points.length - 1].date }]);

      const marks: { xAxis: string; name: string; color: string }[] = [];
      if (hawl.anchorDate) marks.push({ xAxis: hawl.anchorDate, name: 'Year begins', color: theme.status.halal });
      if (hawl.dueDate) marks.push({ xAxis: hawl.dueDate, name: 'Zakat due', color: theme.accent });

      return {
        grid: { left: 8, right: 16, top: 28, bottom: 24, containLabel: true },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'line', lineStyle: { color: theme.inkMute, width: 1 } },
          ...tooltipCommon(theme),
          formatter: (params: unknown) => {
            const arr = params as { axisValue: string; data: [string, number] }[];
            if (!arr?.length) return '';
            const value = arr[0].data[1];
            const above = value >= nisabDollars;
            return `
              <div style="font-family:${FONT_SANS}">
                <div style="color:${theme.inkMute};font-size:11px;margin-bottom:4px">${arr[0].axisValue}</div>
                <div style="font-weight:600;font-size:14px">${M.format(M.fromDollars(value))}</div>
                <div style="color:${above ? theme.status.halal : theme.status.haram};font-size:11px;margin-top:3px">
                  ${above ? 'At or above nisab' : 'Below nisab'}
                </div>
              </div>`;
          },
        },
        xAxis: { type: 'time', ...axisCommon(theme), splitLine: { show: false } },
        yAxis: {
          type: 'value',
          ...axisCommon(theme),
          axisLine: { show: false },
          axisLabel: {
            color: theme.inkMute,
            fontFamily: FONT_SANS,
            fontSize: 11,
            formatter: (v: number) => M.formatCompact(M.fromDollars(v)),
          },
        },
        series: [
          {
            type: 'line',
            name: 'Wealth held',
            data,
            showSymbol: false,
            smooth: 0.15,
            lineStyle: { width: 2, color: theme.status.halal },
            areaStyle: {
              opacity: theme.isDark ? 0.16 : 0.1,
              color: theme.status.halal,
            },
            markArea: belowBands.length
              ? {
                  silent: true,
                  itemStyle: { color: theme.status.haram, opacity: theme.isDark ? 0.13 : 0.07 },
                  data: belowBands as never,
                }
              : undefined,
            markLine: {
              silent: true,
              symbol: 'none',
              label: {
                formatter: (p: { name?: string }) => p.name ?? '',
                color: theme.inkMute,
                fontFamily: FONT_SANS,
                fontSize: 10,
                position: 'insideEndTop',
              },
              lineStyle: { color: theme.inkMute, width: 1, type: 'dashed' },
              data: [
                {
                  yAxis: nisabDollars,
                  name: `Nisab ${M.formatCompact(nisabThreshold)}`,
                  lineStyle: { color: theme.accent, width: 1.5, type: 'dashed' },
                  label: { color: theme.accent, fontSize: 10, position: 'insideStartTop' },
                },
                ...marks.map((m) => ({
                  xAxis: m.xAxis,
                  name: m.name,
                  lineStyle: { color: m.color, width: 1.5, type: 'solid' as const },
                  label: { color: m.color, fontSize: 10, position: 'insideEndTop' as const },
                })),
              ] as never,
            },
          },
        ],
      };
    },
    [points, hawl.anchorDate, hawl.dueDate, nisabThreshold]
  );

  const rows: (string | number)[][] = [];
  if (points.length) {
    rows.push(['First record', points[0].date, M.format(points[0].balance)]);
    if (hawl.anchorDate) rows.push(['Zakat year begins', hawl.anchorDate, M.format(hawl.anchorBalance ?? M.ZERO)]);
    const lowest = points.reduce((a, b) => (b.balance < a.balance ? b : a));
    const highest = points.reduce((a, b) => (b.balance > a.balance ? b : a));
    rows.push(['Lowest balance', lowest.date, M.format(lowest.balance)]);
    rows.push(['Highest balance', highest.date, M.format(highest.balance)]);
    if (hawl.dueDate) rows.push(['Zakat falls due', hawl.dueDate, '·']);
    rows.push(['Latest balance', points[points.length - 1].date, M.format(series.closingBalance)]);
    rows.push(['Nisab threshold', '·', M.format(nisabThreshold)]);
  }

  return (
    <ChartCard
      title="Holding period"
      caption={`Wealth held against the nisab threshold. Shaded stretches fall below it${hawl.dips.length ? `, ${hawl.dips.length} such day${hawl.dips.length === 1 ? '' : 's'} recorded` : ''}.`}
      chart={
        <EChart
          height={300}
          build={build}
          ariaLabel="Wealth held over time against the nisab threshold, with the start and end of the lunar year marked."
        />
      }
      table={<DataTable head={['Milestone', 'Date', 'Balance']} rows={rows} />}
    />
  );
}

// ==================== Zakat waterfall (ZakatWaterfall.tsx) ====================
export function ZakatWaterfall({ result }: { result: ZakatResult }) {
  const lines = result.breakdown.filter((l) => !l.informational && !M.isZero(l.amount));

  const build = useCallback(
    (theme: ChartTheme): EChartsOption => {
      const labels: string[] = [];
      const offsets: number[] = [];
      const values: number[] = [];
      const colors: string[] = [];

      let running = 0;
      for (const l of lines) {
        const v = M.toDollars(l.amount);
        labels.push(l.label);
        if (v >= 0) {
          offsets.push(running);
          values.push(v);
          colors.push(theme.status.halal);
        } else {
          offsets.push(running + v);
          values.push(-v);
          colors.push(theme.status.haram);
        }
        running += v;
      }

      labels.push('Zakatable wealth');
      offsets.push(0);
      values.push(running);
      colors.push(theme.accent);

      return {
        grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow', shadowStyle: { color: theme.lineSoft, opacity: 0.5 } },
          ...tooltipCommon(theme),
          formatter: (params: unknown) => {
            const arr = params as { dataIndex: number; name: string }[];
            if (!arr?.length) return '';
            const i = arr[0].dataIndex;
            const isTotal = i === lines.length;
            const amount = isTotal ? M.fromDollars(values[i]) : lines[i].amount;
            const note = isTotal ? result.formula : lines[i].note;
            return `
              <div style="font-family:${FONT_SANS};max-width:260px">
                <div style="font-weight:600;margin-bottom:2px">${arr[0].name}</div>
                <div style="font-size:14px">${M.formatSigned(amount)}</div>
                ${note ? `<div style="color:${theme.inkMute};font-size:11px;margin-top:5px;white-space:normal;line-height:1.45">${note}</div>` : ''}
              </div>`;
          },
        },
        xAxis: {
          type: 'category',
          data: labels,
          ...axisCommon(theme),
          splitLine: { show: false },
          axisLabel: {
            color: theme.inkMute,
            fontFamily: FONT_SANS,
            fontSize: 10,
            interval: 0,
            width: 84,
            overflow: 'break',
            lineHeight: 12,
          },
        },
        yAxis: {
          type: 'value',
          ...axisCommon(theme),
          axisLine: { show: false },
          axisLabel: {
            color: theme.inkMute,
            fontFamily: FONT_SANS,
            fontSize: 11,
            formatter: (v: number) => M.formatCompact(M.fromDollars(v)),
          },
        },
        series: [
          {
            type: 'bar',
            stack: 'wf',
            silent: true,
            itemStyle: { color: 'transparent' },
            emphasis: { itemStyle: { color: 'transparent' } },
            data: offsets,
          },
          {
            type: 'bar',
            stack: 'wf',
            barMaxWidth: 46,
            barCategoryGap: '34%',
            barMinHeight: 2,
            data: values.map((v, i) => ({
              value: v,
              itemStyle: { color: colors[i], borderRadius: 4, borderWidth: 0 },
            })),
            label: {
              show: true,
              position: 'top',
              color: theme.inkSoft,
              fontFamily: FONT_SANS,
              fontSize: 10,
              formatter: (p: { dataIndex: number }) =>
                M.formatCompact(p.dataIndex === lines.length ? M.fromDollars(values[p.dataIndex]) : lines[p.dataIndex].amount),
            },
          },
        ],
      };
    },
    [lines, result.formula]
  );

  const rows = [
    ...lines.map((l) => [l.label, M.formatSigned(l.amount)]),
    ['Zakatable wealth', M.format(result.zakatableWealth)],
    ['Zakat at 2.5%', M.format(result.zakatDue)],
  ];

  return (
    <ChartCard
      title="How the total is built"
      caption="Each line of the wealth formula, in order, with deductions shown falling."
      chart={<EChart height={300} build={build} ariaLabel="Waterfall chart of the zakat wealth calculation." />}
      table={<DataTable head={['Line item', 'Amount']} rows={rows} />}
    />
  );
}
