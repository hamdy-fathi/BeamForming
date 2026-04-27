"use client";
import { useEffect, useRef } from "react";

export const TOWER_COLORS = ["#22c55e", "#3b82f6", "#f59e0b"];
export const USER_COLORS = ["#ef4444", "#a855f7"];

export const DEFAULT_TOWERS = [
  { position: { x: 200, y: 500 }, num_elements: 32, frequency: 28e9, coverage_radius: 500, element_spacing: 0.5, window_type: "hamming", snr: 1000, power_dbm: 30, steering_angle: 0, kaiser_beta: 6.0 },
  { position: { x: 600, y: 500 }, num_elements: 32, frequency: 28e9, coverage_radius: 500, element_spacing: 0.5, window_type: "hamming", snr: 1000, power_dbm: 30, steering_angle: 0, kaiser_beta: 6.0 },
  { position: { x: 400, y: 150 }, num_elements: 32, frequency: 28e9, coverage_radius: 500, element_spacing: 0.5, window_type: "hamming", snr: 1000, power_dbm: 30, steering_angle: 0, kaiser_beta: 6.0 },
];

export const DEFAULT_USERS = [
  { x: 550, y: 100 },
  { x: 450, y: 380 },
];


/* ── Tower Param Row ─────────────────────────────────── */
export function TowerParamRow({ label, value, min, max, step, unit, onChange, color }: {
  label: string; value: number; min: number; max: number; step: number;
  unit?: string; onChange: (v: number) => void; color?: string;
}) {
  const fmt = (v: number) => {
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)} GHz`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(0)} MHz`;
    return `${v}${unit ? ` ${unit}` : ""}`;
  };
  return (
    <div className="tower-param-row">
      <span className="tpr-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} />
      <span className="tpr-value" style={{ color: color || "#e2e5ed" }}>{fmt(value)}</span>
    </div>
  );
}

/* ── Mini Polar Plot ─────────────────────────────────── */
export function MiniPolar({ profile, color, size = 90, targetDirDeg = -90 }: {
  profile: any; color: string; size?: number; targetDirDeg?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current || !profile?.angles || !profile?.magnitudes_db) return;
    const c = ref.current, ctx = c.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr; c.height = size * dpr;
    c.style.width = size + "px"; c.style.height = size + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = size / 2, cy = size / 2, maxR = size / 2 - 8;

    ctx.fillStyle = "#080c14";
    ctx.fillRect(0, 0, size, size);

    // Rings
    [0.33, 0.66, 1].forEach(f => {
      ctx.beginPath(); ctx.arc(cx, cy, maxR * f, 0, Math.PI * 2);
      ctx.strokeStyle = "#1e2433"; ctx.lineWidth = 0.5; ctx.stroke();
    });
    // Cross
    ctx.strokeStyle = "#1e2433"; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(cx, 4); ctx.lineTo(cx, size - 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, cy); ctx.lineTo(size - 4, cy); ctx.stroke();

    // Labels
    ctx.fillStyle = "#4d5568"; ctx.font = "7px monospace"; ctx.textAlign = "center";
    ctx.fillText("90°", cx, 8); ctx.fillText("-90°", cx, size - 2);
    ctx.textAlign = "left"; ctx.fillText("0°", size - 14, cy - 2);
    ctx.textAlign = "right"; ctx.fillText("0°", 14, cy - 2);

    const { angles, magnitudes_db } = profile;

    // Find actual peak in the profile
    let peakIdx = 0;
    for (let i = 1; i < magnitudes_db.length; i++) {
      if (magnitudes_db[i] > magnitudes_db[peakIdx]) peakIdx = i;
    }
    // Profile peak canvas position (without correction) = π/2 - peakAngle
    const peakCanvasPos = Math.PI / 2 - angles[peakIdx] * Math.PI / 180;
    // Target direction in canvas cos/sin convention
    const targetCanvasDir = Math.PI / 2 - targetDirDeg * Math.PI / 180;
    // Correction to align peak to target
    const rotOff = targetCanvasDir - peakCanvasPos;

    const amps: number[] = magnitudes_db.map((db: number) => {
      const clamped = Math.max(-40, Math.min(0, db));
      return Math.pow(10, clamped / 20);
    });

    // Front lobe — same formula as canvas: ca = π/2 - profileAngle + rotOff
    ctx.beginPath();
    for (let i = 0; i < angles.length; i++) {
      const r = amps[i] * maxR;
      const ca = Math.PI / 2 - angles[i] * Math.PI / 180 + rotOff;
      const px = cx + r * Math.cos(ca);
      const py = cy + r * Math.sin(ca);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    // Back lobe (mirrored, attenuated)
    for (let i = angles.length - 1; i >= 0; i--) {
      const r = amps[i] * maxR * 0.15;
      const ca = Math.PI / 2 - angles[i] * Math.PI / 180 + rotOff + Math.PI;
      const px = cx + r * Math.cos(ca);
      const py = cy + r * Math.sin(ca);
      ctx.lineTo(px, py);
    }
    ctx.closePath();

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    grad.addColorStop(0, color + "50"); grad.addColorStop(0.7, color + "20"); grad.addColorStop(1, color + "05");
    ctx.fillStyle = grad; ctx.fill();
    ctx.strokeStyle = color + "bb"; ctx.lineWidth = 1.2; ctx.stroke();
  }, [profile, color, size, targetDirDeg]);

  return <canvas ref={ref} className="mini-polar" />;
}

/* ── Signal Strength Legend ──────────────────────────── */
export function SignalLegend() {
  const levels = [
    { label: "-30 (Strong)", color: "#ef4444" },
    { label: "-50", color: "#f97316" },
    { label: "-70", color: "#eab308" },
    { label: "-90", color: "#3b82f6" },
    { label: "-110 (Weak)", color: "#6366f1" },
  ];
  return (
    <div className="absolute top-3 left-3 rounded-lg border border-border bg-bg-surface/90 backdrop-blur-sm p-2.5" style={{ zIndex: 10 }}>
      <div className="text-[10px] font-semibold text-text-secondary mb-1.5">Signal Strength (dBm)</div>
      {levels.map(l => (
        <div key={l.label} className="flex items-center gap-2 py-0.5">
          <span className="inline-block w-3 h-2.5 rounded-sm" style={{ background: l.color }} />
          <span className="text-[10px] text-text-muted">{l.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Viz Checkboxes ──────────────────────────────────── */
export function VizCheckboxes({ viz, setViz }: { viz: Record<string, boolean>; setViz: (v: Record<string, boolean>) => void }) {
  const items = [
    { key: "beams", label: "Beams (Array Factor)", color: "#3b82f6" },
    { key: "sidelobes", label: "Side Lobes", color: "#22c55e" },
    { key: "coverage", label: "Coverage Area", color: "#06b6d4" },
    { key: "connections", label: "Connections", color: "#f59e0b" },
    { key: "grid", label: "Grid / Angle", color: "#8892a6" },
  ];
  return (
    <div className="absolute bottom-3 left-3 rounded-lg border border-border bg-bg-surface/90 backdrop-blur-sm p-2.5" style={{ zIndex: 10 }}>
      <div className="text-[10px] font-semibold text-text-secondary mb-1.5">Visualization</div>
      {items.map(it => (
        <label key={it.key} className="viz-checkbox" style={{ "--check-color": it.color } as any}>
          <input type="checkbox" checked={viz[it.key] ?? true}
            onChange={() => setViz({ ...viz, [it.key]: !(viz[it.key] ?? true) })} />
          {it.label}
        </label>
      ))}
    </div>
  );
}

/* ── Tower Card ──────────────────────────────────────── */
export function TowerCard({ tower, tResult, index, updateParam, userPositions }: {
  tower: any; tResult: any; index: number; updateParam: (i: number, k: string, v: number) => void;
  userPositions?: {x: number, y: number}[];
}) {
  const color = TOWER_COLORS[index];
  const conns: any[] = tResult?.connections || [];
  const beams: any[] = tResult?.user_beams || [];
  const profile = tResult?.beam_profile;

  // Compute real (unclipped) direction to first connected user in backend convention
  let realTargetDirDeg = tower.steering_angle ?? 0;
  if (beams.length > 0 && userPositions && tResult?.position) {
    const uid = beams[0]?.user_id;
    const uPos = userPositions?.[uid];
    if (uPos) {
      const dx = uPos.x - tResult.position.x;
      const dy = uPos.y - tResult.position.y;
      // Backend convention: atan2(dx, dy)
      realTargetDirDeg = Math.atan2(dx, dy) * 180 / Math.PI;
    }
  }

  return (
    <div className="glow-card p-3" style={{ "--card-color": color } as any}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-block h-3 w-3 rounded-full" style={{ background: color }} />
        <span className="text-sm font-bold text-text-primary">T{index + 1}</span>
        <div className="flex gap-1 ml-auto">
          {conns.map((c: any) => (
            <span key={c.user_id} className="serving-badge"
              style={{ background: USER_COLORS[c.user_id] + "22", color: USER_COLORS[c.user_id] }}>
              Serving U{c.user_id + 1}
            </span>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        {/* Params */}
        <div className="flex-1 min-w-0 space-y-0.5">
          <TowerParamRow label="Elements" value={tower.num_elements} min={4} max={128} step={4}
            onChange={v => updateParam(index, "num_elements", v)} />
          <TowerParamRow label="Spacing (λ)" value={tower.element_spacing} min={0.1} max={2} step={0.05} unit="λ"
            onChange={v => updateParam(index, "element_spacing", v)} />
          <TowerParamRow label="Frequency" value={tower.frequency} min={1e9} max={100e9} step={1e9}
            onChange={v => updateParam(index, "frequency", v)} />
          <TowerParamRow label="Power" value={tower.power_dbm || 30} min={10} max={50} step={1} unit="dBm"
            onChange={v => updateParam(index, "power_dbm", v)} />
          <TowerParamRow label="Steering" value={tower.steering_angle ?? 0} min={-89} max={89} step={1} unit="°"
            onChange={v => updateParam(index, "steering_angle", v)} color={color} />
          <TowerParamRow label="Radius" value={tower.coverage_radius ?? 500} min={100} max={1000} step={25} unit="m"
            onChange={v => updateParam(index, "coverage_radius", v)} />
          <TowerParamRow label="Kaiser β" value={tower.kaiser_beta ?? 6} min={0} max={20} step={0.5}
            onChange={v => updateParam(index, "kaiser_beta", v)} />
          <div className="flex gap-3 text-[10px] text-text-muted pt-0.5">
            <span>Users: <span className="text-text-primary font-mono">{conns.length}</span></span>
            <span>Total Power / User: <span className="text-text-primary font-mono">
              {conns.length > 0 ? `${(30 + (tResult?.split_penalty_db || 0)).toFixed(1)} dBm` : "—"}
            </span></span>
          </div>
        </div>

        {/* Mini polars — one per connected user beam, or primary beam when idle */}
        <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
          {beams.length > 0 ? beams.map((beam: any) => {
            // Compute real direction for each beam's user
            let dirDeg = tower.steering_angle ?? 0;
            if (userPositions && tResult?.position) {
              const uPos = userPositions?.[beam.user_id];
              if (uPos) {
                const dx = uPos.x - tResult.position.x;
                const dy = uPos.y - tResult.position.y;
                dirDeg = Math.atan2(dx, dy) * 180 / Math.PI;
              }
            }
            return (
              <div key={beam.user_id} className="flex flex-col items-center">
                <span className="text-[8px] text-text-muted">
                  Serving U{beam.user_id + 1}
                </span>
                <MiniPolar
                  profile={beam.beam_profile}
                  color={color}
                  size={beams.length > 1 ? 65 : 85}
                  targetDirDeg={dirDeg}
                />
              </div>
            );
          }) : (
            <div className="flex flex-col items-center">
              <span className="text-[8px] text-text-muted">Array Factor (dB)</span>
              <MiniPolar
                profile={profile}
                color={color}
                size={85}
                targetDirDeg={realTargetDirDeg}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── User Card ───────────────────────────────────────── */
export function UserCard({ user, index, towers }: { user: any; index: number; towers: any[] }) {
  const color = USER_COLORS[index];
  const connected = user?.connected_towers || [];
  const strengths = user?.signal_strengths || {};

  // Find best tower
  let bestTower = -1, bestStr = -1;
  Object.entries(strengths).forEach(([tid, str]) => {
    if ((str as number) > bestStr) { bestStr = str as number; bestTower = Number(tid); }
  });

  // Compute distance and signal info from tower results
  const connInfos = connected.map((tid: number) => {
    const tResult = towers[tid];
    const conn = tResult?.connections?.find((c: any) => c.user_id === index);
    return { tid, conn };
  });

  return (
    <div className="glow-card p-3" style={{ "--card-color": color } as any}>
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center justify-center h-5 w-5 rounded-full text-[10px] font-bold text-white"
          style={{ background: color }}>U{index + 1}</span>
        <div className="flex-1">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] text-text-muted">Connected to:</span>
            {connected.length > 0 ? connected.map((tid: number) => (
              <span key={tid} className="text-[10px] font-semibold"
                style={{ color: TOWER_COLORS[tid] }}>T{tid + 1}</span>
            )) : <span className="text-[10px] text-text-muted">None</span>}
          </div>
          {bestTower >= 0 && (
            <div className="text-[10px] text-text-muted">
              Best: <span className="font-semibold" style={{ color: TOWER_COLORS[bestTower] }}>T{bestTower + 1}</span>
            </div>
          )}
        </div>
      </div>

      {connInfos.map(({ tid, conn }: any) => conn && (
        <div key={tid} className="flex gap-4 text-[10px] mb-1">
          <div><span className="text-text-muted">Distance</span> <span className="font-mono text-text-primary">{conn.distance} m</span></div>
          <div><span className="text-text-muted">SINR</span> <span className="font-mono text-text-primary">{conn.array_gain_db} dB</span></div>
          <div><span className="text-text-muted">RSSI</span> <span className="font-mono text-text-primary">{conn.signal_dbm} dBm</span></div>
        </div>
      ))}

      {/* Signal bar */}
      {Object.entries(strengths).length > 0 && (
        <div className="flex items-center gap-2 mt-1.5">
          <div className="h-2 flex-1 rounded-full overflow-hidden" style={{ background: "#141922" }}>
            <div className="h-full rounded-full transition-all" style={{
              width: `${bestStr}%`,
              background: `linear-gradient(90deg, ${color}, ${color}88)`,
            }} />
          </div>
          <span className="font-mono text-[10px] text-text-primary w-8 text-right">{bestStr.toFixed(0)}%</span>
        </div>
      )}
    </div>
  );
}
