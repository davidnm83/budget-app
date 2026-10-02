// One place for the sizes every screen shares, so pages line up on big screens.
import { useWindowDimensions } from 'react-native';

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
