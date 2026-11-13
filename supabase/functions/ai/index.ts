// AI features for the signed-in user (see _shared/ai.ts), with the owner's Claude API key (ANTHROPIC_API_KEY secret):
//   {action:'status'}                     whether a key is set, so the app shows these features
//   {action:'receipt', image}             reads a receipt photo (base64 JPEG): store, date, total, tax, items
//   {action:'ask', question, history, model}  answers a question about your money ('haiku' or 'sonnet')
//   {action:'statement', files, card}     reads statements or screenshots of a transactions list (base64 JPEG, PNG or PDF)
import { json, preflight } from '../_shared/cors.ts';
import { isDemoUser, userClient, userIdFrom } from '../_shared/supabase.ts';
import { ask, claude, readReceipt, readStatement, type ChatTurn, type StatementFile } from '../_shared/ai.ts';
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
    if (body.action === 'statement') {
      const files: StatementFile[] = (Array.isArray(body.files) ? body.files : []).slice(0, 10)
        .filter((f: any) => ['image/jpeg', 'image/png', 'application/pdf'].includes(f?.mediaType) && typeof f.data === 'string' && f.data.length > 0)
        .map((f: any) => ({ mediaType: f.mediaType, data: f.data }));
      if (!files.length) return json({ error: 'Choose a screenshot, a photo or a PDF of the statement.' }, 400);
      if (files.reduce((n, f) => n + f.data.length, 0) > 20_000_000) return json({ error: 'Those files are too large together. Try fewer at a time.' }, 400);
      return json(await readStatement(client, files, !!body.card, today));
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
