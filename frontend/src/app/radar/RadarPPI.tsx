"use client";
import { useRef, useEffect, useCallback, useState } from "react";
import { Detection, PPI_SIZE, polarToXY } from "./helpers";

interface Props {
  ppiBuffer: Array<{angle: number, returns: number[]}>;
  detections: Detection[];
  scanning: boolean;
  scanSpeed: number;
  beamWidth: number;
  sweepAngle: number;
  setSweepAngle: (a: number) => void;
  maxRange: number;
  beamformingResult?: any;
}

export default function RadarPPI({
  ppiBuffer,
  detections,
  scanning,
  scanSpeed,
  beamWidth,
  sweepAngle,
  setSweepAngle,
  maxRange,
  beamformingResult,
}: Props) {
  const ppiRef = useRef<HTMLCanvasElement>(null);
  const bbRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number>(0);
  const angleRef = useRef(0);
  const revealedRef = useRef<Array<{
    est_angle: number;
    est_range: number;
    uncertainty_range: number;
    signal_level: number;
    est_size?: number;
  }>>([]);
  const [revealedTracks, setRevealedTracks] = useState<Array<{
    est_angle: number;
    est_range: number;
    uncertainty_range: number;
    signal_level: number;
    est_size?: number;
  }>>([]);
  const cx = PPI_SIZE / 2, cy = PPI_SIZE / 2, r = PPI_SIZE / 2 - 24;

  const isTrackMatch = useCallback((a: { est_angle: number; est_range: number }, b: { est_angle: number; est_range: number }) => {
    const angleDiff = Math.abs(((a.est_angle - b.est_angle + 180) % 360) - 180);
    const rangeDiff = Math.abs(a.est_range - b.est_range);
    return angleDiff <= Math.max(beamWidth, 4) && rangeDiff <= 1200;
  }, [beamWidth]);

  const beamWindow = useCallback(
    (angle: number) => Math.max(angle * 0.75, 1.5),
    [],
  );

  // init backbuffer
  useEffect(() => {
    const bb = document.createElement("canvas");
    bb.width = PPI_SIZE; bb.height = PPI_SIZE;
    const ctx = bb.getContext("2d")!;
    ctx.fillStyle = "#0a0f0a"; ctx.fillRect(0, 0, PPI_SIZE, PPI_SIZE);
    bbRef.current = bb;
  }, []);

  const drawGrid = useCallback((ctx: CanvasRenderingContext2D, alpha: string = "") => {
    ctx.strokeStyle = `#0d2a0d${alpha}`; ctx.lineWidth = 1;
    for (let i = 1; i <= 5; i++) { ctx.beginPath(); ctx.arc(cx, cy, r * i / 5, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(cx, 24); ctx.lineTo(cx, PPI_SIZE - 24); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(24, cy); ctx.lineTo(PPI_SIZE - 24, cy); ctx.stroke();
  }, []);

  const drawLabels = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = "#2a6a2a"; ctx.font = "9px monospace"; ctx.textAlign = "center";
    ctx.fillText("0°", cx, 16); ctx.fillText("180°", cx, PPI_SIZE - 6);
    ctx.fillText("90°", PPI_SIZE - 10, cy + 4); ctx.fillText("270°", 14, cy + 4);
    for (let i = 1; i <= 5; i++) {
      const km = (maxRange * i / 5 / 1000).toFixed(0);
      ctx.fillText(`${km}`, cx + 14, cy - r * i / 5 + 4);
    }
  }, [cx, cy, r, maxRange]);

  // Static draw (idle scope only: no pre-revealed detections)
  const drawStatic = useCallback(() => {
    const canvas = ppiRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    canvas.width = PPI_SIZE; canvas.height = PPI_SIZE;

    ctx.fillStyle = "#0a0f0a"; ctx.fillRect(0, 0, PPI_SIZE, PPI_SIZE);
    drawGrid(ctx); drawLabels(ctx);

    // Sweep beam
    if (beamformingResult?.beam_profile) {
      const { angles, magnitudes_db } = beamformingResult.beam_profile;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      for (let i = 0; i < angles.length; i++) {
        const localAngle = angles[i];
        const db = Math.max(-60, magnitudes_db[i]);
        const intensity = Math.pow(10, db / 20);
        const a = (sweepAngle + localAngle) * Math.PI / 180 - Math.PI / 2;
        const dist = intensity * r;
        ctx.lineTo(cx + Math.cos(a) * dist, cy + Math.sin(a) * dist);
      }
      ctx.closePath();
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, "rgba(34,197,94,0.4)");
      grad.addColorStop(1, "rgba(34,197,94,0.0)");
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = "rgba(34,197,94,0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      const sa = sweepAngle * Math.PI / 180 - Math.PI / 2;
      ctx.strokeStyle = "#22c55e"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sa) * r, cy + Math.sin(sa) * r); ctx.stroke();
    }
    ctx.fillStyle = "#22c55e"; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
  }, [sweepAngle, drawGrid, drawLabels, beamformingResult, maxRange, cx, cy, r]);

  useEffect(() => { if (!scanning) drawStatic(); }, [scanning, drawStatic]);

  useEffect(() => {
    if (!scanning) return;
    setRevealedTracks([]);
    revealedRef.current = [];
    angleRef.current = 0;
    setSweepAngle(0);
  }, [scanning, setSweepAngle]);

  useEffect(() => {
    if (!scanning) {
      revealedRef.current = [];
      setRevealedTracks([]);
    }
  }, [scanning]);

  // Animation loop
  useEffect(() => {
    if (!scanning) { cancelAnimationFrame(animRef.current); return; }
    const bb = bbRef.current;
    if (!bb) return;

    let angle = angleRef.current;
    const speed = scanSpeed * 6;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = (now - last) / 1000; last = now;
      angle = (angle + speed * dt) % 360;
      angleRef.current = angle;
      setSweepAngle(angle);

      // Reveal detections only when the beam actually sweeps over them.
      setRevealedTracks((prev) => {
        let changed = false;
        let next = [...prev];
        const beamDetections = detections.filter((d) => {
          const delta = Math.abs(((d.est_angle - angle + 180) % 360) - 180);
          return delta <= beamWindow(beamWidth);
        });

        beamDetections.forEach((d) => {
          const idx = next.findIndex((t) => isTrackMatch(t, d));
          if (idx >= 0) {
            next[idx] = {
              est_angle: d.est_angle,
              est_range: d.est_range,
              uncertainty_range: d.uncertainty_range,
              signal_level: d.signal_level,
              est_size: d.est_size,
            };
          } else {
            next.push({
              est_angle: d.est_angle,
              est_range: d.est_range,
              uncertainty_range: d.uncertainty_range,
              signal_level: d.signal_level,
              est_size: d.est_size,
            });
          }
          changed = true;
        });

        // Remove tracks only when their sector is revisited and no hit is found.
        next = next.filter((track) => {
          const trackDelta = Math.abs(((track.est_angle - angle + 180) % 360) - 180);
          if (trackDelta > beamWindow(beamWidth)) return true;
          return beamDetections.some((d) => isTrackMatch(track, d));
        });

        if (!changed) return prev;
        revealedRef.current = next;
        return next;
      });

      const ctx = bb.getContext("2d")!;
      // Phosphor fade
      ctx.fillStyle = "rgba(10,15,10,0.06)"; ctx.fillRect(0, 0, PPI_SIZE, PPI_SIZE);
      drawGrid(ctx, "30");

      const sa = angle * Math.PI / 180 - Math.PI / 2;

      // Draw returns at current angle
      if (ppiBuffer && ppiBuffer.length > 0) {
        const closest = ppiBuffer.reduce((best: any, scan: any) => {
          const diff = Math.abs(((scan.angle - angle + 360) % 360));
          const bestDiff = Math.abs(((best.angle - angle + 360) % 360));
          return diff < bestDiff ? scan : best;
        }, ppiBuffer[0]);
        if (closest) {
          const a = closest.angle * Math.PI / 180 - Math.PI / 2;
          closest.returns.forEach((v: number, i: number) => {
            if (v > 5) {
              const dist = i / closest.returns.length * r;
              const intensity = Math.min(1, v / 100);
              ctx.fillStyle = `rgba(74,222,128,${intensity})`;
              ctx.fillRect(cx + Math.cos(a) * dist - 1, cy + Math.sin(a) * dist - 1, 3, 3);
            }
          });
        }
      }

      // Sweep beam
      if (beamformingResult?.beam_profile) {
        const { angles, magnitudes_db } = beamformingResult.beam_profile;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        for (let i = 0; i < angles.length; i++) {
          const localAngle = angles[i];
          const db = Math.max(-60, magnitudes_db[i]);
          const intensity = Math.pow(10, db / 20);
          const a = (angle + localAngle) * Math.PI / 180 - Math.PI / 2;
          const dist = intensity * r;
          ctx.lineTo(cx + Math.cos(a) * dist, cy + Math.sin(a) * dist);
        }
        ctx.closePath();
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, "rgba(34,197,94,0.4)");
        grad.addColorStop(1, "rgba(34,197,94,0.0)");
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = "rgba(34,197,94,0.5)";
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        const grad = ctx.createLinearGradient(cx, cy, cx + Math.cos(sa) * r, cy + Math.sin(sa) * r);
        grad.addColorStop(0, "rgba(34,197,94,0.9)"); grad.addColorStop(1, "rgba(34,197,94,0.0)");
        ctx.strokeStyle = grad; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sa) * r, cy + Math.sin(sa) * r); ctx.stroke();
      }
      ctx.fillStyle = "#22c55e"; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();

      // Blit
      const vc = ppiRef.current;
      if (vc) {
        const vctx = vc.getContext("2d")!;
        vc.width = PPI_SIZE; vc.height = PPI_SIZE;
        vctx.drawImage(bb, 0, 0);
        drawLabels(vctx);
        // Draw detection markers on visible canvas
        revealedRef.current.forEach((d) => {
          const { x, y } = polarToXY(d.est_angle, d.est_range, cx, cy, r, maxRange);
          const ur = d.uncertainty_range / maxRange * r;
          vctx.strokeStyle = "rgba(245,158,11,0.5)"; vctx.lineWidth = 1;
          vctx.setLineDash([4, 3]); vctx.beginPath(); vctx.arc(x, y, Math.max(ur, 6), 0, Math.PI * 2); vctx.stroke();
          vctx.setLineDash([]);
          vctx.strokeStyle = "#f59e0b"; vctx.lineWidth = 1;
          vctx.beginPath(); vctx.moveTo(x - 6, y); vctx.lineTo(x + 6, y); vctx.stroke();
          vctx.beginPath(); vctx.moveTo(x, y - 6); vctx.lineTo(x, y + 6); vctx.stroke();
        });
      }

      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [scanning, scanSpeed, ppiBuffer, detections, beamWidth, setSweepAngle, drawGrid, drawLabels, isTrackMatch, beamWindow, maxRange, cx, cy, r, beamformingResult]);

  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-green-400">Radar PPI Display</h3>
      </div>
      <canvas
        ref={ppiRef}
        className="rounded-xl border border-green-900/40"
        style={{ width: PPI_SIZE, height: PPI_SIZE }}
      />
      <p className="mt-1 text-[10px] text-text-muted text-center">Targets appear only when scanned · Dashed circles = uncertainty</p>
    </div>
  );
}
