/**
 * Mataax AI – client
 * Calls Supabase Edge Function `mataax-ai` so the API key stays server-side.
 * If the function is not deployed, uses a local helpful fallback (clearly labeled).
 */
const MataaxAI = (() => {
  const HISTORY_KEY = 'matsapp_ai_history';
  const MAX_HISTORY = 40;

  function loadHistory() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function saveHistory(list) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(-MAX_HISTORY)));
  }

  function push(role, content) {
    const list = loadHistory();
    list.push({ role, content, at: Date.now() });
    saveHistory(list);
    return list;
  }

  function clearHistory() {
    localStorage.removeItem(HISTORY_KEY);
  }

  function localFallback(userText) {
    const t = (userText || '').toLowerCase().trim();
    if (!t) return 'Send a message to chat with Mataax AI.';
    if (/hello|hi\b|hey/.test(t)) {
      return 'Hello! I am Mataax AI (local mode). Deploy the Supabase Edge Function and set OPENAI_API_KEY for full answers.\n\nI can still help with MAtSapp tips: chats, status, groups, and calls.';
    }
    if (/help|how|feature|status|group|call|message/.test(t)) {
      return [
        'MAtSapp quick help (Mataax AI local mode):',
        '• Chats – start a chat from the green button; sync contacts from New chat.',
        '• Status – Updates tab → Text or Image (24h).',
        '• Groups – menu ⋮ → New group.',
        '• Calls – open a 1:1 chat → phone or video icon.',
        '• Media – paperclip for photos/docs; mic for voice notes.',
        '',
        'For full AI (coding, study, writing), connect OPENAI_API_KEY via the Edge Function.'
      ].join('\n');
    }
    if (/who are you|mataax|meta ai/.test(t)) {
      return 'I am Mataax AI for MAtSapp by MAT KAI STUDIOS / Mataaxion. I am not Meta AI or WhatsApp.';
    }
    return 'Mataax AI is in local mode (no cloud model key on the server yet).\n\nYour message was received. Deploy `mataax-ai` Edge Function and set secret OPENAI_API_KEY to enable full replies.\n\nAsk about MAtSapp features for offline help.';
  }

  async function ask(userText) {
    const text = (userText || '').trim();
    if (!text) throw new Error('Empty message');

    push('user', text);

    // Try Edge Function
    if (DB.supabase && CONFIG.SUPABASE_URL) {
      try {
        const history = loadHistory()
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.content }));

        const { data, error } = await DB.supabase.functions.invoke('mataax-ai', {
          body: { messages: history, stream: false }
        });

        if (!error && data && data.reply) {
          push('assistant', data.reply);
          return { reply: data.reply, source: 'cloud' };
        }

        if (data && data.fallback) {
          const reply = localFallback(text);
          push('assistant', reply);
          return { reply, source: 'local' };
        }

        if (error) console.warn('AI function error', error);
      } catch (e) {
        console.warn('AI invoke failed', e);
      }
    }

    const reply = localFallback(text);
    push('assistant', reply);
    return { reply, source: 'local' };
  }

  return {
    ask,
    loadHistory,
    clearHistory,
    push
  };
})();
