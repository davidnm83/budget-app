// The charts every widget draws with. One look everywhere: thin marks, a quiet grid, colours in a
// fixed order, a legend whenever there is more than one series, and a readout line that shows
// the values under the pointer (hover on a computer, tap on a phone).
import { useEffect, useRef, useState } from 'react';
import { useWide } from '@/lib/layout';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { GROW, SPIN } from '@/lib/motion';
import type { Theme } from '@/lib/theme';

export interface Series { name: string; values: number[] }
interface PlotProps {
  t: Theme; labels: string[]; series: Series[]; height?: number;
  format: (n: number) => string;
  /** Tap a point (second tap on phones, once it is selected) to open what's behind it. */
  onPick?: (i: number) => void;
  /** Colours that belong to the series themselves (an app's colour); otherwise the fixed chart order is used. */
  colors?: string[];
  /** A dashed line across the plot (a target or an average). */
  refLine?: number;
  /** false hides the colour key (when there are too many parts for it to help). */
  legend?: boolean;
  /** Told which point is highlighted (null when none), so numbers above the chart can follow it. */
  onSel?: (i: number | null) => void;
}

/** "Nice" top of the axis: 1, 2, 2.5 or 5 times a power of ten. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}
/** Show at most ~6 x labels, always including the last. */
const showLabel = (i: number, n: number) => { const step = Math.ceil(n / 6); return (n - 1 - i) % step === 0; };

function Legend({ t, series, col }: { t: Theme; series: Series[]; col: (i: number) => string }) {
  if (series.length < 2) return null;
  return (
    <View style={styles.legend}>
      {series.map((s, i) => (
        <View key={s.name} style={styles.legendItem}>
          <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: col(i) }} />
          <Text style={{ color: t.muted, fontSize: 12 }}>{s.name}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The line above the plot that reads out one point. It always takes the same height, so the card
 * doesn't move when you hover or tap: with nothing selected it shows the latest point, dimmed.
 * Stacked charts read out the total, then the biggest parts.
 */
function Readout({ t, labels, series, sel, format, hint, col, stacked }: { t: Theme; labels: string[]; series: Series[]; sel: number | null; format: (n: number) => string; hint?: string; col: (i: number) => string; stacked?: boolean }) {
  const at = sel ?? labels.length - 1;
  const tone = sel == null ? t.muted : t.text;
  const parts = series.map((s, i) => ({ name: s.name, v: s.values[at] ?? 0, i }));
  const list = stacked ? parts.filter((p) => Math.abs(p.v) >= 0.5).sort((a, b) => b.v - a.v) : parts;
  return (
    <View style={styles.readout}>
      <Text style={{ color: tone, fontSize: 12, fontWeight: '700' }}>{labels[at] ?? ''}</Text>
      {stacked && series.length > 1 && <Text style={{ color: tone, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{format(parts.reduce((x, p) => x + p.v, 0))}</Text>}
      {list.map((p) => (
        <View key={p.name} style={styles.legendItem}>
          {series.length > 1 && <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: col(p.i), opacity: sel == null ? 0.6 : 1 }} />}
          <Text numberOfLines={1} style={{ color: tone, fontSize: 12, fontVariant: ['tabular-nums'] }}>{series.length > 1 ? `${p.name} ` : ''}{Number.isFinite(p.v) ? format(p.v) : '–'}</Text>
        </View>
      ))}
      {!!hint && <Text numberOfLines={1} style={{ color: t.muted, fontSize: 12 }}>{hint}</Text>}
    </View>
  );
}

/** Shared frame: readout, y-axis labels, the plot, hit columns and x labels. */
/** What a bar or line chart needs around its plot: the read-out line, the x labels, and the legend when it shows. */
export const plotChrome = (seriesCount: number, legend = true) => 18 + 4 + 15 + (legend && seriesCount > 1 ? 22 : 0);

function Frame({ t, labels, series, height = 140, format, onPick, onSel, free, colors, refLine, stacked, legend = true, also = [], children }: PlotProps & { free?: boolean; stacked?: boolean; also?: number[]; children: (w: number, h: number, min: number, max: number, sel: number | null) => React.ReactNode }) {
  const [w, setW] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => { onSel?.(sel); }, [sel]);
  const wide = useWide(); // with a mouse, hovering reads a point out and one click opens it; on a phone the first tap reads it out
  const all = [...(stacked ? labels.map((_, i) => series.reduce((x, s) => x + (s.values[i] ?? 0), 0)) : series.flatMap((s) => s.values)), ...(refLine != null ? [refLine] : []), ...also].filter(Number.isFinite);
  const col = (i: number) => colors?.[i] ?? t.series[i];
  const lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  let max = hi > 0 || lo >= 0 ? niceMax(hi) : 0, min = lo < 0 ? -niceMax(-lo) : 0;
  // Lines show change, so they may leave zero out when the values sit far from it (a loan-heavy net worth).
  const dLo = Math.min(...all), dHi = Math.max(...all);
  if (free && all.length && (dLo > 0 || dHi < 0) && dHi - dLo < Math.abs(dHi + dLo) / 4) {
    const pad = Math.max((dHi - dLo) * 0.15, Math.abs(dHi) * 0.01, 1);
    const step = niceMax((dHi - dLo + 2 * pad) / 2);
    min = Math.floor((dLo - pad) / step) * step; max = min + 2 * step;
    if (max < dHi) max = min + 3 * step;
  }
  const n = labels.length;
  const ticks = min < 0 && max > 0 ? [max, 0, min] : [max, (max + min) / 2, min];
  // Line charts on a touch screen: drag a finger sideways along the plot and the readout follows it
  // (up and down still scrolls the page).
  const plot = useRef<View>(null);
  useEffect(() => {
    const el = plot.current as unknown as HTMLElement | null;
    if (Platform.OS !== 'web' || !free || !el?.addEventListener || n < 2) return;
    let on = false;
    const at = (e: PointerEvent) => { const b = el.getBoundingClientRect(); return Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - b.left) / b.width) * n))); };
    const down = (e: PointerEvent) => { if (e.pointerType === 'touch') { on = true; } };
    const move = (e: PointerEvent) => { if (on) setSel(at(e)); };
    const up = () => { on = false; };
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('pointerleave', up);
    return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.removeEventListener('pointerleave', up); };
  }, [free, n, w]);
  return (
    <View style={{ gap: 4 }}>
      {legend && <Legend t={t} series={series} col={col} />}
      {n > 0 && <Readout t={t} labels={labels} series={series} sel={sel} format={format} col={col} stacked={stacked} hint={onPick && sel != null && !wide ? 'tap again for details' : undefined} />}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {/* Each label sits at its own value's height (zero isn't always in the middle). The hidden copies give the column its width. */}
        <View style={{ height, alignItems: 'flex-end' }}>
          {ticks.map((v, i) => <Text key={`w${i}`} style={{ fontSize: 10, fontVariant: ['tabular-nums'], lineHeight: 0, height: 0, opacity: 0 }}>{format(v)}</Text>)}
          {ticks.filter((v, i) => i !== 1 || (Math.abs(v - max) > (max - min) * 0.12 && Math.abs(v - min) > (max - min) * 0.12)).map((v) => (
            <Text key={v} style={{ position: 'absolute', right: 0, top: height - ((v - min) / (max - min || 1)) * height - 6, color: t.muted, fontSize: 10, fontVariant: ['tabular-nums'], lineHeight: 12 }}>{format(v)}</Text>
          ))}
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
            {w > 0 && <View style={GROW}>{children(w, height, min, max, sel)}</View>}
            {refLine != null && max > min && <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: height - ((refLine - min) / (max - min)) * height, borderTopWidth: 1, borderStyle: 'dashed', borderColor: t.text, opacity: 0.45 }} />}
            <View ref={plot} {...({ dataSet: { scrub: free ? '1' : undefined } } as any)} style={[StyleSheet.absoluteFill, { flexDirection: 'row' }, free && ({ touchAction: 'pan-y' } as any)]}>
              {labels.map((l, i) => (
                <Pressable key={i} style={{ flex: 1 }} accessibilityLabel={`${l}: ${series.map((s) => `${s.name} ${format(s.values[i] ?? 0)}`).join(', ')}`}
                  onHoverIn={() => setSel(i)} onHoverOut={() => setSel((c) => (c === i ? null : c))}
                  onPress={() => { if ((wide || sel === i) && onPick) onPick(i); else setSel(i); }} />
              ))}
            </View>
          </View>
          <View style={{ flexDirection: 'row', marginTop: 3 }}>
            {labels.map((l, i) => <Text key={i} numberOfLines={1} style={{ flex: 1, textAlign: 'center', color: sel === i ? t.text : t.muted, fontSize: 10, overflow: 'visible' }}>{showLabel(i, n) || sel === i ? l : ''}</Text>)}
          </View>
        </View>
      </View>
    </View>
  );
}

function Grid({ t, w, h, min, max }: { t: Theme; w: number; h: number; min: number; max: number }) {
  const y0 = min > 0 || max < 0 ? h : h * (max / (max - min));
  return (
    <>
      <Line x1={0} x2={w} y1={0.5} y2={0.5} stroke={t.line} strokeWidth={1} />
      {(min >= 0 || max <= 0) && <Line x1={0} x2={w} y1={h / 2} y2={h / 2} stroke={t.line} strokeWidth={1} />}
      <Line x1={0} x2={w} y1={Math.min(h - 0.5, y0)} y2={Math.min(h - 0.5, y0)} stroke={t.muted} strokeOpacity={0.5} strokeWidth={1} />
    </>
  );
}

/** Change over time: one 2px line per series; a single series gets a soft fill to the baseline. */
export function LineChart(props: PlotProps) {
  const { t, series, labels } = props;
  const c = (k: number) => props.colors?.[k] ?? t.series[k];
  const n = labels.length;
  return (
    <Frame {...props} free>
      {(w, h, min, max, sel) => {
        const x = (i: number) => (n === 1 ? w / 2 : (w / n) * (i + 0.5));
        const y = (v: number) => h - ((v - min) / (max - min)) * h;
        const zero = min <= 0 && max >= 0; // only fill down to a baseline that is on the chart
        return (
          <Svg width={w} height={h}>
            <Grid t={t} w={w} h={h} min={min} max={max} />
            {sel != null && <Line x1={x(sel)} x2={x(sel)} y1={0} y2={h} stroke={t.muted} strokeWidth={1} />}
            {series.map((s, k) => {
              // A value that isn't a number is a gap: the line stops there and starts again after it.
              const d = s.values.map((v, i) => (Number.isFinite(v) ? `${i && Number.isFinite(s.values[i - 1]) ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}` : '')).filter(Boolean).join(' ');
              let last = s.values.length - 1;
              while (last > 0 && !Number.isFinite(s.values[last])) last--;
              const at = sel != null && Number.isFinite(s.values[sel]) ? sel : last;
              return (
                [
                  series.length === 1 && n > 1 && zero ? <Path key={`${s.name}-a`} d={`${d} L${x(last).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`} fill={c(k)} fillOpacity={0.12} /> : null,
                  <Path key={`${s.name}-l`} d={d} stroke={c(k)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" fill="none" />,
                  <Circle key={`${s.name}-c`} cx={x(at)} cy={y(Number.isFinite(s.values[at]) ? s.values[at] : 0)} r={Number.isFinite(s.values[at]) ? 4 : 0} fill={c(k)} stroke={t.card} strokeWidth={2} />,
                ]
              );
            })}
          </Svg>
        );
      }}
    </Frame>
  );
}

/**
 * Amounts side by side: bars grow from the zero line. Several series sit in a group, or on top of
 * each other when `stacked`. `barColor` recolours single bars (a status colour); `outline` draws a
 * dashed extension above one bar (where this month is heading).
 */
export function BarChart(props: PlotProps & { stacked?: boolean; barColor?: (i: number) => string | undefined; outline?: { i: number; value: number; color: string } }) {
  const { t, series, labels, stacked, barColor, outline } = props;
  const n = labels.length;
  const c = (k: number) => props.colors?.[k] ?? t.series[k];
  return (
    <Frame {...props} also={outline ? [outline.value] : []}>
      {(w, h, min, max, sel) => {
        const slot = w / n;
        const cols = stacked ? 1 : series.length;
        const group = Math.min(slot * 0.72, 44 * cols);
        const bw = Math.max(2, (group - 2 * (cols - 1)) / cols);
        const y = (v: number) => h - ((v - min) / (max - min)) * h;
        const r = Math.min(4, bw / 2);
        const bar = (x0: number, from: number, to: number, round: boolean) => {
          const top = y(Math.max(from, to)), bot = y(Math.min(from, to));
          const hh = Math.max(1, bot - top), rr = round ? Math.min(r, hh) : 0;
          return to >= from
            ? `M${x0},${bot} L${x0},${top + rr} Q${x0},${top} ${x0 + rr},${top} L${x0 + bw - rr},${top} Q${x0 + bw},${top} ${x0 + bw},${top + rr} L${x0 + bw},${bot} Z`
            : `M${x0},${top} L${x0},${bot - rr} Q${x0},${bot} ${x0 + rr},${bot} L${x0 + bw - rr},${bot} Q${x0 + bw},${bot} ${x0 + bw},${bot - rr} L${x0 + bw},${top} Z`;
        };
        const gap = (2 / h) * (max - min); // 2px of surface between stacked segments
        return (
          <Svg width={w} height={h}>
            <Grid t={t} w={w} h={h} min={min} max={max} />
            {labels.map((_, i) => {
              const x = slot * i + (slot - group) / 2;
              const dim = sel == null || sel === i ? 1 : 0.45;
              if (stacked) {
                let acc = 0;
                const live = series.map((s, k) => ({ k, v: s.values[i] ?? 0 })).filter((p) => p.v > 0);
                return live.map((p, j) => { const from = acc; acc += p.v; return <Path key={`${p.k}-${i}`} d={bar(x, from + (j ? gap : 0), acc, j === live.length - 1)} fill={c(p.k)} fillOpacity={dim} />; });
              }
              return series.map((s, k) => (s.values[i] ? <Path key={`${k}-${i}`} d={bar(x + k * (bw + 2), 0, s.values[i], true)} fill={barColor?.(i) ?? c(k)} fillOpacity={dim} /> : null));
            })}
            {outline && outline.value > (series[0]?.values[outline.i] ?? 0) && (() => {
              const x = slot * outline.i + (slot - group) / 2;
              return <Path d={bar(x, series[0].values[outline.i] ?? 0, outline.value, true)} fill="none" stroke={outline.color} strokeWidth={1.5} strokeDasharray="4 3" />;
            })()}
          </Svg>
        );
      }}
    </Frame>
  );
}

export interface Slice { label: string; value: number; onPress?: () => void }
const LEGEND_ROW = 26, LEGEND_COL = 200;
/**
 * Shares of a whole, as a ring with the total in the middle, drawn as big as the space allows.
 * The legend carries the numbers; it goes beside the ring or under it, whichever leaves the ring
 * bigger, in two columns when there's room, and scrolls when the parts don't all fit. With the
 * legend off the ring takes the whole space, and a tap on a slice shows it in the middle (a second
 * tap opens what's behind it, as on the other charts). At most as many named slices as there are
 * chart colours; the rest are gathered as "N others".
 */
/**
 * How a pie names its slices. around: each label sits outside its slice on a short line;
 * list: a legend beside or under the ring; none: the ring alone (tap a slice).
 * auto: around when the card is wide enough for labels on both sides, otherwise the list.
 */
export type PieLabels = 'auto' | 'around' | 'list' | 'none';

export function Donut({ t, slices, format, note, width, height, labels = 'auto' }: { t: Theme; slices: Slice[]; format: (n: number) => string; note?: string; width: number; height: number; labels?: PieLabels }) {
  const [sel, setSel] = useState<number | null>(null);
  const ring = useRef<View>(null);
  const most = t.series.length;
  const keep = slices.length <= most ? slices.length : most - 1;
  const top = slices.slice(0, keep);
  const rest = slices.slice(keep).reduce((s, x) => s + x.value, 0);
  const parts: (Slice & { color: string })[] = top.map((s, i) => ({ ...s, color: t.series[i % t.series.length] }));
  if (rest > 0) parts.push({ label: `${slices.length - keep} others`, value: rest, color: t.muted });
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return <Text style={{ color: t.muted }}>Nothing to show{note ? ` ${note}` : ''}.</Text>;
  const lay = labels === 'auto' || labels === 'around' ? radialLayout(parts, total, width, height, (i) => `${Math.round((parts[i].value / total) * 100)}% · ${format(parts[i].value)}`) : null;
  // Automatic: around the ring when that leaves a good-sized ring, otherwise the separate legend.
  const mode = labels === 'auto' ? (lay && lay.size >= 130 ? 'around' : 'list') : labels === 'around' && !lay ? 'list' : labels;
  if (mode === 'around' && lay) return <AroundPie t={t} parts={parts} total={total} format={format} note={note} width={width} height={height} lay={lay} />;
  const legend = mode === 'list';

  // Beside or under: whichever gives the bigger ring (beside wins a tie: it reads better on a wide card).
  const GAP = 14;
  // Beside needs room for a readable legend; on a phone-width card it goes underneath instead.
  const beside = Math.min(height, width - GAP - LEGEND_COL);
  const under = Math.min(width, height - GAP - Math.min(parts.length, 3) * LEGEND_ROW);
  const across = !legend || beside >= under;
  const size = Math.max(60, Math.floor(!legend ? Math.min(width, height) : Math.max(beside, under)));
  const room = across ? width - size - GAP : width;
  // A wide card shares the parts out over columns, each no wider than reads well; the block sits by the ring.
  const rowsFit = Math.max(1, Math.floor((across ? height : height - size - GAP) / LEGEND_ROW));
  const cols = across ? Math.max(1, Math.min(3, Math.floor((room + 16) / (LEGEND_COL + 16)), Math.ceil(parts.length / rowsFit))) : 1;
  const colW = across ? Math.min(300, (room - (cols - 1) * 16) / cols) : room;
  const legendW = cols * colW + (cols - 1) * 16;

  const R = size / 2, sw = Math.max(14, size * 0.2), r = R - sw / 2, C = 2 * Math.PI * r;
  let acc = 0;
  const ends = parts.map((p) => (acc += p.value / total));
  acc = 0;
  // Which slice is under a tap on the ring: its angle from the top, clockwise.
  const pickAt = (e: any) => {
    const el = ring.current as unknown as HTMLElement | null;
    const box = el?.getBoundingClientRect?.();
    const x = box ? e.nativeEvent.pageX - box.left - window.scrollX : e.nativeEvent.locationX, y = box ? e.nativeEvent.pageY - box.top - window.scrollY : e.nativeEvent.locationY;
    const dx = x - R, dy = y - R, d = Math.hypot(dx, dy);
    if (d < r - sw / 2 - 6 || d > R + 6) { setSel(null); return; }
    const f = ((Math.atan2(dx, -dy) / (2 * Math.PI)) + 1) % 1;
    const i = ends.findIndex((v) => f <= v);
    if (i < 0) return;
    if (sel === i) parts[i].onPress?.(); else setSel(i);
  };
  const shown = sel == null ? null : parts[sel];
  return (
    <View style={{ flex: 1, flexDirection: across ? 'row' : 'column', alignItems: 'center', justifyContent: across || !legend ? 'center' : 'flex-start', gap: GAP }}>
      <Pressable ref={ring} onPress={pickAt} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Chart. Tap a slice for its amount.">
        <Svg width={size} height={size} style={[StyleSheet.absoluteFill, SPIN] as any}>
          {parts.map((p, i) => {
            const len = (p.value / total) * C, off = acc; acc += len;
            // A 2px gap in the surface colour separates neighbours.
            return <Circle key={p.label} cx={R} cy={R} r={r} fill="none" stroke={p.color} strokeWidth={sel === i ? sw + 4 : sw} strokeOpacity={sel == null || sel === i ? 1 : 0.5}
              strokeDasharray={`${Math.max(0, len - 2)} ${C - Math.max(0, len - 2)}`} strokeDashoffset={-off} transform={`rotate(-90 ${R} ${R})`} />;
          })}
        </Svg>
        <View style={{ maxWidth: size - sw * 2 - 8, alignItems: 'center' }} pointerEvents="none">
          <Text style={{ color: t.text, fontWeight: '700', fontSize: size >= 180 ? 20 : 15, fontVariant: ['tabular-nums'] }} numberOfLines={1}>{format(shown ? shown.value : total)}</Text>
          {shown && <Text style={{ color: t.muted, fontSize: 11, fontVariant: ['tabular-nums'] }}>{Math.round((shown.value / total) * 100)}%</Text>}
          <Text style={{ color: shown ? t.text : t.muted, fontSize: size >= 180 ? 12 : 10, textAlign: 'center', lineHeight: size >= 180 ? 15 : 12 }} numberOfLines={2}>{shown ? shown.label : note ?? 'total'}</Text>
          {shown?.onPress && !legend && <Text style={{ color: t.accent, fontSize: 10, marginTop: 2 }}>tap again to open</Text>}
        </View>
      </Pressable>
      {legend && (
        <ScrollView style={{ width: legendW, flex: across ? undefined : 1, maxHeight: across ? height : undefined, alignSelf: across ? 'center' : 'stretch' }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16 }} showsVerticalScrollIndicator nestedScrollEnabled>
          {parts.map((p, i) => (
            <Pressable key={p.label} onPress={p.onPress} disabled={!p.onPress} onHoverIn={() => setSel(i)} onHoverOut={() => setSel(null)}
              style={({ hovered }: any) => [styles.sliceRow, { width: colW }, hovered && p.onPress && { opacity: 0.7 }]}>
              <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: p.color }} />
              <Text style={{ color: t.text, fontSize: 13, flex: 1 }} numberOfLines={1}>{p.label}</Text>
              <Text style={{ color: t.muted, fontSize: 12, fontVariant: ['tabular-nums'] }}>{Math.round((p.value / total) * 100)}%</Text>
              <Text style={{ color: t.text, fontSize: 13, fontVariant: ['tabular-nums'], minWidth: 56, textAlign: 'right' }}>{format(p.value)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

interface LabelBox { i: number; left: number; top: number; w: number; h: number; align: 'left' | 'right' | 'center' }
/** A rough width for a line of label text (12px): emoji count double. */
const textW = (str: string, px = 6.6) => [...str].reduce((w, ch) => w + (/\p{Extended_Pictographic}/u.test(ch) ? 2.2 : 1) * px, 0);
const LABEL_H = 30; // name, then "37% · $72"

/**
 * Labels around the ring, each at its own slice's angle: beside the ring at the sides, above or below it
 * at the top and bottom. Tries the biggest ring first and shrinks it until every label fits inside the
 * card without touching another label or the ring. null when even a small ring doesn't leave room.
 */
type PieLayout = { size: number; boxes: LabelBox[]; cy?: number };
function radialLayout(parts: { label: string; value: number }[], total: number, W: number, H: number, second: (i: number) => string): PieLayout | null {
  const cx = W / 2, cy = H / 2, GAP = 6;
  const sizes = parts.map((p, i) => ({ w: Math.min(W * 0.48, Math.ceil(Math.max(textW(p.label), textW(second(i), 6.1)) + 4)), h: LABEL_H }));
  let acc = 0;
  const angle = parts.map((p) => { const mid = acc + p.value / total / 2; acc += p.value / total; return mid * 2 * Math.PI - Math.PI / 2; });
  const hits = (a: LabelBox, b: LabelBox) => a.left < b.left + b.w + 2 && b.left < a.left + a.w + 2 && a.top < b.top + b.h && b.top < a.top + a.h;
  const touchesRing = (b: LabelBox, R: number) => {
    const nx = Math.max(b.left, Math.min(cx, b.left + b.w)), ny = Math.max(b.top, Math.min(cy, b.top + b.h));
    return Math.hypot(nx - cx, ny - cy) < R + 2;
  };
  for (let size = Math.floor(Math.min(W, H) - 8); size >= 80; size -= 6) {
    const R = size / 2;
    const boxes: LabelBox[] = parts.map((_, i) => {
      const c = Math.cos(angle[i]), sn = Math.sin(angle[i]), { w, h } = sizes[i];
      const px = cx + (R + GAP) * c, py = cy + (R + GAP) * sn;
      const align: LabelBox['align'] = c > 0.25 ? 'left' : c < -0.25 ? 'right' : 'center';
      const left = align === 'left' ? px : align === 'right' ? px - w : px - w / 2;
      const top = sn > 0.25 ? py : sn < -0.25 ? py - h : py - h / 2;
      return { i, left, top, w, h, align };
    });
    // Neighbours that overlap are eased apart up and down (a few rounds), keeping them by their slices.
    for (let round = 0; round < 6; round++) {
      let moved = false;
      for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
        const A = boxes[a], B = boxes[b];
        if (!hits(A, B)) continue;
        // Apart, and away from the ring: two labels above it (or two below) move outward, the outer one
        // further out, rather than one of them being pushed into the ring. Ones that share the top or
        // bottom centre slide sideways first.
        const overlap = Math.min(A.top + A.h, B.top + B.h) - Math.max(A.top, B.top) + 2;
        const [hi, lo] = A.top <= B.top ? [A, B] : [B, A];
        const above = (x: LabelBox) => x.top + x.h / 2 < cy, below = (x: LabelBox) => x.top + x.h / 2 > cy;
        if ((A.align === 'center' || B.align === 'center') && Math.abs((A.left + A.w / 2) - (B.left + B.w / 2)) < Math.max(A.w, B.w)) {
          const [l, r] = A.left + A.w / 2 <= B.left + B.w / 2 ? [A, B] : [B, A];
          const side = (l.left + l.w + 4 - r.left) / 2;
          if (side > 0) { l.left -= side; r.left += side; }
        } else if (above(A) && above(B)) hi.top -= overlap;
        else if (below(A) && below(B)) lo.top += overlap;
        else { hi.top -= overlap / 2; lo.top += overlap / 2; }
        moved = true;
      }
      if (!moved) break;
    }
    const ok = boxes.every((b) => b.left >= 0 && b.top >= 0 && b.left + b.w <= W && b.top + b.h <= H && !touchesRing(b, R))
      && boxes.every((b, k) => boxes.every((o, j) => j <= k || !hits(b, o)));
    if (ok) return best(stacked(), { size, boxes });
  }
  return stacked();

  // On a narrow card labels beside the ring squeeze it; rows above and below (top-half slices above,
  // bottom-half below, left to right as they sit on the ring) can leave a much bigger one.
  function stacked(): PieLayout | null {
    if (W > H * 1.25) return null; // a wide card reads better with the legend beside the ring
    const pack = (ids: number[]) => {
      const rows: number[][] = [];
      let used = Infinity;
      for (const i of ids) {
        if (used + 10 + sizes[i].w > W) { rows.push([]); used = -10; }
        rows[rows.length - 1].push(i); used += 10 + sizes[i].w;
      }
      return rows;
    };
    const byX = (a: number, b: number) => Math.cos(angle[a]) - Math.cos(angle[b]);
    const up = parts.map((_, i) => i).filter((i) => Math.sin(angle[i]) < 0).sort(byX);
    const down = parts.map((_, i) => i).filter((i) => Math.sin(angle[i]) >= 0).sort(byX);
    const above = pack(up), below = pack(down);
    const size = Math.floor(Math.min(W - 8, H - (above.length + below.length) * LABEL_H - (above.length ? GAP * 2 : 0) - (below.length ? GAP * 2 : 0)));
    if (size < 80) return null;
    const boxes: LabelBox[] = [];
    const topH = above.length ? above.length * LABEL_H + GAP * 2 : 0, botH = below.length ? below.length * LABEL_H + GAP * 2 : 0;
    const ringTop = topH + (H - topH - botH - size) / 2;
    const place = (rows: number[][], top0: number) => rows.forEach((row, k) => {
      const w = row.reduce((s, i) => s + sizes[i].w, 0) + (row.length - 1) * 10;
      let x = (W - w) / 2;
      for (const i of row) { boxes.push({ i, left: x, top: top0 + k * LABEL_H, w: sizes[i].w, h: LABEL_H, align: 'center' }); x += sizes[i].w + 10; }
    });
    // Rows nearest the ring hold the labels nearest it: the top block reads downwards into the ring.
    place(above, ringTop - GAP * 2 - above.length * LABEL_H);
    place(below, ringTop + size + GAP * 2);
    return { size, boxes, cy: ringTop + size / 2 };
  }
  function best(a: PieLayout | null, b: PieLayout) { return a && a.size > b.size * 1.15 ? a : b; }
}

/** The ring with each slice's name outside it, on a short line from the slice's middle. Labels on a side are spread so they never overlap. */
function AroundPie({ t, parts, total, format, note, width, height, lay }: {
  t: Theme; parts: (Slice & { color: string })[]; total: number; format: (n: number) => string; note?: string; width: number; height: number; lay: PieLayout;
}) {
  const [sel, setSel] = useState<number | null>(null);
  const ring = useRef<View>(null);
  const size = lay.size;
  const cx = width / 2, cy = lay.cy ?? height / 2, R = size / 2, sw = Math.max(14, size * 0.2), r = R - sw / 2, C = 2 * Math.PI * r;
  let acc = 0;
  const ends = parts.map((p) => (acc += p.value / total));
  const pickAt = (e: any) => {
    const el = ring.current as unknown as HTMLElement | null;
    const box = el?.getBoundingClientRect?.();
    const x = box ? e.nativeEvent.pageX - box.left - window.scrollX : e.nativeEvent.locationX, y = box ? e.nativeEvent.pageY - box.top - window.scrollY : e.nativeEvent.locationY;
    const dx = x - R, dy = y - R, d = Math.hypot(dx, dy);
    if (d < r - sw / 2 - 6 || d > R + 6) { setSel(null); return; }
    const f = ((Math.atan2(dx, -dy) / (2 * Math.PI)) + 1) % 1;
    const i = ends.findIndex((v) => f <= v);
    if (i < 0) return;
    if (sel === i) parts[i].onPress?.(); else setSel(i);
  };
  let off = 0;
  const shown = sel == null ? null : parts[sel];
  return (
    <View style={{ width, height }}>
      <Pressable ref={ring} onPress={pickAt} style={{ position: 'absolute', left: cx - R, top: cy - R, width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Chart. Tap a slice for its amount.">
        <Svg width={size} height={size} style={[StyleSheet.absoluteFill, SPIN] as any}>
          {parts.map((p, i) => {
            const len = (p.value / total) * C, o = off; off += len;
            return <Circle key={p.label} cx={R} cy={R} r={r} fill="none" stroke={p.color} strokeWidth={sel === i ? sw + 4 : sw} strokeOpacity={sel == null || sel === i ? 1 : 0.5}
              strokeDasharray={`${Math.max(0, len - 2)} ${C - Math.max(0, len - 2)}`} strokeDashoffset={-o} transform={`rotate(-90 ${R} ${R})`} />;
          })}
        </Svg>
        <View style={{ maxWidth: size - sw * 2 - 8, alignItems: 'center' }} pointerEvents="none">
          <Text style={{ color: t.text, fontWeight: '700', fontSize: size >= 180 ? 20 : 15, fontVariant: ['tabular-nums'] }} numberOfLines={1}>{format(shown ? shown.value : total)}</Text>
          <Text style={{ color: shown ? t.text : t.muted, fontSize: size >= 180 ? 12 : 10, textAlign: 'center', lineHeight: size >= 180 ? 15 : 12 }} numberOfLines={2}>{shown ? shown.label : note ?? 'total'}</Text>
          {shown?.onPress && <Text style={{ color: t.accent, fontSize: 10, marginTop: 2 }}>tap again to open</Text>}
        </View>
      </Pressable>
      {lay.boxes.map((b) => {
        const p = parts[b.i];
        // Each label sits just outside its own slice (no lines): the slice's colour ties them together.
        const ta = b.align === 'center' ? 'center' : b.align;
        return (
          <Pressable key={b.i} onPress={p.onPress} disabled={!p.onPress} onHoverIn={() => setSel(b.i)} onHoverOut={() => setSel(null)}
            style={{ position: 'absolute', left: b.left, top: b.top, width: b.w, height: b.h, justifyContent: 'center' }}>
            <Text style={{ color: p.color === t.muted ? t.text : p.color, fontSize: 12, lineHeight: 15, fontWeight: sel === b.i ? '800' : '700', textAlign: ta }} numberOfLines={1}>{p.label}</Text>
            <Text style={{ color: t.muted, fontSize: 11, lineHeight: 14, fontVariant: ['tabular-nums'], textAlign: ta }} numberOfLines={1}>{Math.round((p.value / total) * 100)}% · {format(p.value)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 2, minHeight: 18 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  readout: { flexDirection: 'row', alignItems: 'center', columnGap: 10, height: 18, overflow: 'hidden' },
  sliceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, height: LEGEND_ROW },
});

export interface FlowNode { label: string; value: number; color?: string; onPress?: () => void }

/**
 * Money flow (RPT-4): where the money came from on the left, what it went to on the right, through
 * one column in the middle. Band widths are the amounts. When more went out than came in, the
 * difference comes from savings on the left; when less, what was kept shows on the right.
 */
export function FlowChart({ t, inputs, outputs, format, width, height }: { t: Theme; inputs: FlowNode[]; outputs: FlowNode[]; format: (n: number) => string; width: number; height: number }) {
  const [sel, setSel] = useState<string | null>(null);
  const total = Math.max(inputs.reduce((s, n) => s + n.value, 0), outputs.reduce((s, n) => s + n.value, 0));
  if (!total || width < 120) return null;
  const labelW = Math.min(140, Math.max(80, width * 0.3)), bar = 8, gap = 4;
  const xL = labelW, xM = width / 2 - bar / 2, xR = width - labelW - bar;
  const col = (list: FlowNode[]) => {
    const room = height - gap * Math.max(0, list.length - 1);
    let y = 0;
    return list.map((n) => { const h = Math.max(2, (n.value / total) * room); const box = { ...n, y, h }; y += h + gap; return box; });
  };
  const L = col(inputs), R = col(outputs);
  // Label positions: by each node's middle, spread so none overlaps the one above, kept inside the chart.
  // A label takes two lines (name, then amount) beside a node tall enough, one line beside a small one.
  const tall = (n: { h: number }) => n.h >= 30;
  const spread = (list: { y: number; h: number }[]) => {
    const lh = list.map((n) => (tall(n) ? 30 : 17)), at = list.map((n, i) => n.y + n.h / 2 - lh[i] / 2);
    for (let i = 1; i < at.length; i++) at[i] = Math.max(at[i], at[i - 1] + lh[i - 1]);
    for (let i = at.length - 1; i >= 0; i--) at[i] = Math.min(at[i], (i === at.length - 1 ? height : at[i + 1]) - lh[i]);
    return at.map((y) => Math.max(0, y));
  };
  const posL = spread(L), posR = spread(R);
  const pool = height - gap * Math.max(0, Math.max(inputs.length, outputs.length) - 1);
  const band = (x1: number, y1: number, h1: number, x2: number, y2: number, h2: number) => {
    const c = (x1 + x2) / 2;
    return `M${x1},${y1} C${c},${y1} ${c},${y2} ${x2},${y2} L${x2},${y2 + h2} C${c},${y2 + h2} ${c},${y1 + h1} ${x1},${y1 + h1} Z`;
  };
  let inAt = (height - pool) / 2, outAt = (height - pool) / 2;
  const colour = (n: FlowNode, i: number) => n.color ?? t.series[i % t.series.length];
  const label = (n: FlowNode & { y: number; h: number }, side: 'l' | 'r', i: number) => (
    <Pressable key={`${side}${i}`} onPress={n.onPress} disabled={!n.onPress} onHoverIn={() => setSel(`${side}${i}`)} onHoverOut={() => setSel(null)}
      style={{ position: 'absolute', top: (side === 'l' ? posL : posR)[i], width: labelW - 6, ...(side === 'l' ? { left: 0, alignItems: 'flex-end' } : { right: 0, alignItems: 'flex-start' }) }}>
      {tall(n) ? <>
        <Text style={{ color: t.text, fontSize: 12, lineHeight: 15 }} numberOfLines={1}>{n.label}</Text>
        <Text style={{ color: t.muted, fontSize: 11, lineHeight: 15, fontVariant: ['tabular-nums'] }} numberOfLines={1}>{format(n.value)}</Text>
      </> : <Text style={{ color: t.text, fontSize: 12, lineHeight: 17 }} numberOfLines={1}>{n.label} <Text style={{ color: t.muted, fontVariant: ['tabular-nums'] }}>{format(n.value)}</Text></Text>}
    </Pressable>
  );
  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height}>
        {L.map((n, i) => { const h = (n.value / total) * pool; const p = band(xL + bar, n.y, n.h, xM, inAt, h); inAt += h;
          return <Path key={`bl${i}`} d={p} fill={colour(n, i)} fillOpacity={sel === `l${i}` ? 0.45 : 0.22} />; })}
        {R.map((n, i) => { const h = (n.value / total) * pool; const p = band(xM + bar, outAt, h, xR, n.y, n.h); outAt += h;
          return <Path key={`br${i}`} d={p} fill={colour(n, i + inputs.length)} fillOpacity={sel === `r${i}` ? 0.45 : 0.22} />; })}
        {L.map((n, i) => <Path key={`nl${i}`} d={`M${xL},${n.y} h${bar} v${n.h} h${-bar} Z`} fill={colour(n, i)} />)}
        <Path d={`M${xM},${(height - pool) / 2} h${bar} v${pool} h${-bar} Z`} fill={t.muted} />
        {R.map((n, i) => <Path key={`nr${i}`} d={`M${xR},${n.y} h${bar} v${n.h} h${-bar} Z`} fill={colour(n, i + inputs.length)} />)}
      </Svg>
      {L.map((n, i) => label(n, 'l', i))}
      {R.map((n, i) => label(n, 'r', i))}
    </View>
  );
}
