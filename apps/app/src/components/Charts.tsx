// The charts every widget draws with. One look everywhere: thin marks, a quiet grid, colours in a
// fixed order, a legend whenever there is more than one series, and a readout line that shows
// the values under the pointer (hover on a computer, tap on a phone).
import { useState } from 'react';
import { useWide } from '@/lib/layout';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
          <Text numberOfLines={1} style={{ color: tone, fontSize: 12, fontVariant: ['tabular-nums'] }}>{series.length > 1 ? `${p.name} ` : ''}{format(p.v)}</Text>
        </View>
      ))}
      {!!hint && <Text numberOfLines={1} style={{ color: t.muted, fontSize: 12 }}>{hint}</Text>}
    </View>
  );
}

/** Shared frame: readout, y-axis labels, the plot, hit columns and x labels. */
function Frame({ t, labels, series, height = 140, format, onPick, free, colors, refLine, stacked, legend = true, also = [], children }: PlotProps & { free?: boolean; stacked?: boolean; also?: number[]; children: (w: number, h: number, min: number, max: number, sel: number | null) => React.ReactNode }) {
  const [w, setW] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const wide = useWide(); // with a mouse, hovering reads a point out and one click opens it; on a phone the first tap reads it out
  const all = [...(stacked ? labels.map((_, i) => series.reduce((x, s) => x + (s.values[i] ?? 0), 0)) : series.flatMap((s) => s.values)), ...(refLine != null ? [refLine] : []), ...also];
  const col = (i: number) => colors?.[i] ?? t.series[i];
  const lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  let max = niceMax(hi), min = lo < 0 ? -niceMax(-lo) : 0;
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
  return (
    <View style={{ gap: 4 }}>
      {legend && <Legend t={t} series={series} col={col} />}
      {n > 0 && <Readout t={t} labels={labels} series={series} sel={sel} format={format} col={col} stacked={stacked} hint={onPick && sel != null && !wide ? 'tap again for details' : undefined} />}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <View style={{ height, justifyContent: 'space-between', alignItems: 'flex-end' }}>
          {ticks.map((v, i) => <Text key={i} style={{ color: t.muted, fontSize: 10, fontVariant: ['tabular-nums'], lineHeight: 12, marginTop: i === 0 ? -6 : 0, marginBottom: i === 2 ? -6 : 0 }}>{format(v)}</Text>)}
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
            {w > 0 && <View style={GROW}>{children(w, height, min, max, sel)}</View>}
            {refLine != null && max > min && <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: height - ((refLine - min) / (max - min)) * height, borderTopWidth: 1, borderStyle: 'dashed', borderColor: t.text, opacity: 0.45 }} />}
            <View style={[StyleSheet.absoluteFill, { flexDirection: 'row' }]}>
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
              const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
              const last = s.values.length - 1;
              const at = sel ?? last;
              return (
                [
                  series.length === 1 && n > 1 && zero ? <Path key={`${s.name}-a`} d={`${d} L${x(last).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`} fill={c(k)} fillOpacity={0.12} /> : null,
                  <Path key={`${s.name}-l`} d={d} stroke={c(k)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" fill="none" />,
                  <Circle key={`${s.name}-c`} cx={x(at)} cy={y(s.values[at] ?? 0)} r={4} fill={c(k)} stroke={t.card} strokeWidth={2} />,
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
/** Shares of a whole: at most seven named slices plus "others", with the total in the middle and a legend that carries the numbers. */
export function Donut({ t, slices, format, note, size = 132 }: { t: Theme; slices: Slice[]; format: (n: number) => string; note?: string; size?: number }) {
  const [sel, setSel] = useState<number | null>(null);
  const top = slices.slice(0, 7);
  const rest = slices.slice(7).reduce((s, x) => s + x.value, 0);
  const parts: (Slice & { color: string })[] = top.map((s, i) => ({ ...s, color: t.series[i] }));
  if (rest > 0) parts.push({ label: `${slices.length - 7} others`, value: rest, color: t.muted });
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return <Text style={{ color: t.muted }}>Nothing to show{note ? ` ${note}` : ''}.</Text>;
  const R = size / 2, sw = size * 0.2, r = R - sw / 2, C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size} style={[StyleSheet.absoluteFill, SPIN] as any}>
          {parts.map((p, i) => {
            const len = (p.value / total) * C, off = acc; acc += len;
            // A 2px gap in the surface colour separates neighbours.
            return <Circle key={p.label} cx={R} cy={R} r={r} fill="none" stroke={p.color} strokeWidth={sel === i ? sw + 4 : sw} strokeOpacity={sel == null || sel === i ? 1 : 0.5}
              strokeDasharray={`${Math.max(0, len - 2)} ${C - Math.max(0, len - 2)}`} strokeDashoffset={-off} transform={`rotate(-90 ${R} ${R})`} />;
          })}
        </Svg>
        <Text style={{ color: t.text, fontWeight: '700', fontSize: 15, fontVariant: ['tabular-nums'] }}>{format(sel == null ? total : parts[sel].value)}</Text>
        <Text style={{ color: t.muted, fontSize: 10, maxWidth: size * 0.56, textAlign: 'center', lineHeight: 11 }} numberOfLines={2}>{sel == null ? note ?? 'total' : parts[sel].label}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 170, gap: 2 }}>
        {parts.map((p, i) => (
          <Pressable key={p.label} onPress={p.onPress} disabled={!p.onPress} onHoverIn={() => setSel(i)} onHoverOut={() => setSel(null)} style={styles.sliceRow}>
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: p.color }} />
            <Text style={{ color: t.text, fontSize: 13, flex: 1 }} numberOfLines={1}>{p.label}</Text>
            <Text style={{ color: t.muted, fontSize: 12, fontVariant: ['tabular-nums'] }}>{Math.round((p.value / total) * 100)}%</Text>
            <Text style={{ color: t.text, fontSize: 13, fontVariant: ['tabular-nums'], minWidth: 56, textAlign: 'right' }}>{format(p.value)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 2, minHeight: 18 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  readout: { flexDirection: 'row', alignItems: 'center', columnGap: 10, height: 18, overflow: 'hidden' },
  sliceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 24 },
});
