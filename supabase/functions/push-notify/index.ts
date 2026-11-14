// Push notify – Web Push with VAPID
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT=mailto:you@example.com
// Deploy: supabase functions deploy push-notify
// Body: { phone: "+256...", title: "MAtSapp", body: "New message", url: "/" }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { phone, title, body, url } = await req.json();
    if (!phone || !body) {
      return new Response(JSON.stringify({ error: "phone and body required" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@matsapp.local";
    if (!vapidPublic || !vapidPrivate) {
      return new Response(JSON.stringify({ error: "VAPID keys not configured" }), {
        status: 503,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: subs } = await sb
      .from("push_subscriptions")
      .select("*")
      .eq("user_phone", phone);

    if (!subs?.length) {
      return new Response(JSON.stringify({ sent: 0, message: "no subscriptions" }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // web-push via fetch to push services is complex in Deno without a lib;
    // use npm:web-push compatible approach via esm
    const webpush = await import("https://esm.sh/web-push@3.6.7");
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    const payload = JSON.stringify({
      title: title || "MAtSapp",
      body,
      url: url || "/",
    });

    let sent = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          payload
        );
        sent++;
      } catch (e) {
        console.error("push fail", e);
        // drop gone subscriptions
        if (String(e).includes("410") || String(e).includes("404")) {
          await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        }
      }
    }

    return new Response(JSON.stringify({ sent }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
