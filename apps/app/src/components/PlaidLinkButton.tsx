// Web version: uses Plaid's web Link (react-plaid-link).
import { useEffect, useState } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { callFunction } from '@/lib/supabase';
import { Button } from './ui';
import type { PlaidLinkButtonProps } from './plaid-link.types';

export default function PlaidLinkButton({ itemId, title = 'Link a bank', onDone, onError }: PlaidLinkButtonProps) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { open, ready } = usePlaidLink({
    token,
    onSuccess: async (publicToken, metadata) => {
      try {
        if (itemId) {
          // Signing in again can succeed while the sync that follows still fails; say which happened.
          const r = await callFunction<{ results?: { status: string; error?: string }[] }>('plaid-sync', { itemId });
          const bad = r.results?.find((x) => x.status !== 'ok');
          onDone?.(bad ? `Signed in again, but the sync still failed${bad.error ? `: ${bad.error}` : ''}. The connection stays marked until a sync succeeds; try Sync now on the Accounts tab in a few minutes.` : 'Connection fixed and synced.');
        } else {
          const r = await callFunction<{ institution: string; added: number }>('plaid-exchange', {
            publicToken, institutionName: metadata.institution?.name,
          });
          onDone?.(`Linked ${r.institution}: ${r.added} transaction(s) imported.`);
        }
      } catch (e) {
        onError?.(e instanceof Error ? e.message : String(e));
      } finally {
        setToken(null);
        setBusy(false);
      }
    },
    onExit: () => { setToken(null); setBusy(false); },
  });

  useEffect(() => { if (token && ready) open(); }, [token, ready, open]);

  const start = async () => {
    setBusy(true);
    try {
      const r = await callFunction<{ linkToken: string }>('plaid-link-token', itemId ? { itemId } : {});
      setToken(r.linkToken);
    } catch (e) {
      setBusy(false);
      onError?.(e instanceof Error ? e.message : String(e));
    }
  };

  return <Button title={title} onPress={start} busy={busy} kind={itemId ? 'plain' : 'primary'} />;
}
