"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { radarFullSweep } from "@/lib/api";

const PPI_SIZE = 500;
const MAX_TARGETS = 5;

interface Target { id: number; distance: number; angle: number; size: number; }

const DEFAULT_TARGETS: Target[] = [
  { id: 0, distance: 15000, angle: 45, size: 20 },
  { id: 1, distance: 25000, angle: 150, size: 35 },
  { id: 2, distance: 10000, angle: 270, size: 15 },
];

export default function RadarPage() {
  const [targets, setTargets] = useState<Target[]>(DEFAULT_TARGETS);
  const [beamWidth, setBeamWidth] = useState(10);
  const [scanSpeed, setScanSpeed] = useState(30);
  const [numElements, setNumElements] = useState(32);
  const [snr, setSnr] = useState(200);
  const [windowType, setWindowType] = useState("hamming");
  const [sweepResult, setSweepResult] = useState<any>(null);
  const [sweepAngle, setSweepAngle] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editTarget, setEditTarget] = useState<number | null>(null);

  const ppiRef = useRef<HTMLCanvasElement>(null);
  const backbufRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number>(0);
  const sweepAngleRef = useRef(0);
  const sweepResultRef = useRef<any>(null);
  const targetsRef = useRef(targets);
  const beamWidthRef = useRef(beamWidth);

  // Drag state
  const draggingTargetRef = useRef<number | null>(null);

  targetsRef.current = targets;
  sweepResultRef.current = sweepResult;
  beamWidthRef.current = beamWidth;

  // Init backbuffer
  useEffect(() => {
    const bb = document.createElement("canvas");
    bb.width = PPI_SIZE; bb.height = PPI_SIZE;
    const ctx = bb.getContext("2d")!;
    ctx.fillStyle = "#0f1117";
    ctx.fillRect(0, 0, PPI_SIZE, PPI_SIZE);
    backbufRef.current = bb;
  }, []);

  const runSweep = useCallback(async () => {
    setLoading(true);
    try {
      const d = await radarFullSweep({
        beam_width: beamWidth, scan_speed: scanSpeed, targets,
        num_elements: numElements, element_spacing: 0.5, frequency: 3e9,
        window_type: windowType, snr
      });
      setSweepResult(d);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [beamWidth, scanSpeed, targets, numElements, snr, windowType]);

  useEffect(() => { runSweep(); }, []);

  // Draw static PPI (no animation) when not scanning
  const drawStaticPPI = useCallback(() => {
    const canvas = ppiRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    canvas.width = PPI_SIZE; canvas.height = PPI_SIZE;
    const cx = PPI_SIZE / 2, cy = PPI_SIZE / 2, r = PPI_SIZE / 2 - 20;

    ctx.fillStyle = "#0f1117"; ctx.fillRect(0, 0, PPI_SIZE, PPI_SIZE);

    // Range rings
    ctx.strokeStyle = "#1a1d27"; ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) { ctx.beginPath(); ctx.arc(cx, cy, r * i / 4, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(cx, 20); ctx.lineTo(cx, PPI_SIZE - 20); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(20, cy); ctx.lineTo(PPI_SIZE - 20, cy); ctx.stroke();

    ctx.fillStyle = "#555a6e"; ctx.font = "10px monospace"; ctx.textAlign = "center";
    ctx.fillText("0°", cx, 14); ctx.fillText("180°", cx, PPI_SIZE - 4);
    ctx.fillText("90°", PPI_SIZE - 8, cy + 4); ctx.fillText("270°", 12, cy + 4);

    const maxRange = sweepResult?.range_max || 50000;
    if (sweepResult?.ppi_data) {
      for (const scan of sweepResult.ppi_data) {
        const a = scan.angle * Math.PI / 180 - Math.PI / 2;
        const returns = scan.returns;
        for (let i = 0; i < returns.length; i++) {
          if (returns[i] > 5) {
            const dist = i / returns.length * r;
            const intensity = Math.min(1, returns[i] / 100);
            const px = cx + Math.cos(a) * dist, py = cy + Math.sin(a) * dist;
            ctx.fillStyle = `rgba(245,158,11,${intensity * 0.8})`;
            ctx.fillRect(px - 1, py - 1, 3, 3);
          }
        }
      }
    }

    targets.forEach((t, i) => {
      const a = t.angle * Math.PI / 180 - Math.PI / 2;
      const d = t.distance / maxRange * r;
      const px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d;
      const sz = Math.max(4, t.size / 5);
      ctx.fillStyle = editTarget === i ? "#f59e0b" : "#f59e0b88";
      ctx.beginPath(); ctx.arc(px, py, sz, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e4e6ef"; ctx.font = "9px monospace"; ctx.textAlign = "center";
      ctx.fillText(`T${i + 1}`, px, py - sz - 4);
    });

    // Sweep line
    const sa = sweepAngle * Math.PI / 180 - Math.PI / 2;
    ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sa) * r, cy + Math.sin(sa) * r); ctx.stroke();
    const halfBw = beamWidth / 2 * Math.PI / 180;
    ctx.fillStyle = "rgba(245,158,11,0.06)";
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, sa - halfBw, sa + halfBw); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#f59e0b"; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
  }, [sweepResult, targets, sweepAngle, beamWidth, editTarget]);

  useEffect(() => {
    if (!scanning) drawStaticPPI();
  }, [scanning, drawStaticPPI]);

  // Phosphor animation loop
  useEffect(() => {
    if (!scanning) { cancelAnimationFrame(animRef.current); return; }
    const bb = backbufRef.current;
    if (!bb) return;

    let angle = sweepAngleRef.current;
    const speed = scanSpeed * 6;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      angle = (angle + speed * dt) % 360;
      sweepAngleRef.current = angle;
      setSweepAngle(angle);

      const ctx = bb.getContext("2d")!;
      const cx = PPI_SIZE / 2, cy = PPI_SIZE / 2, r = PPI_SIZE / 2 - 20;

      // Phosphor fade
      ctx.fillStyle = "rgba(15,17,23,0.08)";
      ctx.fillRect(0, 0, PPI_SIZE, PPI_SIZE);

      // Redraw range rings (faint)
      ctx.strokeStyle = "#1a1d2720"; ctx.lineWidth = 1;
      for (let i = 1; i <= 4; i++) { ctx.beginPath(); ctx.arc(cx, cy, r * i / 4, 0, Math.PI * 2); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(cx, 20); ctx.lineTo(cx, PPI_SIZE - 20); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(20, cy); ctx.lineTo(PPI_SIZE - 20, cy); ctx.stroke();

      const sa = angle * Math.PI / 180 - Math.PI / 2;
      const sweepRes = sweepResultRef.current;
      const maxRange = sweepRes?.range_max || 50000;

      // New returns at full brightness
      if (sweepRes?.ppi_data) {
        const closestScan = sweepRes.ppi_data.reduce((best: any, scan: any) => {
          const diff = Math.abs(((scan.angle - angle + 360) % 360));
          const bestDiff = Math.abs(((best.angle - angle + 360) % 360));
          return diff < bestDiff ? scan : best;
        }, sweepRes.ppi_data[0]);
        if (closestScan) {
          const a = closestScan.angle * Math.PI / 180 - Math.PI / 2;
          closestScan.returns.forEach((v: number, i: number) => {
            if (v > 5) {
              const dist = i / closestScan.returns.length * r;
              const intensity = Math.min(1, v / 100);
              const px = cx + Math.cos(a) * dist, py = cy + Math.sin(a) * dist;
              ctx.fillStyle = `rgba(245,200,50,${intensity})`;
              ctx.fillRect(px - 1, py - 1, 3, 3);
            }
          });
        }
      }

      // Draw sweep line glow
      const grad = ctx.createLinearGradient(cx, cy, cx + Math.cos(sa) * r, cy + Math.sin(sa) * r);
      grad.addColorStop(0, "rgba(245,158,11,0.9)");
      grad.addColorStop(1, "rgba(245,158,11,0.0)");
      ctx.strokeStyle = grad; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sa) * r, cy + Math.sin(sa) * r); ctx.stroke();

      // Targets
      targetsRef.current.forEach((t, i) => {
        const a = t.angle * Math.PI / 180 - Math.PI / 2;
        const d = t.distance / maxRange * r;
        const px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d;
        const sz = Math.max(4, t.size / 5);
        ctx.fillStyle = "#f59e0bcc";
        ctx.beginPath(); ctx.arc(px, py, sz, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#e4e6ef80"; ctx.font = "9px monospace"; ctx.textAlign = "center";
        ctx.fillText(`T${i + 1}`, px, py - sz - 4);
      });

      ctx.fillStyle = "#f59e0b"; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();

      // Blit to visible canvas
      const vc = ppiRef.current;
      if (vc) {
        const vctx = vc.getContext("2d")!;
        vc.width = PPI_SIZE; vc.height = PPI_SIZE;
        vctx.drawImage(bb, 0, 0);
        // labels
        vctx.fillStyle = "#555a6e"; vctx.font = "10px monospace"; vctx.textAlign = "center";
        vctx.fillText("0°", cx, 14); vctx.fillText("180°", cx, PPI_SIZE - 4);
        vctx.fillText("90°", PPI_SIZE - 8, cy + 4); vctx.fillText("270°", 12, cy + 4);
      }

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [scanning, scanSpeed]);

  // PPI mouse handlers for dragging targets
  const canvasToPolar = (clientX: number, clientY: number) => {
    const canvas = ppiRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = (clientX - rect.left) / rect.width * PPI_SIZE;
    const my = (clientY - rect.top) / rect.height * PPI_SIZE;
    const cx = PPI_SIZE / 2, cy = PPI_SIZE / 2, r = PPI_SIZE / 2 - 20;
    const dx = mx - cx, dy = my - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > r) return null;
    const maxRange = sweepResult?.range_max || 50000;
    const angle = ((Math.atan2(dy, dx) + Math.PI / 2) * 180 / Math.PI + 360) % 360;
    return { angle, distance: dist / r * maxRange, screenDist: dist };
  };

  const handlePPIMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = ppiRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width * PPI_SIZE;
    const my = (e.clientY - rect.top) / rect.height * PPI_SIZE;
    const cx = PPI_SIZE / 2, cy = PPI_SIZE / 2, r = PPI_SIZE / 2 - 20;
    const maxRange = sweepResult?.range_max || 50000;

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const a = t.angle * Math.PI / 180 - Math.PI / 2;
      const d = t.distance / maxRange * r;
      const px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d;
      const sz = Math.max(4, t.size / 5) + 8;
      if (Math.sqrt((mx - px) ** 2 + (my - py) ** 2) < sz) {
        draggingTargetRef.current = i;
        e.preventDefault();
        return;
      }
    }
  };

  const handlePPIMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (draggingTargetRef.current === null) return;
    const polar = canvasToPolar(e.clientX, e.clientY);
    if (!polar) return;
    const i = draggingTargetRef.current;
    setTargets(prev => prev.map((t, idx) => idx === i
      ? { ...t, angle: Math.round(polar.angle), distance: Math.round(polar.distance) }
      : t
    ));
  };

  const handlePPIMouseUp = () => {
    if (draggingTargetRef.current !== null) {
      draggingTargetRef.current = null;
      runSweep();
    }
  };

  const handlePPIClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (draggingTargetRef.current !== null) return;
    const polar = canvasToPolar(e.clientX, e.clientY);
    if (!polar) return;
    if (targets.length < MAX_TARGETS) {
      setTargets(prev => [...prev, { id: prev.length, distance: Math.round(polar.distance), angle: Math.round(polar.angle), size: 20 }]);
    }
  };

  const addTarget = () => {
    if (targets.length >= MAX_TARGETS) return;
    setTargets(prev => [...prev, { id: prev.length, distance: 20000, angle: Math.random() * 360, size: 20 }]);
  };

  const removeTarget = (i: number) => {
    setTargets(prev => prev.filter((_, idx) => idx !== i).map((t, idx) => ({ ...t, id: idx })));
    if (editTarget === i) setEditTarget(null);
  };

  const updateTarget = (i: number, key: keyof Target, val: number) => {
    setTargets(prev => prev.map((t, idx) => idx === i ? { ...t, [key]: val } : t));
  };

  return (
    <div className="mx-auto max-w-screen-2xl p-4">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-text-primary">Radar Simulator</h1>
        <p className="text-sm text-text-secondary">360° phased-array sweep — click PPI to place targets · drag targets to reposition</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* PPI */}
        <div className="rounded-lg border border-border bg-bg-surface p-4">
          <canvas
            ref={ppiRef}
            className="mx-auto rounded-full border border-border cursor-crosshair"
            style={{ width: PPI_SIZE, height: PPI_SIZE }}
            onClick={handlePPIClick}
            onMouseDown={handlePPIMouseDown}
            onMouseMove={handlePPIMouseMove}
            onMouseUp={handlePPIMouseUp}
            onMouseLeave={handlePPIMouseUp}
          />
          <div className="mt-3 flex items-center justify-center gap-4">
            <button onClick={() => setScanning(!scanning)} className={`rounded px-4 py-1.5 text-sm font-medium ${scanning ? "bg-accent-red text-white" : "bg-accent-amber text-black"}`}>
              {scanning ? "Stop Scan" : "Start Scan"}
            </button>
            <button onClick={runSweep} disabled={loading} className="rounded border border-border px-4 py-1.5 text-sm text-text-secondary hover:text-text-primary disabled:opacity-50">
              {loading ? "Computing…" : "Full Sweep"}
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-3">
          {/* Scan params */}
          <div className="rounded-lg border border-accent-amber/30 bg-bg-surface p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-accent-amber">Scan Parameters</h3>
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs"><span className="text-text-secondary">Beam Width</span><span className="font-mono text-accent-amber">{beamWidth}°</span></div>
              <input type="range" min={1} max={90} value={beamWidth} onChange={e => setBeamWidth(Number(e.target.value))} />
              <p className="text-[10px] text-text-muted">{beamWidth > 20 ? "Wide beam → fast scan, low size accuracy" : beamWidth < 5 ? "Narrow beam → slow scan, high size accuracy" : "Balanced scan"}</p>
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs"><span className="text-text-secondary">Scan Speed</span><span className="font-mono text-accent-amber">{scanSpeed} RPM</span></div>
              <input type="range" min={1} max={120} value={scanSpeed} onChange={e => setScanSpeed(Number(e.target.value))} />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs"><span className="text-text-secondary">Elements</span><span className="font-mono text-accent-amber">{numElements}</span></div>
              <input type="range" min={4} max={128} value={numElements} onChange={e => setNumElements(Number(e.target.value))} />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs"><span className="text-text-secondary">SNR</span><span className="font-mono text-accent-amber">{snr}</span></div>
              <input type="range" min={0} max={1000} value={snr} onChange={e => setSnr(Number(e.target.value))} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-secondary">Window</span>
              <select value={windowType} onChange={e => setWindowType(e.target.value)} className="rounded border border-border bg-bg-elevated px-2 py-1.5 text-sm text-text-primary outline-none">
                <option value="rectangular">Rectangular</option>
                <option value="hamming">Hamming</option>
                <option value="hanning">Hanning</option>
                <option value="blackman">Blackman</option>
              </select>
            </div>
          </div>

          {/* Target manager */}
          <div className="rounded-lg border border-border bg-bg-surface p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Targets ({targets.length}/{MAX_TARGETS})</h3>
              <button onClick={addTarget} disabled={targets.length >= MAX_TARGETS} className="rounded bg-bg-elevated px-2 py-0.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-30">+ Add</button>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {targets.map((t, i) => (
                <div key={i} className={`rounded border p-2 text-xs transition-colors cursor-pointer ${editTarget === i ? "border-accent-amber bg-bg-elevated" : "border-border"}`} onClick={() => setEditTarget(editTarget === i ? null : i)}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-text-primary">Target {i + 1}</span>
                    <button onClick={(e) => { e.stopPropagation(); removeTarget(i); }} className="text-accent-red hover:text-red-400">×</button>
                  </div>
                  {editTarget === i ? (
                    <div className="space-y-1 mt-2">
                      <div><span className="text-text-muted">Distance (m)</span>
                        <input type="number" value={t.distance} onChange={e => updateTarget(i, "distance", Number(e.target.value))} className="w-full rounded border border-border bg-bg-primary px-2 py-1 text-text-primary" /></div>
                      <div><span className="text-text-muted">Angle (°)</span>
                        <input type="number" value={t.angle} min={0} max={360} onChange={e => updateTarget(i, "angle", Number(e.target.value))} className="w-full rounded border border-border bg-bg-primary px-2 py-1 text-text-primary" /></div>
                      <div><span className="text-text-muted">Size (m)</span>
                        <input type="number" value={t.size} min={1} onChange={e => updateTarget(i, "size", Number(e.target.value))} className="w-full rounded border border-border bg-bg-primary px-2 py-1 text-text-primary" /></div>
                    </div>
                  ) : (
                    <div className="flex gap-3 text-text-muted">
                      <span>{(t.distance/1000).toFixed(1)} km</span>
                      <span>{t.angle}°</span>
                      <span>{t.size}m</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Detection log */}
          {sweepResult?.detected_targets?.length > 0 && (
            <div className="rounded-lg border border-border bg-bg-surface p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent-amber">Detections</h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-text-muted">
                    <th className="text-left py-1">ID</th>
                    <th className="text-left py-1">Range</th>
                    <th className="text-left py-1">Angle</th>
                    <th className="text-left py-1">Level</th>
                    <th className="text-left py-1">Est. Size</th>
                  </tr>
                </thead>
                <tbody>
                  {sweepResult.detected_targets.map((d: any, i: number) => (
                    <tr key={i} className="border-b border-border/40">
                      <td className="py-1 text-text-primary">T{d.target_id + 1}</td>
                      <td className="py-1 text-text-secondary">{(d.distance/1000).toFixed(1)} km</td>
                      <td className="py-1 text-text-secondary">{d.angle}°</td>
                      <td className="py-1 font-mono text-accent-amber">{d.signal_level.toFixed(1)} dB</td>
                      <td className="py-1 font-mono text-accent-teal">{d.estimated_size != null ? `${d.estimated_size} m` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[10px] text-text-muted italic">
                * Narrower beam width → more accurate size estimation
              </p>
              <p className="mt-1 text-[10px] text-text-muted">Sweep: {sweepResult.num_steps} steps, {sweepResult.scan_time_seconds}s</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
