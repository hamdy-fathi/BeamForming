"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  computeBeamforming,
  getWindows,
  defaultBeamformingParams,
  type BeamformingParams,
} from "@/lib/api";

/* ── Colour-map helper ──────────────────────────────────────────────── */
function valueToColor(v: number): string {
  // dark-theme heat: indigo → teal → white
  const r = Math.round(30 + v * 200);
  const g = Math.round(27 + v * 220);
  const b = Math.round(75 + v * 140);
  return `rgb(${Math.min(r, 255)},${Math.min(g, 255)},${Math.min(b, 255)})`;
}

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

  // draw interference map
  useEffect(() => {
    if (!result?.interference_map?.map || !mapCanvasRef.current) return;
    const canvas = mapCanvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const map = result.interference_map.map;
    const h = map.length;
    const w = map[0].length;
    canvas.width = w;
    canvas.height = h;

    const imgData = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = Math.max(0, Math.min(1, map[y][x]));
        const idx = (y * w + x) * 4;
        // cool desaturated heat: dark slate → warm gray
        imgData.data[idx + 0] = Math.round(17 + v * 180);   // R
        imgData.data[idx + 1] = Math.round(19 + v * 170);   // G
        imgData.data[idx + 2] = Math.round(36 + v * 120);   // B
        imgData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }, [result]);

  // draw beam profile
  useEffect(() => {
    if (!result?.beam_profile || !profileCanvasRef.current) return;
    const canvas = profileCanvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const { angles, magnitudes_db } = result.beam_profile;
    const W = 500, H = 300;
    canvas.width = W;
    canvas.height = H;

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
  }, [result]);

  // draw window weights
  useEffect(() => {
    if (!result?.window_weights || !windowCanvasRef.current) return;
    const canvas = windowCanvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const weights = result.window_weights;
    const W = 250, H = 100;
    canvas.width = W;
    canvas.height = H;

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

  return (
    <div className="mx-auto max-w-screen-2xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Beamforming Core</h1>
          <p className="text-sm text-text-secondary">
            Phased Array Interference & Beam Profile
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
            {/* window info */}
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
            min={50} max={300} step={10}
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
                className="w-full max-h-[400px] rounded border border-border object-contain"
                style={{ imageRendering: "auto" }}
              />
              {/* Color bar */}
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] text-text-muted">Max</span>
                <div
                  className="w-4 rounded"
                  style={{
                    height: 200,
                    background:
                      "linear-gradient(to bottom, rgb(197,187,155), rgb(110,168,160), rgb(17,19,24))",
                  }}
                />
                <span className="text-[10px] text-text-muted">Min</span>
              </div>
            </div>
          </div>

          {/* Beam Profile */}
          <div className="rounded-lg border border-border bg-bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-text-primary uppercase tracking-wider">
              Beam Profile (dB)
            </h2>
            <canvas
              ref={profileCanvasRef}
              className="w-full rounded border border-border"
              style={{ height: 300 }}
            />
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
