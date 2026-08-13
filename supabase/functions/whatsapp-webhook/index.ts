import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERIFY_TOKEN = Deno.env.get("VERIFY_TOKEN") || "";
const META_TOKEN = Deno.env.get("META_TOKEN") || "";
const PHONE_NUMBER_ID = Deno.env.get("PHONE_NUMBER_ID") || "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ Webhook Verified");
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method === "POST") {
    try {
      const body = await req.json();
      console.log("📩 Incoming body:", JSON.stringify(body));

      if (
        body.entry &&
        body.entry[0]?.changes &&
        body.entry[0].changes[0]?.value?.messages &&
        body.entry[0].changes[0].value.messages[0]
      ) {
        const message = body.entry[0].changes[0].value.messages[0];
        const from = message.from;
        const msgId = message.id;

        let text = "";
        if (message.type === "text") {
          text = message.text.body;
        } else if (message.type === "interactive" && message.interactive.button_reply) {
          text = message.interactive.button_reply.title;
        }

        if (text) {
          console.log("🚀 Dispatching to processIncomingMessage:", from, text);
          // @ts-ignore
          EdgeRuntime.waitUntil(processIncomingMessage(from, text, msgId));
        } else {
          console.log("⚠️ No text extracted from message, skipping.");
        }
      } else {
        console.log("ℹ️ Not a message event (status update or other), ignoring.");
      }

      return new Response(JSON.stringify({ status: "EVENT_RECEIVED" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("❌ Webhook Error:", err);
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
});

async function processIncomingMessage(phone: string, text: string, msgId: string) {
  console.log("🚀 processIncomingMessage START:", phone, text);
  const jid = `${phone}@s.whatsapp.net`;

  let promptText = text;
  try {
    const { data: latestOrder } = await supabase
      .from("orders")
      .select("status, dc_amount, rider_status, area")
      .eq("chat_jid", jid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestOrder) {
      promptText = `[SYSTEM ORDER CONTEXT]\nStatus: ${latestOrder.status}\nRider Status: ${latestOrder.rider_status || "N/A"}\nDelivery Fee: Rs. ${latestOrder.dc_amount || 0}\nArea: ${latestOrder.area || "N/A"}\n\nCUSTOMER'S QUESTION: ${text}`;
      console.log("📦 Order context added");
    }
  } catch (e) {
    console.error("Order context error:", e);
  }

  const aiReply = await getGeminiResponse(promptText);
  console.log("🤖 Final AI Reply:", aiReply);

  await sendCloudApiMessage(phone, aiReply);
  console.log("📤 Message sent to", phone);
}

async function getGeminiResponse(prompt: string): Promise<string> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );
    const data = await res.json();
    console.log("Gemini raw response:", JSON.stringify(data));
    return (
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Maaf kijiye, main samajh nahi saka."
    );
  } catch (e) {
    console.error("Gemini Error:", e);
    return "AI service filhal available nahi hai.";
  }
}

async function sendCloudApiMessage(to: string, text: string) {
  const cleanTo = to.replace(/[^0-9]/g, "");
  const res = await fetch(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${META_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: cleanTo,
      type: "text",
      text: { body: text },
    }),
  });
  const result = await res.json();
  console.log("WhatsApp send result:", JSON.stringify(result));
}
