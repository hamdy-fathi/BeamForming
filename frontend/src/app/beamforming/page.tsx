"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  computeBeamforming,
  getWindows,
  defaultBeamformingParams,
  type BeamformingParams,
} from "@/lib/api";

/* ── Slider component ───────────────────────────────────────────────── */
function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
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
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
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

    ctx.fillStyle = "#1a1d27";
    ctx.fillRect(0, 0, totalW, totalH);

    // Dark-centered diverging colormap: deep blue → dark → deep red
    // Maps value in [-1, 1] to colour; zero → near-black (fits dark theme)
    const coolwarmMap = (v: number): [number, number, number] => {
      v = Math.max(-1, Math.min(1, v));
      let r: number, g: number, b: number;
      if (v < 0) {
        // Negative: dark → deep blue  (v: 0 → -1)
        const s = -v; // 0 → 1
        r = Math.round(22 * (1 - s));              // 22 → 0
        g = Math.round(24 + s * 56);               // 24 → 80
        b = Math.round(30 + s * 195);              // 30 → 225
      } else {
        // Positive: dark → deep red  (v: 0 → 1)
        const s = v;  // 0 → 1
        r = Math.round(22 + s * 213);              // 22 → 235
        g = Math.round(24 + s * 26);               // 24 → 50
        b = Math.round(30 * (1 - s));              // 30 → 0
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
    ctx.fillStyle = "#b0b8cc";
    ctx.strokeStyle = "#555a6e";
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
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#2563eb";
      ctx.fill();
      ctx.strokeStyle = "#1e40af";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Transmitter legend
    ctx.fillStyle = "#2563eb";
    ctx.beginPath();
    ctx.arc(margin.left + plotW - 90, margin.top + 16, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#b0b8cc";
    ctx.font = "11px 'Inter', sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Transmitters", margin.left + plotW - 82, margin.top + 20);

    // Plot border
    ctx.strokeStyle = "#555a6e";
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

    ctx.fillStyle = "#191c24";
    ctx.fillRect(0, 0, W, H);

    // grid lines
    ctx.strokeStyle = "#2a2f3b";
    ctx.lineWidth = 1;
    for (let db = 0; db >= -60; db -= 10) {
      const y = H - ((db + 60) / 60) * H;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      ctx.fillStyle = "#555968";
      ctx.font = "10px monospace";
      ctx.textAlign = "left";
      ctx.fillText(`${db} dB`, 4, y - 2);
    }

    // angle labels
    for (let a = -90; a <= 90; a += 30) {
      const x = ((a + 90) / 180) * W;
      ctx.fillStyle = "#555a6e";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${a}°`, x, H - 4);
    }

    // beam curve
    ctx.beginPath();
    ctx.strokeStyle = "#6ea8a0";
    ctx.lineWidth = 2;
    for (let i = 0; i < angles.length; i++) {
      const x = ((angles[i] + 90) / 180) * W;
      const y = H - ((magnitudes_db[i] + 60) / 60) * H;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // steering angle vertical indicator
    const steerX = ((params.steering_angle + 90) / 180) * W;
    ctx.strokeStyle = "rgba(255, 220, 80, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(steerX, 0);
    ctx.lineTo(steerX, H);
    ctx.stroke();
    ctx.setLineDash([]);

    // -3dB line
    ctx.strokeStyle = "#c0635f";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    const y3db = H - ((-3 + 60) / 60) * H;
    ctx.beginPath();
    ctx.moveTo(0, y3db);
    ctx.lineTo(W, y3db);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#c0635f";
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
    const cx = W / 2, cy = H / 2;
    const maxR = W / 2 - 20;

    ctx.fillStyle = "#191c24";
    ctx.fillRect(0, 0, W, H);

    // concentric dB rings at 0, -20, -40, -60
    const dbLevels = [0, -20, -40, -60];
    dbLevels.forEach((db) => {
      const r = ((db + 60) / 60) * maxR;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = "#2a2f3b";
      ctx.lineWidth = 1;
      ctx.stroke();
      // label
      ctx.fillStyle = "#555968";
      ctx.font = "9px monospace";
      ctx.textAlign = "left";
      ctx.fillText(`${db}`, cx + r + 2, cy);
    });

    // cross hairs
    ctx.strokeStyle = "#2a2f3b";
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(cx, cy - maxR - 10); ctx.lineTo(cx, cy + maxR + 10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - maxR - 10, cy); ctx.lineTo(cx + maxR + 10, cy); ctx.stroke();

    // angle labels (0° top, 90° right, etc.)
    const labelAngles = [0, 30, 60, 90, -30, -60, -90];
    ctx.fillStyle = "#6b7280";
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
      // angles: 0° = top, positive = right → convert to canvas angle
      const rad = (angleDeg - 90) * Math.PI / 180;
      const px = cx + r * Math.cos(rad);
      const py = cy + r * Math.sin(rad);
      if (first) { ctx.moveTo(px, py); first = false; }
      else ctx.lineTo(px, py);
    }
    ctx.closePath();

    // gradient fill
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    grad.addColorStop(0, "rgba(110,168,160,0.55)");
    grad.addColorStop(1, "rgba(110,168,160,0.05)");
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = "#6ea8a0";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // steering angle indicator line on polar
    const steerRad = (params.steering_angle - 90) * Math.PI / 180;
    ctx.strokeStyle = "rgba(255, 220, 80, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + (maxR + 10) * Math.cos(steerRad), cy + (maxR + 10) * Math.sin(steerRad));
    ctx.stroke();
    ctx.setLineDash([]);

    // title
    ctx.fillStyle = "#555968";
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

    ctx.fillStyle = "#191c24";
    ctx.fillRect(0, 0, W, H);

    ctx.beginPath();
    ctx.strokeStyle = "#9480b3";
    ctx.lineWidth = 2;
    for (let i = 0; i < weights.length; i++) {
      const x = (i / (weights.length - 1)) * W;
      const y = H - weights[i] * H * 0.9 - 5;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.fillStyle = "#555968";
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
    <div className="mx-auto max-w-screen-2xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Beamforming Core</h1>
          <p className="text-sm text-text-secondary">
            Phased Array Interference &amp; Beam Profile
          </p>
        </div>
        {loading && (
          <span className="text-xs text-accent-teal animate-pulse">Computing…</span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* ── Parameter Panel ── */}
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-bg-surface p-4">
          <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
            Parameters
          </h2>

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
          <Slider
            label="Frequency"
            value={params.frequency}
            min={1e6} max={30e9} step={1e6} unit="Hz"
            onChange={(v) => updateParam("frequency", v)}
          />
          <Slider
            label="SNR"
            value={params.snr}
            min={0} max={1000} step={1}
            onChange={(v) => updateParam("snr", v)}
          />

          {/* Medium Speed */}
          <div className="flex flex-col gap-1 border-t border-border pt-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
              Medium / Application
            </span>
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => handleMediumPreset("em")}
                className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors ${mediumPreset === "em" ? "bg-accent-teal/20 border border-accent-teal text-accent-teal" : "border border-border text-text-muted hover:text-text-primary"}`}
              >
                EM Wave
                <span className="block text-[10px] opacity-70">3×10⁸ m/s</span>
              </button>
              <button
                onClick={() => handleMediumPreset("tissue")}
                className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors ${mediumPreset === "tissue" ? "bg-accent-red/20 border border-accent-red text-accent-red" : "border border-border text-text-muted hover:text-text-primary"}`}
              >
                Sound / Tissue
                <span className="block text-[10px] opacity-70">1540 m/s</span>
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
              className="rounded border border-border bg-bg-elevated px-2 py-1.5 text-sm text-text-primary outline-none focus:border-border-focus"
            >
              <option value="sine">Sine</option>
              <option value="cosine">Cosine</option>
              <option value="pulse">Pulse</option>
            </select>
          </div>

          {/* Window / Apodization */}
          <div className="mt-2 border-t border-border pt-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
              Apodization
            </h3>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-secondary">Window Function</span>
              <select
                value={params.window_type}
                onChange={(e) => updateParam("window_type", e.target.value)}
                className="rounded border border-border bg-bg-elevated px-2 py-1.5 text-sm text-text-primary outline-none focus:border-border-focus"
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
              <p className="mt-2 text-xs text-text-muted">
                {windows.find((w: any) => w.type === params.window_type)?.description}
              </p>
            )}
            {/* window shape canvas */}
            <canvas
              ref={windowCanvasRef}
              className="mt-2 w-full rounded border border-border"
              style={{ height: 100 }}
            />
          </div>

          {/* Resolution */}
          <Slider
            label="Map Resolution"
            value={params.map_resolution}
            min={50} max={800} step={10}
            onChange={(v) => updateParam("map_resolution", v)}
          />
        </div>

        {/* ── Visualisation Area ── */}
        <div className="flex flex-col gap-4">
          {/* Interference Map */}
          <div className="rounded-lg border border-border bg-bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-text-primary uppercase tracking-wider">
              Constructive / Destructive Interference Map
            </h2>
            <div className="flex items-center gap-4">
              <canvas
                ref={mapCanvasRef}
                className="w-full rounded border border-border"
                style={{ height: 455 }}
              />
              {/* Color bar */}
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] text-text-muted">1.00</span>
                <div
                  className="w-4 rounded"
                  style={{
                    height: 200,
                    background:
                      "linear-gradient(to bottom, rgb(235,50,0), rgb(130,35,15), rgb(22,24,30), rgb(10,50,120), rgb(0,80,225))",
                  }}
                />
                <span className="text-[10px] text-text-muted">-1.00</span>
                <span className="text-[9px] text-text-muted mt-1 writing-mode-vertical" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", letterSpacing: "0.5px" }}>
                  Interference Intensity
                </span>
              </div>
            </div>
          </div>

          {/* Beam Profiles — Cartesian + Polar side by side */}
          <div className="rounded-lg border border-border bg-bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-text-primary uppercase tracking-wider">
              Beam Profile
            </h2>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="flex-1">
                <p className="mb-1 text-xs text-text-muted">Cartesian (dB)</p>
                <canvas
                  ref={profileCanvasRef}
                  className="w-full rounded border border-border"
                  style={{ height: 300 }}
                />
              </div>
              <div className="flex-shrink-0">
                <p className="mb-1 text-xs text-text-muted">Polar (rose)</p>
                <canvas
                  ref={polarCanvasRef}
                  className="rounded border border-border"
                  style={{ width: 340, height: 340 }}
                />
              </div>
            </div>
          </div>

          {/* Current Parameters Summary */}
          {result?.parameters && (
            <div className="rounded-lg border border-border bg-bg-surface p-4">
              <h2 className="mb-3 text-sm font-semibold text-text-primary uppercase tracking-wider">
                Active Parameters
              </h2>
              <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs sm:grid-cols-4">
                {Object.entries(result.parameters).map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b border-border/50 py-1">
                    <span className="text-text-muted">{k.replace(/_/g, " ")}</span>
                    <span className="font-mono text-text-primary">
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
