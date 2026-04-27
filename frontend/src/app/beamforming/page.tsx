"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  computeBeamforming,
  getWindows,
  defaultBeamformingParams,
  type BeamformingParams,
} from "@/lib/api";

/* ── Collapsible Section ─────────────────────────────────────────────── */
function Section({ icon, title, color, children, defaultOpen = true }: {
  icon: string; title: string; color: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={`section-header w-full ${open ? 'open' : ''}`}
        style={{ color }}
      >
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wider flex-1 text-left">{title}</span>
        <span className="chevron">▶</span>
      </button>
      <div className={`section-collapse ${open ? '' : 'collapsed'}`}>
        <div className="flex flex-col gap-3 pt-1 pb-2">{children}</div>
      </div>
    </div>
  );
}

/* ── Slider component ───────────────────────────────────────────────── */
function Slider({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  unit?: string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-secondary">{label}</span>
        <span className="font-mono text-text-primary">
          {typeof value === "number" && value >= 1e6
            ? `${(value / 1e6).toFixed(1)} M`
            : typeof value === "number" && value >= 1e3
            ? `${(value / 1e3).toFixed(1)} k`
            : Number(value).toFixed(step < 1 ? 2 : 0)}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
    </div>
  );
}

export default function BeamformingPage() {
  const [params, setParams] = useState<BeamformingParams>(defaultBeamformingParams);
  const [result, setResult] = useState<any>(null);
  const [windows, setWindows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const mapCanvasRef = useRef<HTMLCanvasElement>(null);
  const profileCanvasRef = useRef<HTMLCanvasElement>(null);
  const polarCanvasRef = useRef<HTMLCanvasElement>(null);
  const windowCanvasRef = useRef<HTMLCanvasElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // load windows list
  useEffect(() => {
    getWindows().then((d) => setWindows(d.windows)).catch(() => {});
  }, []);

  // debounced compute
  const compute = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await computeBeamforming(params);
        setResult(data);
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    }, 200);
  }, [params]);

  useEffect(() => { compute(); }, [compute]);

  // draw interference map with blue-white-red diverging colormap
  useEffect(() => {
    if (!result?.interference_map?.map || !mapCanvasRef.current) return;
    const canvas = mapCanvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const map = result.interference_map.map;
    const mapH = map.length;
    const mapW = map[0].length;

    // DPI-aware sizing: measure from parent container to avoid 0-size issue
    const dpr = window.devicePixelRatio || 1;
    const parent = canvas.parentElement;
    const cssW = parent ? parent.clientWidth - 80 : 800; // leave room for colorbar
    const cssH = 455;
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Layout: add margins for axis labels
    const margin = { top: 10, right: 10, bottom: 45, left: 55 };
    const plotW = cssW - margin.left - margin.right;
    const plotH = cssH - margin.top - margin.bottom;
    const totalW = cssW;
    const totalH = cssH;

    ctx.fillStyle = "#080c14";
    ctx.fillRect(0, 0, totalW, totalH);

    // Dark-centered diverging colormap: deep blue → dark → deep red
    const coolwarmMap = (v: number): [number, number, number] => {
      v = Math.max(-1, Math.min(1, v));
      let r: number, g: number, b: number;
      if (v < 0) {
        const s = -v;
        r = Math.round(22 * (1 - s));
        g = Math.round(24 + s * 56);
        b = Math.round(30 + s * 195);
      } else {
        const s = v;
        r = Math.round(22 + s * 213);
        g = Math.round(24 + s * 26);
        b = Math.round(30 * (1 - s));
      }
      return [r, g, b];
    };

    // Draw the heatmap into the plot area
    // Render at full backing-store resolution for the plot region
    const bmpW = Math.round(plotW * dpr);
    const bmpH = Math.round(plotH * dpr);
    const imgData = ctx.createImageData(bmpW, bmpH);
    for (let py = 0; py < bmpH; py++) {
      for (let px = 0; px < bmpW; px++) {
        // Map canvas pixel to data row/col (flip Y so y=0 is at bottom)
        const dataRow = mapH - 1 - Math.floor((py / bmpH) * mapH);
        const dataCol = Math.floor((px / bmpW) * mapW);
        const v = map[Math.min(dataRow, mapH - 1)][Math.min(dataCol, mapW - 1)];
        const [cr, cg, cb] = coolwarmMap(v);
        const idx = (py * bmpW + px) * 4;
        imgData.data[idx + 0] = cr;
        imgData.data[idx + 1] = cg;
        imgData.data[idx + 2] = cb;
        imgData.data[idx + 3] = 255;
      }
    }
    // Put image data at the margin offset (in device pixels)
    // Save/restore because putImageData ignores transforms
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset to identity for putImageData
    ctx.putImageData(imgData, Math.round(margin.left * dpr), Math.round(margin.top * dpr));
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // restore DPI scale

    // Axis info
    const xArr = result.interference_map.x as number[];
    const yArr = result.interference_map.y as number[];
    const xMin = xArr[0], xMax = xArr[xArr.length - 1];
    const yMin = yArr[0], yMax = yArr[yArr.length - 1];

    // Helper: format axis value smartly
    const fmtVal = (v: number) => {
      const abs = Math.abs(v);
      if (abs >= 1) return v.toFixed(1);
      if (abs >= 0.01) return v.toFixed(2);
      return v.toExponential(1);
    };

    // Draw axis tick marks and labels
    ctx.fillStyle = "#8892a6";
    ctx.strokeStyle = "#1e2433";
    ctx.lineWidth = 1;
    ctx.font = "11px 'Inter', sans-serif";

    // X-axis ticks
    const xTicks = 9;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i <= xTicks; i++) {
      const frac = i / xTicks;
      const px = margin.left + frac * plotW;
      const val = xMin + frac * (xMax - xMin);
      // tick line
      ctx.beginPath();
      ctx.moveTo(px, margin.top + plotH);
      ctx.lineTo(px, margin.top + plotH + 4);
      ctx.stroke();
      ctx.fillText(fmtVal(val), px, margin.top + plotH + 6);
    }
    // X-axis label
    ctx.font = "12px 'Inter', sans-serif";
    ctx.fillText("x (meters)", margin.left + plotW / 2, totalH - 8);

    // Y-axis ticks
    const yTicks = 6;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.font = "11px 'Inter', sans-serif";
    for (let i = 0; i <= yTicks; i++) {
      const frac = i / yTicks;
      const py = margin.top + plotH - frac * plotH; // flip: 0 at bottom
      const val = yMin + frac * (yMax - yMin);
      ctx.beginPath();
      ctx.moveTo(margin.left - 4, py);
      ctx.lineTo(margin.left, py);
      ctx.stroke();
      ctx.fillText(fmtVal(val), margin.left - 7, py);
    }
    // Y-axis label (rotated)
    ctx.save();
    ctx.translate(14, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.font = "12px 'Inter', sans-serif";
    ctx.fillText("y (meters)", 0, 0);
    ctx.restore();

    // Draw transmitter element dots at the bottom of the plot
    const numElems = params.num_elements;
    const elemSpacing = params.element_spacing;
    // Element positions in data coordinates
    for (let n = 0; n < numElems; n++) {
      const elemDataX = (n - (numElems - 1) / 2.0) * elemSpacing * (result.parameters?.wavelength || 1);
      // Convert data X to pixel X
      const fracX = (elemDataX - xMin) / (xMax - xMin);
      if (fracX < 0 || fracX > 1) continue;
      const px = margin.left + fracX * plotW;
      const py = margin.top + plotH; // bottom of plot

      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#06b6d4";
      ctx.fill();
      ctx.shadowColor = "#06b6d4";
      ctx.shadowBlur = 8;
      ctx.strokeStyle = "#0e7490";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Transmitter legend
    ctx.fillStyle = "#06b6d4";
    ctx.beginPath();
    ctx.arc(margin.left + plotW - 90, margin.top + 16, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#8892a6";
    ctx.font = "11px 'Inter', sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Transmitters", margin.left + plotW - 82, margin.top + 20);

    // Plot border
    ctx.strokeStyle = "#1e2433";
    ctx.lineWidth = 1;
    ctx.strokeRect(margin.left, margin.top, plotW, plotH);
  }, [result, params.steering_angle, params.num_elements, params.element_spacing, params.frequency, params.phase_offset, params.signal_type, params.snr, params.window_type, params.medium_speed, params.map_resolution]);

  // draw Cartesian beam profile
  useEffect(() => {
    if (!result?.beam_profile || !profileCanvasRef.current) return;
    const canvas = profileCanvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const { angles, magnitudes_db } = result.beam_profile;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#080c14";
    ctx.fillRect(0, 0, W, H);

    // grid lines
    ctx.strokeStyle = "#141922";
    ctx.lineWidth = 1;
    for (let db = 0; db >= -60; db -= 10) {
      const y = H - ((db + 60) / 60) * H;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      ctx.fillStyle = "#4d5568";
      ctx.font = "10px monospace";
      ctx.textAlign = "left";
      ctx.fillText(`${db} dB`, 4, y - 2);
    }

    // angle labels
    for (let a = -90; a <= 90; a += 30) {
      const x = ((a + 90) / 180) * W;
      ctx.fillStyle = "#4d5568";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${a}°`, x, H - 4);
    }

    // area fill under curve
    ctx.beginPath();
    for (let i = 0; i < angles.length; i++) {
      const x = ((angles[i] + 90) / 180) * W;
      const y = H - ((magnitudes_db[i] + 60) / 60) * H;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(((angles[angles.length-1] + 90) / 180) * W, H);
    ctx.lineTo(((angles[0] + 90) / 180) * W, H);
    ctx.closePath();
    ctx.fillStyle = "rgba(6, 182, 212, 0.08)";
    ctx.fill();

    // beam curve with glow
    ctx.beginPath();
    ctx.strokeStyle = "#06b6d4";
    ctx.lineWidth = 2;
    ctx.shadowColor = "#06b6d4";
    ctx.shadowBlur = 6;
    for (let i = 0; i < angles.length; i++) {
      const x = ((angles[i] + 90) / 180) * W;
      const y = H - ((magnitudes_db[i] + 60) / 60) * H;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // steering angle vertical indicator
    const steerX = ((params.steering_angle + 90) / 180) * W;
    ctx.strokeStyle = "rgba(245, 158, 11, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(steerX, 0);
    ctx.lineTo(steerX, H);
    ctx.stroke();
    ctx.setLineDash([]);

    // -3dB line
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    const y3db = H - ((-3 + 60) / 60) * H;
    ctx.beginPath();
    ctx.moveTo(0, y3db);
    ctx.lineTo(W, y3db);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#ef4444";
    ctx.font = "10px monospace";
    ctx.textAlign = "left";
    ctx.fillText("-3 dB", W - 42, y3db - 4);
  }, [result, params.steering_angle]);

  // draw polar beam profile
  useEffect(() => {
    if (!result?.beam_profile || !polarCanvasRef.current) return;
    const canvas = polarCanvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const { angles, magnitudes_db } = result.beam_profile;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.scale(dpr, dpr);
    const cx = W / 2, cy = H - 30;  // center at bottom for half-plane polar
    const maxR = Math.min(W / 2 - 20, H - 50);

    ctx.fillStyle = "#080c14";
    ctx.fillRect(0, 0, W, H);

    // concentric dB rings at 0, -20, -40, -60
    const dbLevels = [0, -20, -40, -60];
    dbLevels.forEach((db) => {
      const r = ((db + 60) / 60) * maxR;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = "#141922";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#4d5568";
      ctx.font = "9px monospace";
      ctx.textAlign = "left";
      ctx.fillText(`${db}`, cx + r + 2, cy);
    });

    // cross hairs
    ctx.strokeStyle = "#141922";
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(cx, cy - maxR - 10); ctx.lineTo(cx, cy + maxR + 10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - maxR - 10, cy); ctx.lineTo(cx + maxR + 10, cy); ctx.stroke();

    // angle labels
    const labelAngles = [0, 30, 60, 90, -30, -60, -90];
    ctx.fillStyle = "#4d5568";
    ctx.font = "9px monospace";
    labelAngles.forEach((a) => {
      const rad = (a - 90) * Math.PI / 180;
      const lx = cx + (maxR + 14) * Math.cos(rad);
      const ly = cy + (maxR + 14) * Math.sin(rad);
      ctx.textAlign = "center";
      ctx.fillText(`${a}°`, lx, ly + 3);
    });

    // filled polar shape
    ctx.beginPath();
    let first = true;
    for (let i = 0; i < angles.length; i++) {
      const angleDeg = angles[i];
      const db = Math.max(-60, magnitudes_db[i]);
      const r = ((db + 60) / 60) * maxR;
      const rad = (angleDeg - 90) * Math.PI / 180;
      const px = cx + r * Math.cos(rad);
      const py = cy + r * Math.sin(rad);
      if (first) { ctx.moveTo(px, py); first = false; }
      else ctx.lineTo(px, py);
    }
    ctx.closePath();

    // fill with green accent
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    grad.addColorStop(0, "rgba(34, 197, 94, 0.4)");
    grad.addColorStop(1, "rgba(34, 197, 94, 0.03)");
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 1.5;
    ctx.shadowColor = "#22c55e";
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // steering angle indicator line
    const steerRad = (params.steering_angle - 90) * Math.PI / 180;
    ctx.strokeStyle = "rgba(245, 158, 11, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + (maxR + 10) * Math.cos(steerRad), cy + (maxR + 10) * Math.sin(steerRad));
    ctx.stroke();
    ctx.setLineDash([]);

    // title
    ctx.fillStyle = "#4d5568";
    ctx.font = "10px monospace";
    ctx.textAlign = "left";
    ctx.fillText("Polar (dB)", 4, 12);
  }, [result, params.steering_angle]);

  // draw window weights
  useEffect(() => {
    if (!result?.window_weights || !windowCanvasRef.current) return;
    const canvas = windowCanvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const weights = result.window_weights;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#080c14";
    ctx.fillRect(0, 0, W, H);

    ctx.beginPath();
    ctx.strokeStyle = "#a855f7";
    ctx.lineWidth = 2;
    ctx.shadowColor = "#a855f7";
    ctx.shadowBlur = 4;
    for (let i = 0; i < weights.length; i++) {
      const x = (i / (weights.length - 1)) * W;
      const y = H - weights[i] * H * 0.9 - 5;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "#4d5568";
    ctx.font = "10px monospace";
    ctx.fillText("Window Shape", 4, 12);
  }, [result]);

  const updateParam = (key: keyof BeamformingParams, value: number | string) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  // Medium speed preset handler
  const handleMediumPreset = (preset: string) => {
    if (preset === "em") updateParam("medium_speed", 3e8);
    else if (preset === "tissue") updateParam("medium_speed", 1540);
  };

  const mediumPreset =
    params.medium_speed === 3e8 ? "em" :
    params.medium_speed === 1540 ? "tissue" : "custom";

  return (
    <div className="mx-auto max-w-screen-2xl p-5">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">Beamforming Core</h1>
          <p className="text-xs text-text-muted mt-0.5">
            Phased Array Interference &amp; Beam Profile
          </p>
        </div>
        {loading && (
          <div className="status-chip" style={{ background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.2)', color: '#06b6d4' }}>
            <span className="dot" style={{ background: '#06b6d4' }} />
            Computing…
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        {/* ── Parameter Panel ── */}
        <div className="glow-card glow-card-cyan flex flex-col gap-1 p-4">
          <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
            Parameters
          </h2>

          <Section icon="📡" title="Array Configuration" color="#06b6d4">

          <Slider
            label="Number of Elements"
            value={params.num_elements}
            min={2} max={128} step={1}
            onChange={(v) => updateParam("num_elements", v)}
          />
          <Slider
            label="Element Spacing (λ)"
            value={params.element_spacing}
            min={0.1} max={2.0} step={0.05} unit="λ"
            onChange={(v) => updateParam("element_spacing", v)}
          />
          <Slider
            label="Steering Angle"
            value={params.steering_angle}
            min={-90} max={90} step={1} unit="°"
            onChange={(v) => updateParam("steering_angle", v)}
          />
          <Slider
            label="Phase Offset"
            value={params.phase_offset}
            min={0} max={6.28} step={0.01} unit="rad"
            onChange={(v) => updateParam("phase_offset", v)}
          />
          </Section>

          <Section icon="📡" title="Signal & Medium" color="#3b82f6">
          <Slider
            label="Frequency"
            value={params.frequency}
            min={1e6} max={30e9} step={1e6} unit="Hz"
            onChange={(v) => updateParam("frequency", v)}
          />
          {/* Wavelength — computed from λ = c / f, inversely linked */}
          <Slider
            label="Wavelength (λ)"
            value={params.medium_speed / params.frequency}
            min={params.medium_speed / 30e9}
            max={params.medium_speed / 1e6}
            step={params.medium_speed / 30e9 / 10}
            unit="m"
            onChange={(lambda) => {
              const newFreq = Math.round(params.medium_speed / lambda);
              updateParam("frequency", Math.max(1e6, Math.min(30e9, newFreq)));
            }}
          />
          <Slider
            label="SNR"
            value={params.snr}
            min={0} max={1000} step={1}
            onChange={(v) => updateParam("snr", v)}
          />

          {/* Medium Speed */}
          <div className="flex flex-col gap-2">
            <div className="segment-control">
              <button
                onClick={() => handleMediumPreset("em")}
                className={`segment-btn ${mediumPreset === "em" ? "active" : ""}`}
                style={{ '--seg-color': '#06b6d4' } as any}
              >
                EM Wave
                <span className="seg-sub">3×10⁸ m/s</span>
              </button>
              <button
                onClick={() => handleMediumPreset("tissue")}
                className={`segment-btn ${mediumPreset === "tissue" ? "active" : ""}`}
                style={{ '--seg-color': '#ef4444' } as any}
              >
                Sound / Tissue
                <span className="seg-sub">1540 m/s</span>
              </button>
            </div>
            <Slider
              label="Medium Speed"
              value={params.medium_speed}
              min={300} max={3e8} step={10} unit="m/s"
              onChange={(v) => updateParam("medium_speed", v)}
            />
          </div>

          {/* Signal Type */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-secondary">Signal Type</span>
            <select
              value={params.signal_type}
              onChange={(e) => updateParam("signal_type", e.target.value)}
              className="rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary outline-none"
            >
              <option value="sine">Sine</option>
              <option value="cosine">Cosine</option>
              <option value="pulse">Pulse</option>
            </select>
          </div>
          </Section>

          <Section icon="🎯" title="Apodization" color="#a855f7">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-secondary">Window Function</span>
              <select
                value={params.window_type}
                onChange={(e) => updateParam("window_type", e.target.value)}
                className="rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary outline-none"
              >
                {windows.map((w: any) => (
                  <option key={w.type} value={w.type}>
                    {w.name}
                  </option>
                ))}
                {windows.length === 0 && (
                  <>
                    <option value="rectangular">Rectangular</option>
                    <option value="hamming">Hamming</option>
                    <option value="hanning">Hanning</option>
                    <option value="blackman">Blackman</option>
                    <option value="kaiser">Kaiser</option>
                    <option value="tukey">Tukey</option>
                  </>
                )}
              </select>
            </div>
            {windows.find((w: any) => w.type === params.window_type) && (
              <p className="mt-1 text-[11px] text-text-muted leading-relaxed">
                {windows.find((w: any) => w.type === params.window_type)?.description}
              </p>
            )}
            <canvas
              ref={windowCanvasRef}
              className="mt-1 w-full rounded-lg"
              style={{ height: 80, border: '1px solid #1e2433' }}
            />
          <Slider
            label="Map Resolution"
            value={params.map_resolution}
            min={50} max={800} step={10}
            onChange={(v) => updateParam("map_resolution", v)}
          />
          </Section>
        </div>

        {/* ── Visualisation Area ── */}
        <div className="flex flex-col gap-5">
          {/* Interference Map */}
          <div className="glow-card glow-card-amber p-4">
            <h2 className="mb-3 text-xs font-semibold text-text-secondary uppercase tracking-wider">
              Constructive / Destructive Interference Map
            </h2>
            <div className="flex items-center gap-4">
              <canvas
                ref={mapCanvasRef}
                className="w-full rounded-lg"
                style={{ height: 455 }}
              />
              {/* Color bar — inferno */}
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] text-text-muted font-mono">1.00</span>
                <div
                  className="w-3.5 rounded-full"
                  style={{
                    height: 220,
                    background:
                      "linear-gradient(to bottom, rgb(235,50,0), rgb(130,35,15), rgb(22,24,30), rgb(10,50,120), rgb(0,80,225))",
                  }}
                />
                <span className="text-[10px] text-text-muted font-mono">-1.00</span>
                <span className="text-[9px] text-text-muted mt-1" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", letterSpacing: "0.5px" }}>
                  Intensity
                </span>
              </div>
            </div>
          </div>

          {/* Beam Profiles */}
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="glow-card glow-card-blue p-4">
              <h2 className="mb-3 text-xs font-semibold text-text-secondary uppercase tracking-wider">
                Beam Profile — Cartesian (dB)
              </h2>
              <canvas
                ref={profileCanvasRef}
                className="w-full rounded-lg"
                style={{ height: 300 }}
              />
            </div>
            <div className="glow-card glow-card-green p-4">
              <h2 className="mb-3 text-xs font-semibold text-text-secondary uppercase tracking-wider">
                Beam Profile — Polar
              </h2>
              <canvas
                ref={polarCanvasRef}
                className="w-full rounded-lg"
                style={{ height: 300 }}
              />
            </div>
          </div>

          {/* Active Parameters */}
          {result?.parameters && (
            <div className="glow-card glow-card-purple p-4">
              <h2 className="mb-3 text-xs font-semibold text-text-secondary uppercase tracking-wider">
                Active Parameters
              </h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {Object.entries(result.parameters).map(([k, v]) => (
                  <div key={k} className="stat-badge">
                    <span className="stat-label">{k.replace(/_/g, " ")}</span>
                    <span className="stat-value">
                      {typeof v === "number"
                        ? v >= 1e6
                          ? `${(v as number / 1e6).toFixed(2)}M`
                          : (v as number).toFixed(4)
                        : String(v)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
