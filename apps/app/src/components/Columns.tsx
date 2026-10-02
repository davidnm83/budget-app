// Cards in one column on phones, two on wide screens (alternating, so the order still reads left to right).
import { Children, type ReactNode } from 'react';
import { View } from 'react-native';
import { useWide } from '@/lib/layout';

export function Columns({ children, gap = 10 }: { children: ReactNode; gap?: number }) {
  const wide = useWide();
  const items = Children.toArray(children);
  if (!wide || items.length < 2) return <>{items}</>;
  return (
    <View style={{ flexDirection: 'row', gap, alignItems: 'flex-start' }}>
      {[0, 1].map((c) => <View key={c} style={{ flex: 1, gap, minWidth: 0 }}>{items.filter((_, i) => i % 2 === c)}</View>)}
    </View>
  );
}

/** Grey bars standing in for content that's loading. */
export function Skeleton({ color, lines = 2 }: { color: string; lines?: number }) {
  return (
    <View style={{ gap: 8, paddingVertical: 2 }} accessibilityLabel="Loading">
      {Array.from({ length: lines }, (_, i) => <View key={i} style={{ height: i === 0 ? 22 : 12, width: i === 0 ? '45%' : `${85 - i * 20}%`, borderRadius: 6, backgroundColor: color }} />)}
    </View>
  );
}
