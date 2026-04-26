"use client";

import {
  useState, useEffect, useRef, useCallback, useMemo
} from "react";
import {
  getPhantom, aModeScan, bModeSweep, dopplerScan,
  updateTissue, updateGeometry, updateVessel,
  defaultUSBeamParams, type USBeamParams,
} from "@/lib/api";
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

// ── Constants ────────────────────────────────────────────────────────────────
const PH_SIZE        = 380;
const OUTER_A        = 0.69;
const OUTER_B        = 0.92;
const MAX_DOPPLER_HIST = 80;

// Impedance palette — maps Z [MRayl] to a CSS colour (cold=fluid, warm=hard)
function zToColor(z: number, alpha = 1): string {
  // Range: ~1.48 (water) to ~7.8 (bone)
  const t = Math.min(1, Math.max(0, (z - 1.4) / 6.5));
  // cool blue → cyan → yellow → hot orange
  const r = Math.round(30  + t * 225);
  const g = Math.round(140 - t * 60);
  const b = Math.round(230 - t * 200);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Phantom Canvas ────────────────────────────────────────────────────────────
function drawPhantom(
  canvas: HTMLCanvasElement,
  phantom: any,
  probePos: { x: number; y: number },
  beamAngle: number,
  hovered: any,
  selected: any,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width  = PH_SIZE;
  canvas.height = PH_SIZE;

  // Background
  ctx.fillStyle = "#0e1117";
  ctx.fillRect(0, 0, PH_SIZE, PH_SIZE);

  // Helper: phantom coords → canvas pixels
  const toCanvas = (px: number, py: number) => ({
    cx: ((px + 1) / 2) * PH_SIZE,
    cy: ((py + 1) / 2) * PH_SIZE,
  });

  // Draw ellipses: outermost first (id=0), innermost last
  if (phantom?.ellipses) {
    const sorted = [...phantom.ellipses].sort((a: any, b: any) => a.id - b.id);
    for (const el of sorted) {
      const { cx, cy } = toCanvas(el.center_x, el.center_y);
      const ax = (el.semi_a / 2) * PH_SIZE;
      const ay = (el.semi_b / 2) * PH_SIZE;
      const rot = (el.theta_deg * Math.PI) / 180;
      const Z   = el.impedance;
      const isHovered   = hovered?.id === el.id;
      const isSelected  = selected?.id === el.id;
      const isVessel    = el.id === 10;

      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy, ax, ay, rot, 0, Math.PI * 2);

      const fillColor = zToColor(Z, 0.28);
      ctx.fillStyle = isVessel ? "rgba(220,50,50,0.3)" : fillColor;
      ctx.fill();

      ctx.strokeStyle = isSelected  ? "#f0c040"
                      : isHovered   ? "#ffffffcc"
                      : isVessel    ? "#ef4444"
                      : zToColor(Z, 0.85);
      ctx.lineWidth = isSelected || isHovered ? 2.5 : 1.5;
      ctx.stroke();
      ctx.restore();

      // Velocity arrow for vessel
      if (isVessel && (el.vx !== 0 || el.vy !== 0)) {
        const speed = Math.sqrt(el.vx ** 2 + el.vy ** 2);
        const arrowLen = Math.min(50, speed * 60);
        const adir = Math.atan2(el.vy, el.vx);
        ctx.save();
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(adir) * arrowLen, cy + Math.sin(adir) * arrowLen);
        ctx.stroke();
        // Arrowhead
        const hx = cx + Math.cos(adir) * arrowLen;
        const hy = cy + Math.sin(adir) * arrowLen;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx - 8 * Math.cos(adir - 0.4), hy - 8 * Math.sin(adir - 0.4));
        ctx.lineTo(hx - 8 * Math.cos(adir + 0.4), hy - 8 * Math.sin(adir + 0.4));
        ctx.closePath();
        ctx.fillStyle = "#ef4444";
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = "#ef4444";
        ctx.font = "9px monospace";
        ctx.fillText(`v=${speed.toFixed(2)} m/s`, cx + arrowLen * 0.4, cy - 5);
      }
    }
  }

  // Probe
  const { cx: px, cy: py } = toCanvas(probePos.x, probePos.y);

  // Beam ray
  const bRad = (beamAngle * Math.PI) / 180;
  const rayLen = 280;
  const rx = px + Math.sin(bRad) * rayLen;
  const ry = py - Math.cos(bRad) * rayLen;

  // Beam gradient
  const grad = ctx.createLinearGradient(px, py, rx, ry);
  grad.addColorStop(0,   "rgba(100,180,255,0.7)");
  grad.addColorStop(0.4, "rgba(100,180,255,0.25)");
  grad.addColorStop(1,   "rgba(100,180,255,0)");
  ctx.save();
  ctx.strokeStyle = grad;
  ctx.lineWidth   = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(rx, ry);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Probe dot
  ctx.save();
  ctx.beginPath();
  ctx.arc(px, py, 7, 0, Math.PI * 2);
  ctx.fillStyle = "#3b82f6";
  ctx.fill();
  ctx.strokeStyle = "#93c5fd";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // Probe ring (sonar ripple)
  ctx.save();
  ctx.beginPath();
  ctx.arc(px, py, 15, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(59,130,246,0.35)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function UltrasoundPage() {
  // ── State ──────────────────────────────────────────────────────────────
  const [phantom,  setPhantom]  = useState<any>(null);
  const [probePos, setProbePos] = useState({ x: 0.0, y: -0.95 });
  const [beamAngle, setBeamAngle] = useState(0);
  const [activeTab, setActiveTab] = useState<"a" | "b" | "doppler">("a");

  // Hover / edit
  const [hovered,   setHovered]   = useState<any>(null);
  const [selected,  setSelected]  = useState<any>(null);
  const [editModal, setEditModal] = useState<any>(null);

  // A-mode
  const [aMode,   setAMode]   = useState<any>(null);
  const [aLoading, setALoading] = useState(false);

  // B-mode
  const [bMode,    setBMode]    = useState<any>(null);
  const [bLoading, setBLoading] = useState(false);

  // Doppler
  const [doppler,    setDoppler]    = useState<any>(null);
  const [dLoading,   setDLoading]   = useState(false);
  const [vesselVx,   setVesselVx]   = useState(0.3);
  const [vesselVy,   setVesselVy]   = useState(0.0);
  const [vesselDir,  setVesselDir]  = useState(0.0);    // direction angle [deg]
  const [vesselSpd,  setVesselSpd]  = useState(0.3);    // speed [m/s]
  const dopplerHistRef = useRef<number[][]>([]);

  // Beam params
  const [freq, setFreq] = useState(5e6);
  const [snr,  setSnr]  = useState(200);

  // Refs
  const phantomRef = useRef<HTMLCanvasElement>(null);
  const bRef       = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef<"probe" | "vessel" | null>(null);

  // Computed beam params
  const beamParams: USBeamParams = useMemo(() => ({
    ...defaultUSBeamParams, frequency: freq, snr,
  }), [freq, snr]);

  // Decomposed vessel velocity
  const vx = useMemo(() => vesselSpd * Math.cos((vesselDir * Math.PI) / 180), [vesselSpd, vesselDir]);
  const vy = useMemo(() => vesselSpd * Math.sin((vesselDir * Math.PI) / 180), [vesselSpd, vesselDir]);

  // ── Load phantom on mount ──────────────────────────────────────────────
  useEffect(() => {
    getPhantom().then(setPhantom).catch(console.error);
  }, []);

  // ── Redraw phantom canvas ──────────────────────────────────────────────
  useEffect(() => {
    if (!phantomRef.current || !phantom) return;
    drawPhantom(phantomRef.current, phantom, probePos, beamAngle, hovered, selected);
  }, [phantom, probePos, beamAngle, hovered, selected]);

  // ── A-Mode ────────────────────────────────────────────────────────────
  const runAScan = useCallback(async () => {
    setALoading(true);
    try {
      const d = await aModeScan({
        probe_x: probePos.x, probe_y: probePos.y,
        beam_angle: beamAngle, beam_params: beamParams,
      });
      setAMode(d);
    } catch (e) { console.error(e); }
    finally { setALoading(false); }
  }, [probePos, beamAngle, beamParams]);

  useEffect(() => {
    if (activeTab === "a") runAScan();
  }, [activeTab, runAScan]);

  // ── B-Mode ────────────────────────────────────────────────────────────
  const runBSweep = useCallback(async () => {
    setBLoading(true);
    try {
      const d = await bModeSweep({
        probe_x: probePos.x, probe_y: probePos.y,
        sweep_start_angle: -40, sweep_end_angle: 40,
        num_scanlines: 128, beam_params: beamParams,
      });
      setBMode(d);
    } catch (e) { console.error(e); }
    finally { setBLoading(false); }
  }, [probePos, beamParams]);

  // Draw B-mode image to canvas
  useEffect(() => {
    if (!bMode?.image?.length || !bRef.current) return;
    const canvas = bRef.current;
    const ctx    = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.clientWidth  || 500;
    const H = canvas.clientHeight || 320;
    canvas.width  = W;
    canvas.height = H;

    const img      = bMode.image as number[][];
    const nLines   = img.length;
    const nSamples = img[0]?.length ?? 0;
    if (!nSamples) return;

    const id = ctx.createImageData(W, H);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const si  = Math.floor((x / W) * nLines);
        const di  = Math.floor((y / H) * nSamples);
        const raw = Math.min(1, Math.max(0, img[si]?.[di] ?? 0));
        // Grayscale with mild teal tint for aesthetics
        const v   = Math.round(raw * 255);
        const idx = (y * W + x) * 4;
        id.data[idx]     = Math.round(v * 0.85);
        id.data[idx + 1] = v;
        id.data[idx + 2] = Math.round(v * 0.9);
        id.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(id, 0, 0);

    // Overlay labels
    ctx.fillStyle = "rgba(100,180,255,0.55)";
    ctx.font      = "10px monospace";
    ctx.fillText(`B-Mode — ${nLines} scanlines × ${nSamples} samples`, 6, 14);
  }, [bMode]);

  // ── Doppler ───────────────────────────────────────────────────────────
  const runDoppler = useCallback(async () => {
    setDLoading(true);
    try {
      const d = await dopplerScan({
        probe_x: probePos.x, probe_y: probePos.y,
        beam_angle: beamAngle, vx, vy, beam_params: beamParams,
      });
      setDoppler(d);
      const mags: number[] = d.spectrum?.magnitudes ?? [];
      dopplerHistRef.current.push(mags);
      if (dopplerHistRef.current.length > MAX_DOPPLER_HIST)
        dopplerHistRef.current.shift();
    } catch (e) { console.error(e); }
    finally { setDLoading(false); }
  }, [probePos, beamAngle, vx, vy, beamParams]);

  useEffect(() => {
    if (activeTab === "doppler") runDoppler();
  }, [activeTab, runDoppler]);

  // ── Phantom interaction ───────────────────────────────────────────────
  const clampToOuter = (mx: number, my: number) => {
    const d = Math.sqrt((mx / OUTER_A) ** 2 + (my / OUTER_B) ** 2);
    if (d === 0) return { x: 0, y: -OUTER_B };
    return {
      x: parseFloat((mx / d * OUTER_A / OUTER_A).toFixed(3)),
      y: parseFloat((my / d * OUTER_B / OUTER_B).toFixed(3)),
    };
  };

  const phantomCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    return {
      mx: ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      my: ((e.clientY - rect.top)  / rect.height) * 2 - 1,
    };
  };

  const findEllipse = useCallback((mx: number, my: number) => {
    if (!phantom?.ellipses) return null;
    let found: any = null;
    for (const el of phantom.ellipses) {
      const t = (el.theta_deg * Math.PI) / 180;
      const ct = Math.cos(t), st = Math.sin(t);
      const xr =  ct * (mx - el.center_x) + st * (my - el.center_y);
      const yr = -st * (mx - el.center_x) + ct * (my - el.center_y);
      if ((xr / el.semi_a) ** 2 + (yr / el.semi_b) ** 2 <= 1) found = el;
    }
    return found;
  }, [phantom]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { mx, my } = phantomCoords(e);
    const vessel = phantom?.ellipses?.find((el: any) => el.id === 10);
    if (vessel) {
      const d = Math.sqrt((mx - vessel.center_x) ** 2 + (my - vessel.center_y) ** 2);
      if (d < 0.15) { draggingRef.current = "vessel"; return; }
    }
    const dist = Math.sqrt((mx / OUTER_A) ** 2 + (my / OUTER_B) ** 2);
    if (dist > 0.75 && dist < 1.5) draggingRef.current = "probe";
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { mx, my } = phantomCoords(e);
    setHovered(findEllipse(mx, my));
    if (draggingRef.current === "vessel") {
      setPhantom((p: any) => ({
        ...p,
        ellipses: p.ellipses.map((el: any) =>
          el.id === 10 ? { ...el, center_x: parseFloat(mx.toFixed(3)), center_y: parseFloat(my.toFixed(3)) } : el
        ),
      }));
    } else if (draggingRef.current === "probe") {
      setProbePos(clampToOuter(mx, my));
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pressed = draggingRef.current;
    draggingRef.current = null;
    if (pressed === "vessel") {
      const { mx, my } = phantomCoords(e);
      updateVessel({ center_x: parseFloat(mx.toFixed(3)), center_y: parseFloat(my.toFixed(3)) })
        .catch(console.error);
    }
    if (activeTab === "a") runAScan();
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (draggingRef.current) return;
    const { mx, my } = phantomCoords(e);
    const el = findEllipse(mx, my);
    if (el) { setSelected(el); setEditModal({ ...el }); }
  };

  // ── Tissue save ───────────────────────────────────────────────────────
  const handleSaveTissue = async () => {
    if (!editModal) return;
    await updateTissue({
      ellipse_id: editModal.id,
      speed: editModal.speed,
      density: editModal.density,
      attenuation: editModal.attenuation,
      tissue_name: editModal.tissue_name,
    });
    const p = await getPhantom(); setPhantom(p);
    setSelected(null); setEditModal(null);
    if (activeTab === "a") runAScan();
  };

  // ── Vessel velocity apply ──────────────────────────────────────────────
  const applyVesselVelocity = async () => {
    await updateVessel({ vx, vy });
    const p = await getPhantom(); setPhantom(p);
    if (activeTab === "doppler") runDoppler();
  };

  // ── Doppler A-mode chart data ─────────────────────────────────────────
  const dopplerChartData = useMemo(() => {
    if (!doppler?.spectrum) return [];
    return doppler.spectrum.frequencies.map((f: number, i: number) => ({
      freq: parseFloat((f).toFixed(1)),
      vel:  parseFloat((doppler.spectrum.velocities[i] * 100).toFixed(2)),
      mag:  parseFloat((doppler.spectrum.magnitudes[i]).toFixed(4)),
    }));
  }, [doppler]);

  const aModeChartData = useMemo(() => {
    if (!aMode) return [];
    return aMode.depths.map((d: number, i: number) => ({
      depth: parseFloat((d * 100).toFixed(2)),
      amp:   parseFloat((Math.abs(aMode.amplitudes[i])).toFixed(4)),
    }));
  }, [aMode]);

  const isPerp = doppler && Math.abs(doppler.insonation_angle_deg - 90) < 5;

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-4 space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary tracking-tight">Ultrasound Simulator</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Modified Shepp–Logan Phantom · A-Mode / B-Mode / Doppler · Physically accurate ray-tracing
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[400px_1fr]">
        {/* ── Left Panel ──────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          {/* Phantom canvas */}
          <div className="rounded-xl border border-border bg-bg-surface p-3">
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-text-muted">
              Phantom — drag probe on edge · drag vessel · click to edit
            </h3>
            <canvas
              ref={phantomRef}
              className="w-full rounded-lg border border-border cursor-crosshair"
              style={{ aspectRatio: "1" }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={() => { draggingRef.current = null; setHovered(null); }}
              onClick={handleClick}
            />

            {/* Impedance legend */}
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[9px] text-text-muted">Z (MRayl):</span>
              <div className="flex-1 h-2 rounded" style={{
                background: "linear-gradient(to right,rgba(30,140,230,0.9),rgba(100,220,200,0.9),rgba(255,200,50,0.9),rgba(255,100,30,0.9))"
              }} />
              <span className="text-[9px] text-text-muted">1.5 → 7.8</span>
            </div>

            {/* Tooltip on hover */}
            {hovered && (
              <div className="mt-2 rounded-lg border border-border bg-bg-elevated p-2 text-[11px] animate-fade-in space-y-0.5">
                <p className="font-semibold" style={{ color: zToColor(hovered.impedance, 1) }}>
                  #{hovered.id} {hovered.name} — <span className="text-text-secondary">{hovered.tissue_name}</span>
                </p>
                <div className="grid grid-cols-2 gap-x-3 text-text-muted">
                  <span>c = {hovered.speed} m/s</span>
                  <span>ρ = {hovered.density} kg/m³</span>
                  <span>Z = {hovered.impedance?.toFixed(3)} MRayl</span>
                  <span>α = {hovered.attenuation} dB/cm/MHz</span>
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="rounded-xl border border-border bg-bg-surface p-3 space-y-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-text-secondary">Beam angle: <span className="text-text-primary font-mono">{beamAngle}°</span></label>
              <input type="range" min={-90} max={90} value={beamAngle}
                onChange={e => setBeamAngle(Number(e.target.value))} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-text-secondary">Frequency: <span className="text-text-primary font-mono">{(freq/1e6).toFixed(1)} MHz</span></label>
              <input type="range" min={1e6} max={15e6} step={0.5e6} value={freq}
                onChange={e => setFreq(Number(e.target.value))} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-text-secondary">SNR: <span className="text-text-primary font-mono">{snr}</span></label>
              <input type="range" min={0} max={1000} step={5} value={snr}
                onChange={e => setSnr(Number(e.target.value))} />
            </div>

            {/* Scan trigger buttons */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={runAScan}
                disabled={aLoading}
                className="rounded-lg border border-border bg-bg-elevated px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-accent-blue hover:border-accent-blue transition-colors disabled:opacity-50"
              >
                {aLoading ? "Scanning…" : "▶ A-Scan"}
              </button>
              <button
                onClick={runBSweep}
                disabled={bLoading}
                className="rounded-lg border border-border bg-bg-elevated px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-accent-teal hover:border-accent-teal transition-colors disabled:opacity-50"
              >
                {bLoading ? "Sweeping…" : "▶ B-Sweep"}
              </button>
            </div>

            {/* Blood vessel velocity */}
            <div className="border-t border-border pt-2 space-y-2">
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-accent-red">
                Blood Vessel (id=10)
              </h4>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-text-secondary">Flow direction: <span className="font-mono text-text-primary">{vesselDir.toFixed(0)}°</span></label>
                <input type="range" min={0} max={360} value={vesselDir}
                  onChange={e => setVesselDir(Number(e.target.value))} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-text-secondary">Flow speed: <span className="font-mono text-text-primary">{vesselSpd.toFixed(2)} m/s</span></label>
                <input type="range" min={-3} max={3} step={0.05} value={vesselSpd}
                  onChange={e => setVesselSpd(Number(e.target.value))} />
              </div>
              <div className="text-[9px] text-text-muted font-mono">
                vx={vx.toFixed(3)} m/s &nbsp; vy={vy.toFixed(3)} m/s
              </div>
              <button
                onClick={applyVesselVelocity}
                className="w-full rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-1.5 text-xs font-medium text-accent-red hover:bg-accent-red/20 transition-colors"
              >
                Apply velocity → Doppler
              </button>
            </div>
          </div>
        </div>

        {/* ── Right Panel ──────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          {/* Tab bar */}
          <div className="flex gap-1 rounded-xl border border-border bg-bg-surface p-1">
            {(["a", "b", "doppler"] as const).map(t => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                  activeTab === t
                    ? "bg-bg-elevated text-text-primary shadow-sm"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                {t === "a" ? "A-Mode" : t === "b" ? "B-Mode" : "Doppler"}
              </button>
            ))}
          </div>

          {/* ── A-Mode ──────────────────────────────────────────────── */}
          {activeTab === "a" && (
            <div className="flex flex-col gap-3">
              <div className="rounded-xl border border-border bg-bg-surface p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    A-Mode — Amplitude vs Apparent Depth
                  </span>
                  {aLoading && <span className="text-[10px] text-text-muted animate-pulse">computing…</span>}
                </div>
                <div className="h-[240px] rounded-lg bg-[#0e1117] px-2 pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={aModeChartData}>
                      <defs>
                        <linearGradient id="aGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#6b8cbe" stopOpacity={0.5} />
                          <stop offset="95%" stopColor="#6b8cbe" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e2230" />
                      <XAxis dataKey="depth" stroke="#555968" tick={{ fill: "#555968", fontSize: 9 }}
                        label={{ value: "Apparent depth (cm)", fill: "#555968", fontSize: 9, position: "insideBottomRight", offset: -4 }} />
                      <YAxis stroke="#555968" tick={{ fill: "#555968", fontSize: 9 }} domain={[0, 1]} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#191c24", borderColor: "#2a2f3b", fontSize: 11 }}
                        itemStyle={{ color: "#6b8cbe" }}
                        formatter={(v: number) => [v.toFixed(4), "Amplitude"]}
                        labelFormatter={(l: number) => `Depth: ${l} cm`}
                      />
                      {/* Boundary markers */}
                      {aMode?.intersections?.map((isect: any, i: number) => (
                        <ReferenceLine
                          key={i}
                          x={parseFloat(((isect.depth) * 100).toFixed(2))}
                          stroke="#c0635f44"
                          strokeDasharray="3 2"
                          strokeWidth={1}
                        />
                      ))}
                      <Area type="monotone" dataKey="amp" stroke="#6b8cbe" fill="url(#aGrad)"
                        dot={false} strokeWidth={1.5} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Tissue boundary table */}
              {aMode?.intersections?.length > 0 && (
                <div className="rounded-xl border border-border bg-bg-surface p-3">
                  <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    Tissue Boundaries
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[10px]">
                      <thead>
                        <tr className="text-text-muted border-b border-border">
                          <th className="text-left py-1 pr-3">Depth</th>
                          <th className="text-left py-1 pr-3">Interface</th>
                          <th className="text-right py-1 pr-3">Z₁ → Z₂ (MRayl)</th>
                          <th className="text-right py-1">|R|</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aMode.intersections.map((isect: any, i: number) => (
                          <tr key={i} className="border-b border-border/30 hover:bg-bg-elevated transition-colors">
                            <td className="py-1 pr-3 font-mono text-accent-blue">
                              {(isect.depth * 100).toFixed(2)} cm
                            </td>
                            <td className="py-1 pr-3 text-text-secondary">
                              {isect.tissue_before} → {isect.tissue_after}
                            </td>
                            <td className="py-1 pr-3 text-right font-mono text-text-muted">
                              {isect.impedance_before.toFixed(2)} → {isect.impedance_after.toFixed(2)}
                            </td>
                            <td className="py-1 text-right font-mono"
                              style={{ color: isect.reflection_coeff > 0.3 ? "#c0635f" : "#6da87a" }}>
                              {isect.reflection_coeff.toFixed(4)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── B-Mode ──────────────────────────────────────────────── */}
          {activeTab === "b" && (
            <div className="rounded-xl border border-border bg-bg-surface p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    B-Mode — 2D Spatial Map
                  </span>
                  {bMode && (
                    <span className="ml-2 text-[9px] text-text-muted">
                      ({bMode.num_scanlines} × {bMode.num_samples} px)
                    </span>
                  )}
                </div>
                <div className="flex gap-2 items-center">
                  {bLoading && <span className="text-[10px] text-text-muted animate-pulse">sweeping…</span>}
                  <button
                    onClick={runBSweep}
                    disabled={bLoading}
                    className="rounded-lg border border-accent-teal/50 bg-accent-teal/10 px-3 py-1.5 text-xs font-medium text-accent-teal hover:bg-accent-teal/20 transition-colors disabled:opacity-40"
                  >
                    {bLoading ? "Running…" : "▶ Run Sweep"}
                  </button>
                  <button
                    onClick={() => setBMode(null)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:text-accent-red hover:border-accent-red transition-colors"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="rounded-lg overflow-hidden border border-border bg-[#0e1117]" style={{ height: 360 }}>
                {bMode ? (
                  <canvas ref={bRef} className="w-full h-full" />
                ) : (
                  <div className="flex items-center justify-center h-full text-text-muted text-sm">
                    Click "Run Sweep" to generate B-Mode image
                  </div>
                )}
              </div>
              {bMode && (
                <p className="mt-2 text-[9px] text-text-muted">
                  Sweep: {bMode.angles?.[0]?.toFixed(1)}° → {bMode.angles?.at(-1)?.toFixed(1)}° from probe at
                  ({bMode.probe_x?.toFixed(3)}, {bMode.probe_y?.toFixed(3)})
                </p>
              )}
            </div>
          )}

          {/* ── Doppler ──────────────────────────────────────────────── */}
          {activeTab === "doppler" && (
            <div className="flex flex-col gap-3">
              {isPerp && (
                <div className="rounded-xl border border-accent-amber/50 bg-accent-amber/10 px-4 py-2.5 flex items-center gap-2">
                  <span className="text-accent-amber text-lg">⚠</span>
                  <div>
                    <p className="text-xs font-semibold text-accent-amber">Perpendicular Beam — Zero Doppler Shift</p>
                    <p className="text-[10px] text-text-muted mt-0.5">
                      Beam angle is ~90° to flow direction. cos(θ) ≈ 0 → Δf = 0 Hz regardless of blood speed.
                      This is the most common clinical error in real ultrasound.
                    </p>
                  </div>
                </div>
              )}

              {/* Metric cards */}
              {doppler && (
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: "Doppler Shift", value: `${doppler.doppler_shift_hz.toFixed(0)} Hz`, color: "#c0635f" },
                    { label: "Velocity",      value: `${(doppler.estimated_velocity_ms * 100).toFixed(1)} cm/s`, color: "#6b8cbe" },
                    { label: "Angle θ",       value: `${doppler.insonation_angle_deg.toFixed(1)}°`, color: "#6ea8a0" },
                    { label: "cos(θ)",        value: doppler.cos_theta?.toFixed(3) ?? "—", color: "#9480b3" },
                  ].map(m => (
                    <div key={m.label} className="rounded-xl border border-border bg-bg-elevated p-2.5 text-center">
                      <p className="text-[9px] text-text-muted mb-1">{m.label}</p>
                      <p className="text-base font-mono font-bold" style={{ color: m.color }}>{m.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Spectrum plot */}
              <div className="rounded-xl border border-border bg-bg-surface p-4">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                  Doppler Spectrum
                </span>
                <div className="h-[180px] rounded-lg bg-[#0e1117] mt-2 px-2 pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dopplerChartData}>
                      <defs>
                        <linearGradient id="dGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#c0635f" stopOpacity={0.55} />
                          <stop offset="95%" stopColor="#c0635f" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e2230" />
                      <XAxis dataKey="freq" stroke="#555968" tick={{ fill:"#555968", fontSize:9 }}
                        label={{ value:"Freq (Hz)", fill:"#555968", fontSize:9, position:"insideBottomRight", offset:-4 }} />
                      <YAxis stroke="#555968" tick={{ fill:"#555968", fontSize:9 }} domain={[0,1]} />
                      <Tooltip
                        contentStyle={{ backgroundColor:"#191c24", borderColor:"#2a2f3b", fontSize:11 }}
                        formatter={(v: number, n: string) => [v.toFixed(4), n === "mag" ? "Magnitude" : n]}
                        labelFormatter={(l: number) => `f = ${(+l).toFixed(0)} Hz`}
                      />
                      <ReferenceLine x={0} stroke="#555968" strokeDasharray="4 2" />
                      <Area type="monotone" dataKey="mag" stroke="#c0635f" fill="url(#dGrad)"
                        dot={false} strokeWidth={1.5} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {doppler && (
                <div className="rounded-xl border border-border bg-bg-surface p-3">
                  <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Physics Summary</h3>
                  <div className="text-[10px] text-text-muted font-mono space-y-0.5">
                    <p>Δf = 2 · f₀ · v · cos(θ) / c</p>
                    <p>   = 2 · {(freq/1e6).toFixed(1)}MHz · {(Math.abs(doppler.estimated_velocity_ms)*100).toFixed(1)}cm/s · {doppler.cos_theta?.toFixed(3)} / 1540 m/s</p>
                    <p className="text-accent-red">   = {doppler.doppler_shift_hz.toFixed(1)} Hz ({doppler.flow_direction})</p>
                  </div>
                </div>
              )}

              <button
                onClick={runDoppler}
                disabled={dLoading}
                className="rounded-xl border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-xs font-medium text-accent-red hover:bg-accent-red/20 transition-colors disabled:opacity-40"
              >
                {dLoading ? "Computing…" : "▶ Refresh Doppler"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Edit Modal ──────────────────────────────────────────────────── */}
      {editModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => { setEditModal(null); setSelected(null); }}
        >
          <div
            className="w-[440px] rounded-2xl border border-border bg-bg-surface p-6 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-text-primary">
                Edit Ellipse #{editModal.id} — {editModal.name}
              </h3>
              <span className="text-[10px] font-mono rounded px-2 py-0.5 bg-bg-elevated text-text-muted"
                style={{ color: zToColor(editModal.impedance, 1) }}>
                Z = {((editModal.density * editModal.speed) / 1e6).toFixed(3)} MRayl
              </span>
            </div>

            <div className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Acoustic Properties</p>
              {[
                { k: "tissue_name", l: "Tissue Name",           type: "text"   },
                { k: "speed",       l: "Speed of Sound (m/s)",  type: "number" },
                { k: "density",     l: "Density (kg/m³)",       type: "number" },
                { k: "attenuation", l: "Attenuation (dB/cm/MHz)", type: "number" },
              ].map(({ k, l, type }) => (
                <div key={k}>
                  <label className="text-[10px] text-text-secondary">{l}</label>
                  <input
                    type={type}
                    step={type === "number" ? "any" : undefined}
                    value={editModal[k]}
                    onChange={e => setEditModal((m: any) => ({
                      ...m, [k]: type === "number" ? Number(e.target.value) : e.target.value
                    }))}
                    className="mt-0.5 w-full rounded-lg border border-border bg-bg-elevated px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent-blue transition-colors"
                  />
                </div>
              ))}
            </div>

            <div className="mt-4 flex gap-2">
              <button onClick={handleSaveTissue}
                className="flex-1 rounded-lg bg-accent-blue px-3 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity">
                Save &amp; Recompute
              </button>
              <button onClick={() => { setEditModal(null); setSelected(null); }}
                className="flex-1 rounded-lg border border-border px-3 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
