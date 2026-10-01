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
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>{children}</View>
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
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  panel: { width: '100%', borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', cursor: 'auto' as any },
});
