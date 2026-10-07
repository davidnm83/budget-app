// AI features for the signed-in user (see _shared/ai.ts), with the owner's Claude API key (ANTHROPIC_API_KEY secret):
//   {action:'status'}                     whether a key is set, so the app shows these features
//   {action:'receipt', image}             reads a receipt photo (base64 JPEG): store, date, total, tax, items
//   {action:'ask', question, history, model}  answers a question about your money ('haiku' or 'sonnet')
import { json, preflight } from '../_shared/cors.ts';
import { isDemoUser, userClient, userIdFrom } from '../_shared/supabase.ts';
import { ask, claude, readReceipt, type ChatTurn } from '../_shared/ai.ts';
import { todayIn } from '../_shared/core/index.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const userId = await userIdFrom(req);
    if (!userId) return json({ error: 'Sign in first.' }, 401);
    const body = await req.json().catch(() => ({}));
    const client = claude();
    if (body.action === 'status') return json({ on: !!client && !(await isDemoUser(req)) });
    if (!client) return json({ error: 'The AI features need a Claude API key (see Settings → AI).' }, 400);
    if (await isDemoUser(req)) return json({ error: 'The demo account can’t use the AI features.' }, 403);
    const today = todayIn(Deno.env.get('APP_TIMEZONE') ?? 'UTC');
    if (body.action === 'receipt') {
      const image = String(body.image ?? '');
      if (!image || image.length > 6_000_000) return json({ error: 'That photo is missing or too large.' }, 400);
      return json(await readReceipt(client, image, today));
    }
    if (body.action === 'ask') {
      const question = String(body.question ?? '').trim().slice(0, 2000);
      if (!question) return json({ error: 'Ask a question first.' }, 400);
      const history: ChatTurn[] = Array.isArray(body.history)
        ? body.history.filter((t: any) => (t?.role === 'user' || t?.role === 'assistant') && typeof t.text === 'string').map((t: any) => ({ role: t.role, text: t.text.slice(0, 4000) }))
        : [];
      return json(await ask(client, userClient(req), history, question, body.model === 'sonnet' ? 'sonnet' : 'haiku', today));
    }
    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    console.error('ai', e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
