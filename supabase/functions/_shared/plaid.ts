/** Tiny Plaid API client (fetch-based, no SDK needed). */
const HOSTS: Record<string, string> = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
};

export class PlaidError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(`${code}: ${message}`);
  }
}

export async function plaid<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
  const env = Deno.env.get('PLAID_ENV') ?? 'production';
  const res = await fetch((HOSTS[env] ?? HOSTS.production) + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: Deno.env.get('PLAID_CLIENT_ID'),
      secret: Deno.env.get('PLAID_SECRET'),
      ...body,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error_code) {
    throw new PlaidError(data.error_code ?? `HTTP_${res.status}`, data.display_message ?? data.error_message ?? res.statusText, res.status);
  }
  return data as T;
}

/** Errors that mean the person must sign in to their bank again (Link update mode). */
export const RELINK_CODES = new Set([
  'ITEM_LOGIN_REQUIRED', 'PENDING_EXPIRATION', 'INVALID_CREDENTIALS', 'INVALID_MFA',
  'ITEM_LOCKED', 'USER_SETUP_REQUIRED', 'ACCESS_NOT_GRANTED',
]);

export function countryCodes(): string[] {
  return (Deno.env.get('PLAID_COUNTRY_CODES') ?? 'CA,US').split(',').map((s) => s.trim()).filter(Boolean);
}
