"use client";
import { useRef, useEffect, useCallback } from "react";
import type { Dispatch, SetStateAction, MouseEvent } from "react";
import { Target, GT_SIZE, MAX_TARGETS, polarToXY, xyToPolar } from "./helpers";

interface Props {
  targets: Target[];
  setTargets: Dispatch<SetStateAction<Target[]>>;
  onTargetsChanged: () => void;
  maxRange: number;
}

export default function GroundTruthMap({ targets, setTargets, onTargetsChanged, maxRange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef<number | null>(null);
  const cx = GT_SIZE / 2, cy = GT_SIZE / 2, r = GT_SIZE / 2 - 24;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    canvas.width = GT_SIZE; canvas.height = GT_SIZE;

    // Background
    ctx.fillStyle = "#080d18"; ctx.fillRect(0, 0, GT_SIZE, GT_SIZE);

    // Grid
    ctx.strokeStyle = "#0e2a4a"; ctx.lineWidth = 1;
    for (let i = 1; i <= 5; i++) { ctx.beginPath(); ctx.arc(cx, cy, r * i / 5, 0, Math.PI * 2); ctx.stroke(); }
    for (let a = 0; a < 360; a += 30) {
      const rad = a * Math.PI / 180 - Math.PI / 2;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(rad) * r, cy + Math.sin(rad) * r); ctx.stroke();
    }

    // Range labels
    ctx.fillStyle = "#2a6faa"; ctx.font = "9px monospace"; ctx.textAlign = "center";
    for (let i = 1; i <= 5; i++) {
      const km = (maxRange * i / 5 / 1000).toFixed(0);
      ctx.fillText(`${km}km`, cx, cy - r * i / 5 + 12);
    }

    // Angle labels
    const labels = ["0°","30°","60°","90°","120°","150°","180°","210°","240°","270°","300°","330°"];
    labels.forEach((lbl, i) => {
      const a = i * 30 * Math.PI / 180 - Math.PI / 2;
      const lr = r + 14;
      ctx.fillStyle = "#2a6faa"; ctx.font = "9px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(lbl, cx + Math.cos(a) * lr, cy + Math.sin(a) * lr);
    });

    // Radar at center
    ctx.fillStyle = "#06b6d4"; ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#06b6d4"; ctx.font = "bold 9px monospace"; ctx.textAlign = "center";
    ctx.fillText("RADAR", cx, cy + 16);

    // Targets
    targets.forEach((t, i) => {
      const { x, y } = polarToXY(t.angle, t.distance, cx, cy, r, maxRange);
      const sz = Math.max(5, t.size / 4);

      // Glow
      const grd = ctx.createRadialGradient(x, y, 0, x, y, sz * 3);
      grd.addColorStop(0, "rgba(59,130,246,0.3)"); grd.addColorStop(1, "transparent");
      ctx.fillStyle = grd; ctx.fillRect(x - sz * 3, y - sz * 3, sz * 6, sz * 6);

      // Icon
      ctx.fillStyle = "#3b82f6"; ctx.beginPath(); ctx.arc(x, y, sz, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#60a5fa"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, sz, 0, Math.PI * 2); ctx.stroke();

      // Label
      ctx.fillStyle = "#93c5fd"; ctx.font = "bold 10px monospace"; ctx.textAlign = "center";
      ctx.fillText(`T${i + 1}`, x, y - sz - 6);
      ctx.fillStyle = "#60a5fa88"; ctx.font = "8px monospace";
      ctx.fillText(`${(t.distance/1000).toFixed(1)}km ${t.angle.toFixed(0)}°`, x, y + sz + 10);
    });
  }, [targets, maxRange, cx, cy, r]);

  useEffect(() => { draw(); }, [draw]);

  const getCanvasXY = (e: MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { mx: (e.clientX - rect.left) / rect.width * GT_SIZE, my: (e.clientY - rect.top) / rect.height * GT_SIZE };
  };

  const onMouseDown = (e: MouseEvent<HTMLCanvasElement>) => {
    const { mx, my } = getCanvasXY(e);
    for (let i = 0; i < targets.length; i++) {
      const { x, y } = polarToXY(targets[i].angle, targets[i].distance, cx, cy, r, maxRange);
      if (Math.sqrt((mx - x) ** 2 + (my - y) ** 2) < Math.max(5, targets[i].size / 4) + 10) {
        dragging.current = i; e.preventDefault(); return;
      }
    }
  };

  const onMouseMove = (e: MouseEvent<HTMLCanvasElement>) => {
    if (dragging.current === null) return;
    const { mx, my } = getCanvasXY(e);
    const polar = xyToPolar(mx, my, cx, cy, r, maxRange);
    if (!polar) return;
    const i = dragging.current;
    setTargets(prev => prev.map((t, idx) => idx === i ? { ...t, angle: Math.round(polar.angle), distance: Math.round(polar.distance) } : t));
  };

  const onMouseUp = () => { if (dragging.current !== null) { dragging.current = null; onTargetsChanged(); } };

  const onClick = (e: MouseEvent<HTMLCanvasElement>) => {
    if (dragging.current !== null) return;
    const { mx, my } = getCanvasXY(e);
    const polar = xyToPolar(mx, my, cx, cy, r, maxRange);
    if (!polar || targets.length >= MAX_TARGETS) return;
    setTargets(prev => [...prev, { id: prev.length, distance: Math.round(polar.distance), angle: Math.round(polar.angle), size: 20 }]);
    onTargetsChanged();
  };

  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-block w-2 h-2 rounded-full bg-blue-500"></span>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-blue-400">Ground Truth Map</h3>
      </div>
      <canvas
        ref={canvasRef}
        className="rounded-xl border border-blue-900/40 cursor-crosshair"
        style={{ width: GT_SIZE, height: GT_SIZE }}
        onClick={onClick}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      />
      <p className="mt-1 text-[10px] text-text-muted text-center">Click to place targets · Drag to reposition</p>
    </div>
  );
}
