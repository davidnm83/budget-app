// iOS/Android version: Plaid's native SDK (needs a development build, not Expo Go).
import { useState } from 'react';
import { createPlaidLinkSession } from 'react-native-plaid-link-sdk';
import { callFunction } from '@/lib/supabase';
import { Button } from './ui';
import type { PlaidLinkButtonProps } from './plaid-link.types';

export default function PlaidLinkButton({ itemId, title = 'Link a bank', onDone, onError }: PlaidLinkButtonProps) {
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const { linkToken } = await callFunction<{ linkToken: string }>('plaid-link-token', itemId ? { itemId } : {});
      const session = await createPlaidLinkSession({
        token: linkToken,
        onSuccess: async (success) => {
          try {
            if (itemId) {
              await callFunction('plaid-sync', { itemId });
              onDone?.('Connection fixed and synced.');
            } else {
              const r = await callFunction<{ institution: string; added: number }>('plaid-exchange', {
                publicToken: success.publicToken, institutionName: success.metadata.institution?.name,
              });
              onDone?.(`Linked ${r.institution}: ${r.added} transaction(s) imported.`);
            }
          } catch (e) {
            onError?.(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        },
        onExit: () => setBusy(false),
        onEvent: () => {},
      });
      await session.open();
    } catch (e) {
      setBusy(false);
      onError?.(e instanceof Error ? e.message : String(e));
    }
  };

  return <Button title={title} onPress={start} busy={busy} kind={itemId ? 'plain' : 'primary'} />;
}
