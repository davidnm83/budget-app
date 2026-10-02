// One place for the sizes every screen shares, so pages line up on big screens.
import { useWindowDimensions } from 'react-native';
import type { TextStyle } from 'react-native';

/** Widest a page's content gets; it's centred beyond that. */
export const PAGE_MAX = 1080;
/** From this width up (laptops, landscape tablets) the tab bar moves to the top and pop-ups become centred panels. */
export const WIDE = 900;
export const useWide = () => useWindowDimensions().width >= WIDE;

/** The type scale. Every screen uses these sizes so the same kind of text looks the same everywhere. */
export const TYPE = { title: 20, heading: 16, body: 15, small: 13, label: 12, tileValue: 17, tileNote: 11 } as const;
/** Small-caps section label above a card or group. */
export const LABEL = { fontSize: TYPE.label, fontWeight: '700', letterSpacing: 0.5 } as const;

/** Room at the end of every page so its last content can scroll clear of the floating navigation bar and the gesture area. */
export const UNDER_BAR = 116;

/** One look for every list row: a 15px semibold name, a 12–13px muted second line, a tabular amount. */
export const ROW: { title: TextStyle; sub: TextStyle; amount: TextStyle; minHeight: number } = {
  title: { fontSize: 15, fontWeight: '600' },
  sub: { fontSize: 12.5 },
  amount: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  minHeight: 56,
};

/**
 * For every long list: draw about a screen and a half first, then keep a few screens either side
 * of what's showing (the default keeps ten each way, which is a lot of rows to build and hold).
 */
export const LIST = { initialNumToRender: 14, maxToRenderPerBatch: 12, updateCellsBatchingPeriod: 40, windowSize: 9 } as const;
