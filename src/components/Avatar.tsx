import { useEffect, useRef } from "react";

export type AvatarState = "idle" | "listening" | "thinking" | "speaking";

interface Props {
  state: AvatarState;
  mouth: React.MutableRefObject<number>; // 0..1 mouth openness
  size?: number;
}

// Canvas-drawn luminous avatar face: breathing idle, blinking eyes that
// follow the cursor, amplitude-driven mouth, listening halo pulse.
// Used as fallback when the 3D model can't load.
export default function Avatar({ state, mouth, size = 340 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const mouse = useRef({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    let blink = 0;
    let nextBlink = performance.now() + 2500;
    let blinkPhase: "none" | "closing" | "opening" = "none";
    let raf = 0;

    const onMove = (e: PointerEvent) => {
      mouse.current = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight };
    };
    window.addEventListener("pointermove", onMove);

    const ACCENT = "#7b2eff";
    const ACCENT_SOFT = "rgba(123,46,255,0.35)";

    const draw = () => {
      const t = performance.now() / 1000;
      const s = stateRef.current;
      const W = size;
      const H = size;
      const cx = W / 2;
      const cy = H / 2;

      ctx.clearRect(0, 0, W, H);

      // background particles
      for (let i = 0; i < 26; i++) {
        const px = ((i * 137.5 + t * (6 + (i % 5))) % W);
        const py = (i * 89.3) % H + Math.sin(t * 0.6 + i) * 10;
        const a = 0.05 + 0.06 * Math.sin(t + i * 1.7) ** 2;
        ctx.fillStyle = `rgba(123,46,255,${a})`;
        ctx.beginPath();
        ctx.arc(px, py, 1.4 + (i % 3) * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // breathing
      const breath = 1 + 0.012 * Math.sin(t * 1.6);
      const thinkWobble = s === "thinking" ? Math.sin(t * 6) * 2 : 0;
      const R = W * 0.3 * breath;

      // halo
      const haloPulse =
        s === "listening" ? 0.5 + 0.5 * Math.sin(t * 5)
        : s === "speaking" ? 0.35 + 0.3 * Math.sin(t * 8)
        : 0.12;
      const haloR = R * (1.25 + 0.08 * haloPulse);
      const grad = ctx.createRadialGradient(cx, cy, R * 0.8, cx, cy, haloR);
      grad.addColorStop(0, `rgba(123,46,255,${0.28 * haloPulse + 0.08})`);
      grad.addColorStop(1, "rgba(123,46,255,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
      ctx.fill();

      // head
      ctx.save();
      ctx.translate(thinkWobble, 0);
      const headGrad = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.4, R * 0.2, cx, cy, R);
      headGrad.addColorStop(0, "#1a1026");
      headGrad.addColorStop(1, "#07040c");
      ctx.fillStyle = headGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = ACCENT_SOFT;
      ctx.stroke();

      // eyes
      const now = performance.now();
      if (blinkPhase === "none" && now > nextBlink) {
        blinkPhase = "closing";
        nextBlink = now + 2000 + Math.random() * 3500;
      }
      if (blinkPhase === "closing") {
        blink = Math.min(1, blink + 0.25);
        if (blink >= 1) blinkPhase = "opening";
      } else if (blinkPhase === "opening") {
        blink = Math.max(0, blink - 0.2);
        if (blink <= 0) blinkPhase = "none";
      }

      const lookX = (mouse.current.x - 0.5) * R * 0.18;
      const lookY = (mouse.current.y - 0.5) * R * 0.14;
      const eyeDX = R * 0.36;
      const eyeY = cy - R * 0.12;
      const eyeR = R * 0.115;

      for (const dir of [-1, 1]) {
        const ex = cx + dir * eyeDX + lookX;
        const ey = eyeY + lookY;
        const openness = 1 - blink * 0.92;
        const eg = ctx.createRadialGradient(ex, ey, 0, ex, ey, eyeR * 2.4);
        eg.addColorStop(0, `rgba(123,46,255,${0.5 * openness})`);
        eg.addColorStop(1, "rgba(123,46,255,0)");
        ctx.fillStyle = eg;
        ctx.beginPath();
        ctx.arc(ex, ey, eyeR * 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = openness > 0.15 ? "#e9ddff" : ACCENT_SOFT;
        ctx.beginPath();
        ctx.ellipse(ex, ey, eyeR, eyeR * openness, 0, 0, Math.PI * 2);
        ctx.fill();
        if (openness > 0.3) {
          ctx.fillStyle = ACCENT;
          ctx.beginPath();
          ctx.arc(ex + eyeR * 0.25, ey - eyeR * 0.25, eyeR * 0.28, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // mouth
      const openness = Math.min(1, mouth.current);
      const mw = R * 0.5;
      const mh = R * (0.05 + 0.42 * openness);
      const my = cy + R * 0.42;
      ctx.beginPath();
      ctx.ellipse(cx, my, mw / 2, mh / 2, 0, 0, Math.PI * 2);
      const mouthGrad = ctx.createRadialGradient(cx, my, 0, cx, my, mw / 2);
      mouthGrad.addColorStop(0, s === "speaking" ? "#b98aff" : "#8b5cf6");
      mouthGrad.addColorStop(1, "rgba(123,46,255,0.25)");
      ctx.fillStyle = mouthGrad;
      if (openness > 0.04) {
        ctx.shadowColor = ACCENT;
        ctx.shadowBlur = 18;
      }
      ctx.fill();
      ctx.shadowBlur = 0;

      if (openness > 0.45) {
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - mw * 0.28, my - mh * 0.12);
        ctx.quadraticCurveTo(cx, my - mh * 0.02, cx + mw * 0.28, my - mh * 0.12);
        ctx.stroke();
      }

      ctx.restore();

      // listening ring
      if (s === "listening") {
        ctx.strokeStyle = `rgba(123,46,255,${0.5 + 0.4 * Math.sin(t * 5)})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 8]);
        ctx.beginPath();
        ctx.arc(cx, cy, R * 1.14 + 4 * Math.sin(t * 5), t, t + Math.PI * 1.5);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, [mouth, size]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      aria-label="AI talking avatar"
    />
  );
}
