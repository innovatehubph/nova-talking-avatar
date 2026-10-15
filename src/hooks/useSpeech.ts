import { useCallback, useEffect, useRef, useState } from "react";

// Speech hooks: STT via webkitSpeechRecognition, TTS via speechSynthesis.
// Mouth amplitude is simulated while speaking (bounded random + boundary kicks).

export type MouthRef = React.MutableRefObject<number>;

export function useSpeechSynthesis(mouth: MouthRef, onSpeakingChange: (s: boolean) => void) {
  const animRef = useRef<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const speak = useCallback(
    (text: string) => {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.02;
      utter.pitch = 1.0;
      const voices = synth.getVoices();
      const preferred =
        voices.find((v) => /en[-_]US/i.test(v.lang) && /female|samantha|zira|google us english/i.test(v.name)) ||
        voices.find((v) => /^en/i.test(v.lang));
      if (preferred) utter.voice = preferred;

      const animate = () => {
        // organic syllable-like amplitude
        const t = performance.now() / 1000;
        const base = 0.35 + 0.3 * Math.abs(Math.sin(t * 9) * Math.sin(t * 3.7));
        mouth.current = base + Math.random() * 0.25;
        animRef.current = requestAnimationFrame(animate);
      };
      utter.onstart = () => {
        onSpeakingChange(true);
        animate();
      };
      utter.onboundary = () => {
        mouth.current = Math.min(1, mouth.current + 0.3);
      };
      const stop = () => {
        cancelAnimationFrame(animRef.current);
        mouth.current = 0;
        onSpeakingChange(false);
      };
      utter.onend = stop;
      utter.onerror = stop;
      synth.speak(utter);
    },
    [mouth, onSpeakingChange]
  );

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
    audioRef.current = null;
    cancelAnimationFrame(animRef.current);
    mouth.current = 0;
    onSpeakingChange(false);
  }, [mouth, onSpeakingChange]);

  // Play audio returned by the Cloudflare worker (Aura TTS mp3),
  // driving the same organic mouth animation while it plays.
  const playAudioUrl = useCallback(
    (url: string) => {
      stopSpeaking();
      const audio = new Audio(url);
      const animate = () => {
        const t = performance.now() / 1000;
        const base = 0.35 + 0.3 * Math.abs(Math.sin(t * 9) * Math.sin(t * 3.7));
        mouth.current = base + Math.random() * 0.25;
        animRef.current = requestAnimationFrame(animate);
      };
      const stop = () => {
        cancelAnimationFrame(animRef.current);
        mouth.current = 0;
        onSpeakingChange(false);
        URL.revokeObjectURL(url);
      };
      audio.onplay = () => {
        onSpeakingChange(true);
        animate();
      };
      audio.onended = stop;
      audio.onerror = stop;
      audio.play().catch(stop);
      audioRef.current = audio;
    },
    [mouth, onSpeakingChange, stopSpeaking]
  );

  useEffect(() => () => stopSpeaking(), [stopSpeaking]);

  return { speak, stopSpeaking, playAudioUrl };
}

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: (e: any) => void;
  onend: () => void;
  onerror: (e: any) => void;
  start: () => void;
  stop: () => void;
}

export function useSpeechRecognition(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const recRef = useRef<RecognitionLike | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  useEffect(() => {
    const Ctor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) {
      setSupported(false);
      return;
    }
    const rec: RecognitionLike = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e: any) => {
      const text = e.results?.[0]?.[0]?.transcript?.trim();
      if (text) onFinalRef.current(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    return () => {
      try {
        rec.stop();
      } catch {
        /* noop */
      }
    };
  }, []);

  const startListening = useCallback(() => {
    if (!recRef.current) return;
    try {
      recRef.current.start();
      setListening(true);
    } catch {
      /* already started */
    }
  }, []);

  const stopListening = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* noop */
    }
    setListening(false);
  }, []);

  return { listening, supported, startListening, stopListening };
}
