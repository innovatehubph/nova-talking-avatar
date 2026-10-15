// NOVA avatar backend — Cloudflare Worker.
//
// Pipeline (all at the edge):
//   audio  → Whisper STT   (@cf/openai/whisper-large-v3-turbo)
//   text   → LLM           (Workers AI Llama, or any provider via AI Gateway)
//   reply  → TTS           (@cf/deepgram/aura-1, falls back to MeloTTS)
//
// Endpoints:
//   GET  /api/health  → { ok: true, ...capabilities }
//   POST /api/chat    → multipart form { audio, history? } OR json { text, history? }
//                     ← { text, userText, audioBase64, audioType }

export interface Env {
  AI: Ai;
  AI_GATEWAY_ENDPOINT?: string;
  GATEWAY_MODEL?: string;
  LLM_API_KEY?: string;
  NOVA_MEMORY?: KVNamespace;
}

const SYSTEM_PROMPT =
  "You are NOVA, a warm, witty AI talking avatar. Keep every reply short (1-3 sentences), conversational and natural for speech. No markdown, no lists, no emojis.";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function runLLM(env: Env, history: { role: string; content: string }[]): Promise<string> {
  const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...history.slice(-10)];

  // Preferred: AI Gateway → any hosted provider (caching + rate limits + server-side keys)
  if (env.AI_GATEWAY_ENDPOINT && env.LLM_API_KEY) {
    const res = await fetch(`${env.AI_GATEWAY_ENDPOINT.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.GATEWAY_MODEL || "gpt-4o-mini",
        messages,
        max_tokens: 150,
      }),
    });
    if (res.ok) {
      const data: any = await res.json();
      const text = data.choices?.[0]?.message?.content?.trim();
      if (text) return text;
    }
    // fall through to Workers AI on gateway failure
  }

  // Default: Workers AI Llama at the edge
  const out: any = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
    messages,
    max_tokens: 150,
  });
  return out?.response?.trim() || "I drew a blank — say that again?";
}

async function runTTS(env: Env, text: string): Promise<{ audio: ArrayBuffer; type: string }> {
  // Primary: Deepgram Aura (natural, context-aware voice)
  try {
    const res: any = await env.AI.run("@cf/deepgram/aura-1", { text });
    const buf = res instanceof ArrayBuffer ? res : res?.audio;
    if (buf) {
      const audio = typeof buf === "string" ? base64ToBuf(buf) : buf;
      return { audio, type: "audio/mpeg" };
    }
  } catch {
    /* fall through */
  }
  // Fallback: MeloTTS
  const res: any = await env.AI.run("@cf/myshell-ai/melotts", { prompt: text });
  const b64 = res?.audio ?? "";
  return { audio: base64ToBuf(b64), type: "audio/mpeg" };
}

function base64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        stt: "@cf/openai/whisper-large-v3-turbo",
        llm: env.AI_GATEWAY_ENDPOINT ? "ai-gateway" : "@cf/meta/llama-3.1-8b-instruct",
        tts: "@cf/deepgram/aura-1",
      });
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        let userText = "";
        let history: { role: string; content: string }[] = [];

        const contentType = request.headers.get("Content-Type") || "";
        if (contentType.includes("multipart/form-data")) {
          // Voice path: audio → Whisper STT
          const form = await request.formData();
          const audio = form.get("audio");
          const histRaw = form.get("history");
          if (typeof histRaw === "string") {
            try { history = JSON.parse(histRaw); } catch { /* ignore */ }
          }
          if (audio instanceof File) {
            const buf = new Uint8Array(await audio.arrayBuffer());
            const stt: any = await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
              audio: [...buf],
            });
            userText = stt?.text?.trim() ?? "";
          }
        } else {
          // Text path
          const body: any = await request.json();
          userText = (body.text ?? "").trim();
          history = Array.isArray(body.history) ? body.history : [];
        }

        if (!userText) return json({ error: "empty input" }, 400);

        history = [...history, { role: "user", content: userText }];
        const reply = await runLLM(env, history);
        const { audio, type } = await runTTS(env, reply);

        return json({
          userText,
          text: reply,
          audioBase64: bufToBase64(audio),
          audioType: type,
        });
      } catch (err: any) {
        return json({ error: err?.message ?? "internal error" }, 500);
      }
    }

    return json({ error: "not found" }, 404);
  },
};
