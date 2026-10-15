import { useCallback, useRef, useState } from "react";
import RobotAvatar from "@/components/RobotAvatar";
import type { AvatarState } from "@/components/Avatar";
import { useSpeechRecognition, useSpeechSynthesis } from "@/hooks/useSpeech";
import {
  getReply,
  loadBrainConfig,
  saveBrainConfig,
  checkWorker,
  workerChat,
  getApiBase,
  setApiBase,
} from "@/lib/brain";
import { Mic, MicOff, Send, Settings2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const STATUS: Record<AvatarState, string> = {
  idle: "Tap the mic and talk to me",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

export default function App() {
  const mouth = useRef(0);
  const [state, setState] = useState<AvatarState>("idle");
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", content: "Hi, I'm NOVA. Tap the mic or type below — I'll talk back." },
  ]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState(loadBrainConfig());
  const [apiBase, setApiBaseInput] = useState(getApiBase());
  const [workerOn, setWorkerOn] = useState(false);
  const historyRef = useRef<Msg[]>([]);

  useState(() => {
    checkWorker().then(setWorkerOn);
  });

  const { speak, stopSpeaking, playAudioUrl } = useSpeechSynthesis(mouth, (speaking) => {
    setState(speaking ? "speaking" : "idle");
  });

  const handleUser = useCallback(
    async (content: string) => {
      if (!content.trim() || busy) return;
      setBusy(true);
      setMsgs((m) => [...m.slice(-5), { role: "user", content }]);
      setState("thinking");
      try {
        if (await checkWorker()) {
          // Edge pipeline: Workers AI LLM + Aura TTS
          const { text: reply, audioUrl } = await workerChat({
            text: content,
            history: historyRef.current,
          });
          historyRef.current = [
            ...historyRef.current,
            { role: "user", content },
            { role: "assistant", content: reply },
          ];
          setMsgs((m) => [...m.slice(-5), { role: "assistant", content: reply }]);
          setBusy(false);
          playAudioUrl(audioUrl);
          return;
        }
      } catch {
        /* fall through to local brain */
      }
      historyRef.current = [...historyRef.current, { role: "user", content }];
      const { text: reply } = await getReply(historyRef.current);
      historyRef.current = [...historyRef.current, { role: "assistant", content: reply }];
      setMsgs((m) => [...m.slice(-5), { role: "assistant", content: reply }]);
      setBusy(false);
      speak(reply);
    },
    [busy, speak, playAudioUrl]
  );

  const { listening, supported, startListening, stopListening } =
    useSpeechRecognition((t) => {
      setState("thinking");
      handleUser(t);
    });

  const toggleMic = () => {
    if (listening) {
      stopListening();
      setState("idle");
    } else {
      stopSpeaking();
      setState("listening");
      startListening();
    }
  };

  const sendText = () => {
    if (!text.trim()) return;
    const t = text;
    setText("");
    handleUser(t);
  };

  const brainConnected = !!(cfg.apiBase && cfg.apiKey);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col overflow-hidden select-none">
      {/* top bar */}
      <header className="flex items-center justify-between px-6 py-4">
        <div className="tracking-[0.35em] text-xs text-white/50 uppercase">
          Nova · Talking Avatar
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="text-white/60 hover:text-white gap-2">
              <Settings2 className="w-4 h-4" />
              <span className="hidden sm:inline text-xs">
                {workerOn ? "Edge AI connected" : brainConnected ? "AI brain connected" : "Demo brain — connect AI"}
              </span>
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-[#0b0712] border-white/10 text-white">
            <DialogHeader>
              <DialogTitle>Connect an AI brain</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-white/50">
              Point NOVA at any OpenAI-compatible endpoint (OpenAI, Gemini compat
              proxy, your own gateway). Without this, a simple offline demo brain
              answers.
            </p>
            <div className="space-y-3 pt-2">
              <Input
                placeholder="Cloudflare worker URL, e.g. https://nova-avatar-backend.you.workers.dev"
                value={apiBase}
                onChange={(e) => setApiBaseInput(e.target.value)}
                className="bg-black/40 border-white/15"
              />
              <Button
                variant="outline"
                className="w-full border-white/15 text-white/80"
                onClick={() => {
                  setApiBase(apiBase.trim());
                  checkWorker().then(setWorkerOn);
                }}
              >
                {workerOn ? "Edge backend connected ✓" : "Connect edge backend (Workers AI)"}
              </Button>
              <div className="h-px bg-white/10" />
              <Input
                placeholder="API base, e.g. https://api.openai.com/v1"
                value={cfg.apiBase}
                onChange={(e) => setCfg({ ...cfg, apiBase: e.target.value })}
                className="bg-black/40 border-white/15"
              />
              <Input
                placeholder="API key"
                type="password"
                value={cfg.apiKey}
                onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
                className="bg-black/40 border-white/15"
              />
              <Input
                placeholder="Model, e.g. gpt-4o-mini"
                value={cfg.model}
                onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
                className="bg-black/40 border-white/15"
              />
              <Button
                className="w-full bg-[#7b2eff] hover:bg-[#8f4bff] text-white"
                onClick={() => saveBrainConfig(cfg)}
              >
                Save (stored in this browser only)
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </header>

      {/* avatar center stage */}
      <main className="flex-1 flex flex-col items-center justify-center gap-2 px-6 -mt-6">
        <RobotAvatar state={state} mouth={mouth} size={Math.min(360, window.innerWidth - 80)} />
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-semibold tracking-wide">NOVA</h1>
          <p className="text-sm text-[#b98aff] h-5 transition-all">
            {STATUS[state]}
          </p>
        </div>

        {/* transcript */}
        <div className="w-full max-w-md space-y-2 mt-2">
          {msgs.slice(-3).map((m, i, arr) => (
            <div
              key={i}
              className={`text-sm leading-relaxed transition-opacity ${
                m.role === "user" ? "text-white/45 text-right" : "text-white/85"
              } ${i < arr.length - 1 ? "opacity-40" : "opacity-100"}`}
            >
              {m.content}
            </div>
          ))}
        </div>
      </main>

      {/* control bar */}
      <footer className="px-6 pb-8 flex flex-col items-center gap-4">
        <div className="flex items-center gap-3 w-full max-w-md">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendText()}
            placeholder="Type a message…"
            className="bg-white/5 border-white/10 text-white placeholder:text-white/30 h-12 rounded-full px-5"
          />
          <Button
            onClick={sendText}
            size="icon"
            className="h-12 w-12 rounded-full bg-white/10 hover:bg-white/20 shrink-0"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex items-center gap-6">
          <button
            onClick={toggleMic}
            disabled={!supported}
            className={`h-16 w-16 rounded-full flex items-center justify-center transition-all duration-200 ${
              listening
                ? "bg-[#7b2eff] shadow-[0_0_40px_rgba(123,46,255,0.6)] scale-110"
                : "bg-[#7b2eff]/90 hover:bg-[#8f4bff] hover:shadow-[0_0_30px_rgba(123,46,255,0.4)]"
            } ${!supported ? "opacity-30 cursor-not-allowed" : ""}`}
          >
            {listening ? (
              <MicOff className="w-6 h-6 text-white" />
            ) : (
              <Mic className="w-6 h-6 text-white" />
            )}
          </button>
          {state === "speaking" && (
            <button
              onClick={stopSpeaking}
              className="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"
              title="Stop speaking"
            >
              <Square className="w-4 h-4" />
            </button>
          )}
        </div>
        <p className="text-[11px] text-white/30 text-center max-w-sm">
          {supported
            ? "Voice runs fully in your browser. Chrome/Edge recommended for speech recognition."
            : "Speech recognition isn't supported in this browser — text chat still works, and NOVA will still speak replies."}
        </p>
      </footer>
    </div>
  );
}
