// Conversational brain for the avatar.
// Priority: Cloudflare Worker (Workers AI at the edge) → OpenAI-compatible
// endpoint configured by the user → local offline demo brain.

export interface BrainConfig {
  apiBase: string; // e.g. https://api.openai.com/v1 or Gemini-compat proxy
  apiKey: string;
  model: string;
}

const STORAGE_KEY = "avatar-brain-config";

export function loadBrainConfig(): BrainConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { apiBase: "", apiKey: "", model: "gpt-4o-mini" };
}

export function saveBrainConfig(cfg: BrainConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

const SYSTEM_PROMPT =
  "You are NOVA, a warm, witty AI talking avatar. Keep every reply short (1-3 sentences), conversational, and natural for speech. No markdown, no lists, no emojis.";

async function remoteReply(
  history: { role: string; content: string }[],
  cfg: BrainConfig
): Promise<string> {
  const base = cfg.apiBase.replace(/\/+$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model || "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history.slice(-10),
      ],
      max_tokens: 150,
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  return (
    data.choices?.[0]?.message?.content?.trim() ||
    "I drew a blank. Say that again?"
  );
}

// ---------- Cloudflare Worker backend (Workers AI at the edge) ----------
const API_BASE_KEY = "nova-api-base";
let workerHealthy: boolean | null = null;

export function getApiBase(): string {
  return localStorage.getItem(API_BASE_KEY) ?? "";
}

export function setApiBase(base: string) {
  if (base) localStorage.setItem(API_BASE_KEY, base);
  else localStorage.removeItem(API_BASE_KEY);
  workerHealthy = null; // re-check on next call
}

// Probe the worker once per session; null = not checked yet.
export async function checkWorker(): Promise<boolean> {
  if (workerHealthy !== null) return workerHealthy;
  const base = getApiBase();
  if (!base) return (workerHealthy = false);
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/api/health`, {
      signal: AbortSignal.timeout(4000),
    });
    workerHealthy = res.ok;
  } catch {
    workerHealthy = false;
  }
  return workerHealthy;
}

// Full edge pipeline: text or audio in → { reply text, spoken audio } out.
export async function workerChat(opts: {
  text?: string;
  audio?: Blob;
  history: { role: string; content: string }[];
}): Promise<{ userText: string; text: string; audioUrl: string }> {
  const base = getApiBase().replace(/\/+$/, "");
  let res: Response;
  if (opts.audio) {
    const form = new FormData();
    form.append("audio", opts.audio, "user_audio.wav");
    form.append("history", JSON.stringify(opts.history.slice(-10)));
    res = await fetch(`${base}/api/chat`, { method: "POST", body: form });
  } else {
    res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: opts.text, history: opts.history.slice(-10) }),
    });
  }
  if (!res.ok) throw new Error(`worker ${res.status}`);
  const data = await res.json();
  const bytes = Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0));
  const audioUrl = URL.createObjectURL(new Blob([bytes], { type: data.audioType }));
  return { userText: data.userText, text: data.text, audioUrl };
}

// ---------- Local demo brain (offline, rule-based) ----------
const localRules: { re: RegExp; replies: string[] }[] = [
  {
    re: /\b(hi|hello|hey|yo|good morning|good evening)\b/i,
    replies: [
      "Hey there. Good to hear your voice. What's on your mind?",
      "Hello. I'm NOVA, your talking avatar. Ask me anything.",
    ],
  },
  {
    re: /who are you|your name|what are you/i,
    replies: [
      "I'm NOVA — a talking avatar living in your browser. Right now I'm running on a demo brain, but plug in an API key and I get a whole lot smarter.",
    ],
  },
  {
    re: /how are you|how('s| is) it going/i,
    replies: [
      "Running smooth at sixty frames per second. How about you?",
      "Feeling luminous today. Thanks for asking.",
    ],
  },
  {
    re: /what can you do|help me|abilities/i,
    replies: [
      "I can listen, think, and speak back with a moving mouth. Open the settings to connect me to a real language model, and I can do much more.",
    ],
  },
  {
    re: /joke|funny/i,
    replies: [
      "Why do programmers prefer dark mode? Because light attracts bugs.",
      "I told my trainer a joke about overfitting. He didn't get it — he only laughed at the training set.",
    ],
  },
  {
    re: /time|date|today/i,
    replies: [`Right now it's ${new Date().toLocaleString()}. Time flies when you're rendered in real time.`],
  },
  {
    re: /thank/i,
    replies: ["Anytime. That's what I'm here for.", "You're very welcome."],
  },
  {
    re: /bye|goodbye|see you/i,
    replies: ["See you soon. I'll be right here, glowing quietly."],
  },
];

const fallbacks = [
  "Interesting. Tell me more about that.",
  "I hear you. My demo brain is simple, but connect an API key in settings and I'll give you a real answer.",
  "Got it. What would you like to explore next?",
  "That's a good one for a bigger model. Add your API key in the settings panel and ask me again.",
];

function localReply(text: string): string {
  for (const rule of localRules) {
    if (rule.re.test(text)) {
      const pool = rule.replies;
      return pool[Math.floor(Math.random() * pool.length)];
    }
  }
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

export async function getReply(
  history: { role: string; content: string }[]
): Promise<{ text: string; source: "remote" | "local" }> {
  const cfg = loadBrainConfig();
  const last = history[history.length - 1]?.content ?? "";
  if (cfg.apiBase && cfg.apiKey) {
    try {
      return { text: await remoteReply(history, cfg), source: "remote" };
    } catch {
      return {
        text:
          "My connection to the model failed, so I'll answer locally. " +
          localReply(last),
        source: "local",
      };
    }
  }
  await new Promise((r) => setTimeout(r, 400 + Math.random() * 500));
  return { text: localReply(last), source: "local" };
}
