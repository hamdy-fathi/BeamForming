"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { getPhantom, aModeScan, bModeScan, dopplerScan, updateTissue } from "@/lib/api";

const PH_SIZE = 400;
const OUTER_A = 0.69, OUTER_B = 0.92;
const DOPPLER_HISTORY = 100;

export default function UltrasoundPage() {
  const [phantom, setPhantom] = useState<any>(null);
  const [probePos, setProbePos] = useState({ x: 0, y: -0.95 });
  const [beamAngle, setBeamAngle] = useState(0);
  const [aMode, setAMode] = useState<any>(null);
  const [bMode, setBMode] = useState<any>(null);
  const [doppler, setDoppler] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"a"|"b"|"doppler">("a");
  const [hovered, setHovered] = useState<any>(null);
  const [editModal, setEditModal] = useState<any>(null);
  const [vessel, setVessel] = useState({ center_x: 0, center_y: -0.3, direction_angle: 45, diameter: 0.02, blood_velocity: 0.5 });
  const [freq, setFreq] = useState(5e6);
  const [snr, setSnr] = useState(200);

  const phantomRef = useRef<HTMLCanvasElement>(null);
  const aRef = useRef<HTMLCanvasElement>(null);
  const bRef = useRef<HTMLCanvasElement>(null);
  const dopRef = useRef<HTMLCanvasElement>(null);

  // B-mode accumulation
  const scanlinesRef = useRef<any[]>([]);
  const lastProbePosRef = useRef({ x: 0, y: -0.95 });
  const [bScanCount, setBScanCount] = useState(0);

  // Doppler waterfall
  const dopplerHistRef = useRef<number[][]>([]);

  // Drag state
  const draggingVesselRef = useRef(false);
  const draggingProbeRef = useRef(false);

  useEffect(() => { getPhantom().then(setPhantom).catch(console.error); }, []);

  // Draw phantom
  useEffect(() => {
    if (!phantom?.image || !phantomRef.current) return;
    const c = phantomRef.current, ctx = c.getContext("2d")!;
    c.width = PH_SIZE; c.height = PH_SIZE;
    const img = phantom.image, sz = img.length;
    const id = ctx.createImageData(PH_SIZE, PH_SIZE);
    let mn = Infinity, mx = -Infinity;
    for (const row of img) for (const v of row) { if (v < mn) mn = v; if (v > mx) mx = v; }
    const range = mx - mn || 1;
    for (let y = 0; y < PH_SIZE; y++) {
      for (let x = 0; x < PH_SIZE; x++) {
        const sy = Math.floor(y / PH_SIZE * sz), sx = Math.floor(x / PH_SIZE * sz);
        const v = (img[sy][sx] - mn) / range;
        const idx = (y * PH_SIZE + x) * 4;
        id.data[idx] = Math.round(v * 180 + 20);
        id.data[idx+1] = Math.round(v * 200 + 20);
        id.data[idx+2] = Math.round(v * 220 + 30);
        id.data[idx+3] = 255;
      }
    }
    ctx.putImageData(id, 0, 0);
    // probe
    const px = (probePos.x + 1) / 2 * PH_SIZE, py = (probePos.y + 1) / 2 * PH_SIZE;
    ctx.fillStyle = "#3b82f6"; ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#3b82f6cc"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, 14, 0, Math.PI * 2); ctx.stroke();
    // beam
    const bRad = beamAngle * Math.PI / 180;
    const lx = px + Math.sin(bRad) * 150, ly = py + Math.cos(bRad) * 150;
    ctx.strokeStyle = "#3b82f680"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(lx, ly); ctx.stroke();
    // vessel
    const vx = (vessel.center_x + 1) / 2 * PH_SIZE, vy = (vessel.center_y + 1) / 2 * PH_SIZE;
    ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 3;
    const vr = vessel.direction_angle * Math.PI / 180;
    ctx.beginPath();
    ctx.moveTo(vx - Math.cos(vr) * 30, vy - Math.sin(vr) * 30);
    ctx.lineTo(vx + Math.cos(vr) * 30, vy + Math.sin(vr) * 30);
    ctx.stroke();
    // vessel drag handle
    ctx.beginPath(); ctx.arc(vx, vy, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#ef444466"; ctx.fill();
    ctx.fillStyle = "#ef4444"; ctx.font = "10px monospace";
    ctx.fillText("vessel", vx + 10, vy - 10);
  }, [phantom, probePos, beamAngle, vessel]);

  const beamParams = useCallback(() => ({
    frequency: freq, num_elements: 64, element_spacing: 0.5, window_type: "hamming", snr
  }), [freq, snr]);

  const runAScan = useCallback(async () => {
    try {
      const d = await aModeScan({ probe_x: probePos.x, probe_y: probePos.y, beam_angle: beamAngle, beam_params: beamParams() });
      setAMode(d);
    } catch (e) { console.error(e); }
  }, [probePos, beamAngle, beamParams]);

  useEffect(() => { if (activeTab === "a") runAScan(); }, [activeTab, runAScan]);

  // A-mode draw
  useEffect(() => {
    if (!aMode || !aRef.current) return;
    const c = aRef.current, ctx = c.getContext("2d")!;
    const W = 500, H = 250; c.width = W; c.height = H;
    ctx.fillStyle = "#1a1d27"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#2e3348"; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const y = i * H / 4; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    const amps = aMode.amplitudes;
    ctx.beginPath(); ctx.strokeStyle = "#3b82f6"; ctx.lineWidth = 1.5;
    for (let i = 0; i < amps.length; i++) {
      const x = i / amps.length * W, y = H - (amps[i] + 1) / 2 * H;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = "#555a6e"; ctx.font = "10px monospace";
    ctx.fillText("A-Mode: Amplitude vs Depth", 4, 12);
    ctx.fillText(`Depth → ${(aMode.depths[aMode.depths.length-1]*100).toFixed(1)} cm`, W - 120, H - 4);
  }, [aMode]);

  // B-mode accumulation scan
  const runBScanAccum = useCallback(async () => {
    if (scanlinesRef.current.length === 0) return;
    try {
      const d = await bModeScan({ scanlines: scanlinesRef.current, beam_params: beamParams() });
      setBMode(d);
    } catch (e) { console.error(e); }
  }, [beamParams]);

  useEffect(() => { if (activeTab === "b") runBScanAccum(); }, [activeTab, runBScanAccum]);

  // B-mode draw
  useEffect(() => {
    if (!bMode?.image?.length || !bRef.current) return;
    const c = bRef.current, ctx = c.getContext("2d")!;
    const W = 500, H = 300; c.width = W; c.height = H;
    const img = bMode.image, nLines = img.length, nSamples = img[0].length;
    const id = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const si = Math.floor(x / W * nLines), di = Math.floor(y / H * nSamples);
        const v = Math.min(1, Math.max(0, img[si]?.[di] || 0));
        const idx = (y * W + x) * 4;
        id.data[idx] = id.data[idx+1] = id.data[idx+2] = Math.round(v * 255);
        id.data[idx+3] = 255;
      }
    }
    ctx.putImageData(id, 0, 0);
    ctx.fillStyle = "#3b82f680"; ctx.font = "10px monospace";
    ctx.fillText(`B-Mode — ${scanlinesRef.current.length} scanlines`, 4, 12);
  }, [bMode, bScanCount]);

  const runDoppler = useCallback(async () => {
    try {
      const d = await dopplerScan({ probe_x: probePos.x, probe_y: probePos.y, beam_angle: beamAngle, vessel, beam_params: beamParams() });
      setDoppler(d);
      // Waterfall update
      const mags: number[] = d.spectrum?.magnitudes || [];
      const hist = dopplerHistRef.current;
      hist.push(mags);
      if (hist.length > DOPPLER_HISTORY) hist.shift();
    } catch (e) { console.error(e); }
  }, [probePos, beamAngle, vessel, beamParams]);

  useEffect(() => { if (activeTab === "doppler") runDoppler(); }, [activeTab, runDoppler]);

  // Doppler draw — waterfall + spectrum
  useEffect(() => {
    if (!dopRef.current) return;
    const c = dopRef.current, ctx = c.getContext("2d")!;
    const W = 500, H = 300; c.width = W; c.height = H;
    ctx.fillStyle = "#1a1d27"; ctx.fillRect(0, 0, W, H);

    // Waterfall (top 180px)
    const wH = 180;
    const hist = dopplerHistRef.current;
    if (hist.length > 0) {
      const nSamples = hist[0].length;
      const id = ctx.createImageData(W, wH);
      for (let col = 0; col < W; col++) {
        const hIdx = Math.floor(col / W * hist.length);
        const column = hist[hIdx] || [];
        for (let row = 0; row < wH; row++) {
          const sIdx = Math.floor(row / wH * nSamples);
          const v = Math.min(1, Math.max(0, column[sIdx] || 0));
          const idx = (row * W + col) * 4;
          // heatmap: dark blue → cyan → white
          id.data[idx]   = Math.round(v * 200);
          id.data[idx+1] = Math.round(v * 230);
          id.data[idx+2] = Math.round(80 + v * 175);
          id.data[idx+3] = 255;
        }
      }
      ctx.putImageData(id, 0, 0);
      ctx.fillStyle = "#555a6e80"; ctx.font = "9px monospace";
      ctx.fillText("◄ time", 4, 10); ctx.fillText("freq ▼", W - 44, 10);
    }

    // Spectrum line (bottom 120px)
    if (doppler?.spectrum) {
      const { magnitudes } = doppler.spectrum;
      const sY = wH + 4;
      const sH = H - wH - 4;
      ctx.strokeStyle = "#2e3348"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, sY + sH / 2); ctx.lineTo(W, sY + sH / 2); ctx.stroke();
      ctx.beginPath(); ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 1.5;
      for (let i = 0; i < magnitudes.length; i++) {
        const x = i / magnitudes.length * W;
        const y = sY + sH - magnitudes[i] * sH * 0.85 - 4;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    if (doppler) {
      ctx.fillStyle = "#ef4444"; ctx.font = "11px monospace";
      ctx.fillText(`Δf = ${doppler.doppler_shift_hz.toFixed(0)} Hz`, 4, wH + 18);
      ctx.fillText(`v ≈ ${(doppler.estimated_velocity_ms * 100).toFixed(1)} cm/s`, 4, wH + 32);
      ctx.fillText(`Flow: ${doppler.flow_direction}`, 4, wH + 46);
    }
  }, [doppler]);

  // Phantom hover
  const handlePhantomHover = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!phantom) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const my = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    const found = [...phantom.ellipses].reverse().find((el: any) => {
      const t = el.theta_deg * Math.PI / 180, ct = Math.cos(t), st = Math.sin(t);
      const xr = ct * (mx - el.center_x) + st * (my - el.center_y);
      const yr = -st * (mx - el.center_x) + ct * (my - el.center_y);
      return (xr / el.semi_a) ** 2 + (yr / el.semi_b) ** 2 <= 1;
    });
    setHovered(found || null);
  };

  const handlePhantomClick = () => { if (hovered) setEditModal({ ...hovered }); };

  const handleSaveTissue = async () => {
    if (!editModal) return;
    await updateTissue({ ellipse_id: editModal.id, speed: editModal.speed, density: editModal.density, attenuation: editModal.attenuation, tissue_name: editModal.tissue_name });
    const p = await getPhantom(); setPhantom(p);
    setEditModal(null);
  };

  // Exact ellipse surface clamping
  const clampToEllipse = (mx: number, my: number) => {
    const distEllipse = Math.sqrt((mx / OUTER_A) ** 2 + (my / OUTER_B) ** 2);
    if (distEllipse === 0) return { x: 0, y: -OUTER_B };
    return {
      x: parseFloat((mx / distEllipse).toFixed(3)),
      y: parseFloat((my / distEllipse).toFixed(3)),
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const my = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    // Check vessel
    const vdx = mx - vessel.center_x, vdy = my - vessel.center_y;
    if (Math.sqrt(vdx * vdx + vdy * vdy) < 0.12) {
      draggingVesselRef.current = true;
      return;
    }
    // Probe drag — check if near ellipse surface
    const d = Math.sqrt((mx / OUTER_A) ** 2 + (my / OUTER_B) ** 2);
    if (d > 0.7 && d < 1.4) draggingProbeRef.current = true;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    handlePhantomHover(e);
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const my = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    if (draggingVesselRef.current) {
      setVessel(v => ({ ...v, center_x: parseFloat(mx.toFixed(3)), center_y: parseFloat(my.toFixed(3)) }));
      return;
    }
    if (draggingProbeRef.current) {
      const clamped = clampToEllipse(mx, my);
      const prev = lastProbePosRef.current;
      const dist = Math.sqrt((clamped.x - prev.x) ** 2 + (clamped.y - prev.y) ** 2);
      setProbePos(clamped);
      if (dist > 0.03 && activeTab === "b") {
        scanlinesRef.current.push({ probe_x: clamped.x, probe_y: clamped.y, beam_angle: beamAngle });
        setBScanCount(n => n + 1);
        lastProbePosRef.current = clamped;
        runBScanAccum();
      }
    }
  };

  const handleMouseUp = () => {
    draggingVesselRef.current = false;
    draggingProbeRef.current = false;
  };

  const clearBMode = () => {
    scanlinesRef.current = [];
    setBScanCount(0);
    setBMode(null);
    if (bRef.current) {
      const ctx = bRef.current.getContext("2d")!;
      ctx.fillStyle = "#1a1d27";
      ctx.fillRect(0, 0, bRef.current.width, bRef.current.height);
    }
  };

  return (
    <div className="mx-auto max-w-screen-2xl p-4">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-text-primary">Ultrasound Simulator</h1>
        <p className="text-sm text-text-secondary">Shepp–Logan phantom — A-Mode / B-Mode / Doppler</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
        {/* Phantom + Controls */}
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-border bg-bg-surface p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
              Phantom — drag probe on edge · drag vessel · click tissue to edit
            </h3>
            <canvas
              ref={phantomRef}
              className="w-full rounded border border-border cursor-crosshair"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onClick={handlePhantomClick}
              style={{ aspectRatio: "1" }}
            />
            {hovered && (
              <div className="mt-2 rounded border border-accent-blue/30 bg-bg-elevated p-2 text-xs animate-fade-in">
                <p className="font-semibold text-accent-blue">{hovered.name} — {hovered.tissue_name}</p>
                <p className="text-text-secondary">Speed: {hovered.speed} m/s | Density: {hovered.density} kg/m³</p>
                <p className="text-text-secondary">Impedance: {hovered.impedance} MRayl | Atten: {hovered.attenuation} dB/cm/MHz</p>
              </div>
            )}
          </div>
          {/* Controls */}
          <div className="rounded-lg border border-border bg-bg-surface p-3 space-y-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Beam Angle: {beamAngle}°</label>
              <input type="range" min={-90} max={90} value={beamAngle} onChange={e => setBeamAngle(Number(e.target.value))} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Frequency: {(freq/1e6).toFixed(1)} MHz</label>
              <input type="range" min={1e6} max={15e6} step={0.5e6} value={freq} onChange={e => setFreq(Number(e.target.value))} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">SNR: {snr}</label>
              <input type="range" min={0} max={1000} step={1} value={snr} onChange={e => setSnr(Number(e.target.value))} />
            </div>
            <div className="border-t border-border pt-2">
              <h4 className="text-xs font-semibold text-accent-red mb-1">Blood Vessel</h4>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-text-secondary">Direction: {vessel.direction_angle}°</label>
                <input type="range" min={0} max={360} value={vessel.direction_angle} onChange={e => setVessel(v => ({...v, direction_angle: Number(e.target.value)}))} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-text-secondary">Velocity: {vessel.blood_velocity} m/s</label>
                <input type="range" min={-5} max={5} step={0.1} value={vessel.blood_velocity} onChange={e => setVessel(v => ({...v, blood_velocity: Number(e.target.value)}))} />
              </div>
            </div>
          </div>
        </div>
        {/* Outputs */}
        <div className="flex flex-col gap-3">
          <div className="flex gap-1 rounded-lg border border-border bg-bg-surface p-1">
            {(["a","b","doppler"] as const).map(t => (
              <button key={t} onClick={() => setActiveTab(t)} className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${activeTab===t?"bg-bg-elevated text-accent-blue":"text-text-secondary hover:text-text-primary"}`}>
                {t === "a" ? "A-Mode" : t === "b" ? "B-Mode" : "Doppler"}
              </button>
            ))}
          </div>
          <div className="rounded-lg border border-border bg-bg-surface p-4">
            {activeTab === "a" && <canvas ref={aRef} className="w-full rounded border border-border" style={{height:250}} />}
            {activeTab === "b" && (
              <>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-text-muted">{bScanCount} scanlines accumulated — move probe to add</span>
                  <button onClick={clearBMode} className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:text-accent-red hover:border-accent-red transition-colors">
                    Clear B-Mode
                  </button>
                </div>
                <canvas ref={bRef} className="w-full rounded border border-border" style={{height:300}} />
              </>
            )}
            {activeTab === "doppler" && (
              <>
                <canvas ref={dopRef} className="w-full rounded border border-border" style={{height:300}} />
                {doppler && (
                  <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                    <div className="rounded border border-border bg-bg-elevated p-2 text-center">
                      <p className="text-text-muted">Doppler Shift</p>
                      <p className="text-lg font-mono text-accent-red">{doppler.doppler_shift_hz.toFixed(0)} Hz</p>
                    </div>
                    <div className="rounded border border-border bg-bg-elevated p-2 text-center">
                      <p className="text-text-muted">Velocity</p>
                      <p className="text-lg font-mono text-accent-red">{(doppler.estimated_velocity_ms*100).toFixed(1)} cm/s</p>
                    </div>
                    <div className="rounded border border-border bg-bg-elevated p-2 text-center">
                      <p className="text-text-muted">Angle</p>
                      <p className="text-lg font-mono text-accent-red">{doppler.insonation_angle_deg.toFixed(1)}°</p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          {aMode?.intersections?.length > 0 && activeTab === "a" && (
            <div className="rounded-lg border border-border bg-bg-surface p-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">Tissue Boundaries</h3>
              <div className="max-h-40 overflow-y-auto text-xs">
                {aMode.intersections.map((int: any, i: number) => (
                  <div key={i} className="flex justify-between border-b border-border/40 py-1">
                    <span className="text-text-muted">{(int.depth*100).toFixed(2)} cm</span>
                    <span className="text-text-secondary">{int.tissue_before} → {int.tissue_after}</span>
                    <span className="font-mono text-accent-blue">R={int.reflection_coeff.toFixed(4)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setEditModal(null)}>
          <div className="w-96 rounded-lg border border-border bg-bg-surface p-6" onClick={e => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-semibold text-text-primary">Edit: {editModal.name}</h3>
            <div className="space-y-3">
              {[{k:"speed",l:"Speed (m/s)"},{k:"density",l:"Density (kg/m³)"},{k:"attenuation",l:"Attenuation (dB/cm/MHz)"}].map(({k,l}) => (
                <div key={k}>
                  <label className="text-xs text-text-secondary">{l}</label>
                  <input type="number" step="any" value={editModal[k]} onChange={e => setEditModal((m:any) => ({...m,[k]:Number(e.target.value)}))} className="w-full rounded border border-border bg-bg-elevated px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent-blue" />
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={handleSaveTissue} className="flex-1 rounded bg-accent-blue px-3 py-1.5 text-sm font-medium text-white">Save</button>
              <button onClick={() => setEditModal(null)} className="flex-1 rounded border border-border px-3 py-1.5 text-sm text-text-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
