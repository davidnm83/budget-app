// The frame every pop-up shares. On phones it is a sheet that slides up over a dimmed page; on wide screens
// it is a centred panel over a dimmed page (click outside to close).
//   fit: the panel is only as tall as its content (forms); otherwise it takes most of the height (lists).
import { useEffect, useRef, type ReactNode } from 'react';
import { POP } from '@/lib/motion';
import { Animated, Easing, Modal, PanResponder, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWide } from '@/lib/layout';
import { useTheme } from '@/lib/theme';

export function ModalFrame({ visible = true, onClose, children, fit, width = 560 }: {
  visible?: boolean; onClose: () => void; children: ReactNode; fit?: boolean; width?: number;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const wide = useWide();
  if (!wide) {
    // Phones: a sheet that rises from the bottom. Forms take only the height they need; lists
    // (pickers) take most of the screen. The page behind stays visible so you keep your place.
    return <PhoneSheet visible={visible} onClose={onClose} fit={fit}>{children}</PhoneSheet>;
  }
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable onPress={() => {}} style={[styles.panel, POP, { backgroundColor: t.bg, borderColor: t.line, maxWidth: width }, fit ? { maxHeight: '90%' } : { height: '90%' }]}>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** The dimming fades in place while only the sheet itself slides up. */
function PhoneSheet({ visible, onClose, children, fit }: { visible: boolean; onClose: () => void; children: ReactNode; fit?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const y = useRef(new Animated.Value(height)).current;
  // Drag the strip at the top down to close; a short drag springs back.
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) => g.dy > 4,
    onPanResponderMove: (_e, g) => { y.setValue(Math.max(0, g.dy)); },
    onPanResponderRelease: (_e, g) => {
      if (g.dy > 110 || g.vy > 0.9) closeRef.current();
      else Animated.spring(y, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
    },
  })).current;
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    if (!visible) { y.setValue(height); return; }
    Animated.timing(y, { toValue: 0, duration: 280, easing: Easing.bezier(0.2, 0.9, 0.2, 1), useNativeDriver: true }).start();
  }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.phoneScrim} onPress={onClose}>
        <Animated.View style={[styles.sheet, { backgroundColor: t.bg, marginTop: insets.top + 24, transform: [{ translateY: y }] }, fit ? { maxHeight: '100%' } : { flex: 1 }]}>
          <Pressable onPress={() => {}} style={[{ cursor: 'auto' as any }, fit ? { flexShrink: 1 } : { flex: 1 }]}>
            <View {...pan.panHandlers} style={styles.grabZone} accessibilityLabel="Drag down to close"><View style={[styles.grabber, { backgroundColor: t.muted }]} /></View>
            {children}
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  phoneScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.38)', justifyContent: 'flex-end', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)' } as any,
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, boxShadow: '0 -8px 30px rgba(0,0,0,0.18)' as any, overflow: 'hidden', flexShrink: 1, cursor: 'auto' as any },
  grabZone: { height: 26, alignItems: 'center', justifyContent: 'center', cursor: 'grab', touchAction: 'none' } as any,
  grabber: { width: 40, height: 5, borderRadius: 3, opacity: 0.45 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24, backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)' } as any,
  panel: { width: '100%', borderRadius: 20, boxShadow: '0 24px 60px rgba(0,0,0,0.28)' as any, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', cursor: 'auto' as any },
});
