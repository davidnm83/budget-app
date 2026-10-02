// The frame every pop-up shares. On phones it fills the screen and slides up; on wide screens
// it is a centred panel over a dimmed page (click outside to close).
//   fit: the panel is only as tall as its content (forms); otherwise it takes most of the height (lists).
import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
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
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <Pressable style={styles.phoneScrim} onPress={onClose}>
          <Pressable onPress={() => {}} style={[styles.sheet, { backgroundColor: t.bg, marginTop: insets.top + 24 }, fit ? { maxHeight: '100%' } : { flex: 1 }]}>
            <View style={[styles.grabber, { backgroundColor: t.line }]} />
            {children}
          </Pressable>
        </Pressable>
      </Modal>
    );
  }
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable onPress={() => {}} style={[styles.panel, { backgroundColor: t.bg, borderColor: t.line, maxWidth: width }, fit ? { maxHeight: '90%' } : { height: '90%' }]}>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  phoneScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: 'hidden', flexShrink: 1, cursor: 'auto' as any },
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 8 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  panel: { width: '100%', borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', cursor: 'auto' as any },
});
