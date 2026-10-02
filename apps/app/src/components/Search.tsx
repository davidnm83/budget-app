// Search everything: pages, categories, merchants and transactions. On a phone it sits at the top
// of the More sheet (with the menu below until you type); on a computer it is its own pop-up.
import Ionicons from '@expo/vector-icons/Ionicons';
import { addMonths, categoryIcon, formatMoney, monthOf, searchPattern, shortDate } from '@budget-app/core';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Sheet } from '@/components/Forms';
import { Logo } from '@/components/Logo';
import { TransactionEditor } from '@/components/TransactionEditor';
import { useTxnSheet } from '@/components/TxnSheet';
import { useWide } from '@/lib/layout';
import { merchantLogo, useLogoVersion } from '@/lib/logos';
import { today } from '@/lib/plan';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { seedTxn } from '@/lib/txnCache';

export interface PageHit { label: string; href: string; icon?: keyof typeof Ionicons.glyphMap; emoji?: string }
interface Found { cats: { id: string; name: string; icon: string | null; group_name: string }[]; merchants: { merchant: string; txns: number }[]; txns: any[] }

let merchantCache: { merchant: string; txns: number }[] | null = null;

export function SearchBox({ pages, onGo, empty, autoFocus }: { pages: PageHit[]; onGo: (href: string) => void; empty?: ReactNode; autoFocus?: boolean }) {
  const t = useTheme();
  const wide = useWide();
  const lv = useLogoVersion();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [showTxns, txnSheet] = useTxnSheet();
  const seq = useRef(0);
  const text = q.trim();

  useEffect(() => {
    if (text.length < 2) { setFound(null); return; }
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      const p = searchPattern(text);
      if (!p) return;
      if (!merchantCache) merchantCache = ((await supabase.rpc('merchant_names')).data ?? []) as any[];
      const [cats, txns] = await Promise.all([
        supabase.from('categories').select('id, name, icon, group_name').ilike('name', p.replace(/\\*/g, '%')).eq('is_hidden', false).limit(6),
        supabase.from('transaction_list').select('id, date, amount, currency, name, merchant, category_id, display_name, account_name, account_mask, notes, tags, category_name')
          .or(`display_name.ilike.${p},name.ilike.${p},notes.ilike.${p}`).order('date', { ascending: false }).limit(8),
      ]);
      if (mine !== seq.current) return; // a newer search has started
      const lower = text.toLowerCase();
      setFound({ cats: (cats.data ?? []) as any[], merchants: merchantCache.filter((m) => m.merchant?.toLowerCase().includes(lower)).slice(0, 6), txns: txns.data ?? [] });
    }, 220);
    return () => clearTimeout(timer);
  }, [text]);

  const pageHits = useMemo(() => (text ? pages.filter((x) => x.label.toLowerCase().includes(text.toLowerCase())) : []), [pages, text]);
  const from = addMonths(monthOf(today()), -11), to = today();
  const nothing = found && !pageHits.length && !found.cats.length && !found.merchants.length && !found.txns.length;
  const Head = ({ children }: { children: string }) => <Text style={[styles.head, { color: t.muted }]}>{children}</Text>;
  const row = ({ pressed, hovered }: any) => [styles.row, (pressed || hovered) && { backgroundColor: t.line }];

  return (
    <View style={{ flexShrink: 1 }}>
      <View style={[styles.search, { borderColor: t.line, backgroundColor: t.card }]}>
        <Ionicons name="search" size={17} color={t.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder="Search pages, categories, merchants, transactions" placeholderTextColor={t.muted} autoFocus={autoFocus ?? wide}
          autoCorrect={false} style={[{ flex: 1, color: t.text, paddingVertical: 11, fontSize: 15 }, { outlineStyle: 'none' } as any]} />
        {!!q && <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityLabel="Clear search"><Ionicons name="close-circle" size={17} color={t.muted} /></Pressable>}
      </View>
      {!text ? empty : (
        <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
          {pageHits.length > 0 && <Head>PAGES</Head>}
          {pageHits.map((x) => (
            <Pressable key={x.href} onPress={() => onGo(x.href)} style={row}>
              {x.emoji ? <Text style={{ fontSize: 18, width: 22, textAlign: 'center' }}>{x.emoji}</Text> : <Ionicons name={x.icon ?? 'document-outline'} size={20} color={t.text} style={{ width: 22 }} />}
              <Text style={{ color: t.text, fontSize: 15, flex: 1 }}>{x.label}</Text>
              <Ionicons name="arrow-forward" size={16} color={t.muted} />
            </Pressable>
          ))}
          {!!found?.cats.length && <Head>CATEGORIES</Head>}
          {found?.cats.map((c) => (
            <Pressable key={c.id} onPress={() => showTxns({ title: `${c.name} · last 12 months`, from, to, categoryIds: [c.id] })} style={row}>
              <Text style={{ fontSize: 18, width: 22, textAlign: 'center' }}>{categoryIcon(c.name, c.icon)}</Text>
              <Text style={{ color: t.text, fontSize: 15, flex: 1 }} numberOfLines={1}>{c.name}</Text>
              <Text style={{ color: t.muted, fontSize: 12 }}>{c.group_name}</Text>
            </Pressable>
          ))}
          {!!found?.merchants.length && <Head>MERCHANTS</Head>}
          {found?.merchants.map((m) => (
            <Pressable key={m.merchant} onPress={() => showTxns({ title: m.merchant, from: '1900-01-01', to, merchant: m.merchant })} style={row}>
              <Logo size={24} name={m.merchant} uri={merchantLogo(m.merchant, lv)} />
              <Text style={{ color: t.text, fontSize: 15, flex: 1 }} numberOfLines={1}>{m.merchant}</Text>
              <Text style={{ color: t.muted, fontSize: 12 }}>{m.txns} transaction{m.txns === 1 ? '' : 's'}</Text>
            </Pressable>
          ))}
          {!!found?.txns.length && <Head>TRANSACTIONS</Head>}
          {found?.txns.map((x) => (
            <Pressable key={x.id} onPress={() => { seedTxn(x); setOpen(x.id); }} style={row}>
              <Text style={{ color: t.muted, fontSize: 12, width: 50 }}>{shortDate(x.date)}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontSize: 15 }} numberOfLines={1}>{x.display_name}</Text>
                <Text style={{ color: t.muted, fontSize: 12 }} numberOfLines={1}>{x.category_name ?? 'Uncategorised'} · {x.account_name}</Text>
              </View>
              <Text style={{ color: Number(x.amount) > 0 ? t.positive : t.text, fontVariant: ['tabular-nums'] }}>{formatMoney(Number(x.amount))}</Text>
            </Pressable>
          ))}
          {found?.txns.length === 8 && (
            <Pressable onPress={() => onGo(`/transactions?q=${encodeURIComponent(text)}`)} style={row}>
              <Ionicons name="list" size={20} color={t.accent} style={{ width: 22 }} />
              <Text style={{ color: t.accent, fontSize: 15, fontWeight: '600' }}>See all in Transactions</Text>
            </Pressable>
          )}
          {text.length < 2 && !pageHits.length && <Text style={{ color: t.muted, padding: 16 }}>Keep typing…</Text>}
          {text.length >= 2 && !found && !pageHits.length && <Text style={{ color: t.muted, padding: 16 }}>Searching…</Text>}
          {nothing && <Text style={{ color: t.muted, padding: 16 }}>Nothing matches “{text}”.</Text>}
        </ScrollView>
      )}
      {txnSheet}
      {open && (
        <Sheet title="Transaction" scroll={false} onClose={() => setOpen(null)}>
          <TransactionEditor key={open} id={open} onOpen={setOpen} onDone={() => setOpen(null)} />
        </Sheet>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, marginHorizontal: 12, marginTop: 4, marginBottom: 8 },
  head: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 46, paddingVertical: 6 },
});
