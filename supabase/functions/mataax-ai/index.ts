// MAtSapp – Mataax AI proxy (Supabase Edge Function)
// Deploy: supabase functions deploy mataax-ai
// Secret: supabase secrets set OPENAI_API_KEY=sk-...
// Never put the API key in the frontend.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const { messages, stream } = await req.json();
    const apiKey = Deno.env.get("OPENAI_API_KEY");

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: "OPENAI_API_KEY not configured on server",
          fallback: true,
        }),
        { status: 503, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const system = {
      role: "system",
      content:
        "You are Mataax AI, the in-app assistant for MAtSapp (MAT KAI STUDIOS). " +
        "Be helpful, concise, and friendly. You can help with messaging tips, general knowledge, coding, study, and writing. " +
        "Clearly identify yourself as Mataax AI when relevant. Do not claim to be Meta AI or WhatsApp.",
    };

    const body = {
      model: "gpt-4o-mini",
      messages: [system, ...(messages || [])].slice(-20),
      temperature: 0.7,
      stream: !!stream,
    };

    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      return new Response(JSON.stringify({ error: errText }), {
        status: upstream.status,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (stream) {
      return new Response(upstream.body, {
        headers: {
          ...cors,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });
    }

    const data = await upstream.json();
    const reply = data.choices?.[0]?.message?.content || "";
    return new Response(JSON.stringify({ reply }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
