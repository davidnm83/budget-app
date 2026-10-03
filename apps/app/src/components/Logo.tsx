// A round picture for a bank or merchant. Shows the logo when there is one; otherwise an emoji
// you chose, or the first letter on a colour that stays the same for that name.
import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Text, View } from 'react-native';
import { customPicture, fillsCircle, loadLogos, merchantLogo, useLogoVersion } from '@/lib/logos';
import { useTheme } from '@/lib/theme';

export function Logo({ uri, name, emoji, size = 32 }: { uri: string | null; name: string; emoji?: string | null; size?: number }) {
  const t = useTheme();
  const v = useLogoVersion();
  useEffect(() => { loadLogos(); }, []);
  const [failed, setFailed] = useState<string | null>(null);
  const box = { width: size, height: size, borderRadius: size / 2, alignItems: 'center' as const, justifyContent: 'center' as const, overflow: 'hidden' as const };
  if (uri && failed !== uri) {
    // A picture you uploaded fills the circle unless you turned that off; a site's icon sits inside it with some air.
    const fill = fillsCircle(uri, v);
    return (
      <View style={[box, { backgroundColor: '#fff', borderWidth: 1, borderColor: t.line }]}>
        <Image source={{ uri }} onError={() => setFailed(uri)} style={fill ? { width: size, height: size } : { width: size * 0.68, height: size * 0.68 }} resizeMode={fill ? 'cover' : 'contain'} accessibilityLabel={`${name} logo`} />
      </View>
    );
  }
  if (emoji) return <View style={box}><Text style={{ fontSize: size * 0.62 }}>{emoji}</Text></View>;
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const color = t.series[h % t.series.length];
  return (
    <View style={[box, { backgroundColor: color + '26' }]}>
      <Text style={{ color, fontWeight: '700', fontSize: size * 0.44 }}>{(name.trim()[0] ?? '?').toUpperCase()}</Text>
    </View>
  );
}

/**
 * The picture for a transaction. A transfer between your own accounts shows two arrows, and a
 * credit card payment a card, rather than whichever bank's logo the description happens to name.
 * A picture you uploaded for that name still wins.
 */
export function TxnLogo({ name, transfer, category, size = 32 }: { name: string; transfer?: boolean; category?: string | null; size?: number }) {
  const t = useTheme();
  const v = useLogoVersion();
  const own = customPicture(name, v);
  if (!transfer || own) return <Logo size={size} name={name} uri={own ?? merchantLogo(name, v)} />;
  const card = /credit card|card payment/i.test(category ?? '');
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: t.track, borderWidth: 1, borderColor: t.line }} accessibilityLabel={card ? 'Card payment' : 'Transfer'}>
      <Ionicons name={card ? 'card-outline' : 'swap-horizontal'} size={size * 0.52} color={t.muted} />
    </View>
  );
}
