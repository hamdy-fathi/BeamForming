"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { simulate5G } from "@/lib/api";

const CANVAS_W = 800;
const CANVAS_H = 600;
const SCALE = 0.5; // pixels per metre

const DEFAULT_TOWERS = [
  { position: { x: 200, y: 500 }, num_elements: 32, frequency: 28e9, coverage_radius: 500, element_spacing: 0.5, window_type: "hamming", snr: 200 },
  { position: { x: 600, y: 500 }, num_elements: 32, frequency: 28e9, coverage_radius: 500, element_spacing: 0.5, window_type: "hamming", snr: 200 },
  { position: { x: 400, y: 150 }, num_elements: 32, frequency: 28e9, coverage_radius: 500, element_spacing: 0.5, window_type: "hamming", snr: 200 },
];

const DEFAULT_USERS = [
  { x: 350, y: 350 },
  { x: 500, y: 400 },
];

const TOWER_COLORS = ["#22c55e", "#3b82f6", "#f59e0b"];
const USER_COLORS = ["#ef4444", "#a855f7"];

function TowerSlider({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex justify-between text-[10px]">
        <span className="text-text-muted">{label}</span>
        <span className="font-mono text-text-primary">
          {value >= 1e9 ? `${(value / 1e9).toFixed(1)}G` : value >= 1e6 ? `${(value / 1e6).toFixed(0)}M` : value}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="w-full" style={{ height: 14 }} />
    </div>
  );
}

export default function FiveGPage() {
  const [towers, setTowers] = useState(DEFAULT_TOWERS);
  const [users, setUsers] = useState(DEFAULT_USERS);
  const [activeUser, setActiveUser] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const moveStep = 20;

  // drag refs
  const draggingTowerRef = useRef<number | null>(null);
  const draggingUserRef = useRef<number | null>(null);
  const towersRef = useRef(towers);
  const usersRef = useRef(users);
  towersRef.current = towers;
  usersRef.current = users;

  const runSimulation = useCallback(async (t: typeof towers, u: typeof users) => {
    setLoading(true);
    try {
      const data = await simulate5G({ towers: t, users: u });
      setResult(data);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    runSimulation(towers, users);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-simulate when tower params change (with debounce)
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runSimulation(towers, users);
    }, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [towers]);

  // keyboard controls
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      let dx = 0, dy = 0;
      if (activeUser === 0) {
        if (e.key === "ArrowUp") dy = -moveStep;
        else if (e.key === "ArrowDown") dy = moveStep;
        else if (e.key === "ArrowLeft") dx = -moveStep;
        else if (e.key === "ArrowRight") dx = moveStep;
      }
      if (activeUser === 1) {
        if (e.key === "w" || e.key === "W") dy = -moveStep;
        else if (e.key === "s" || e.key === "S") dy = moveStep;
        else if (e.key === "a" || e.key === "A") dx = -moveStep;
        else if (e.key === "d" || e.key === "D") dx = moveStep;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        setActiveUser((prev) => (prev === 0 ? 1 : 0));
        return;
      }
      if (dx !== 0 || dy !== 0) {
        e.preventDefault();
        setUsers((prev) => {
          const next = [...prev];
          next[activeUser] = {
            x: Math.max(20, Math.min(CANVAS_W - 20, next[activeUser].x + dx)),
            y: Math.max(20, Math.min(CANVAS_H - 20, next[activeUser].y + dy)),
          };
          runSimulation(towers, next);
          return next;
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeUser, towers, runSimulation]);

  // canvas coordinate helper
  const canvasToSim = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((clientY - rect.top) / rect.height) * CANVAS_H,
    };
  }, []);

  // Mouse events for dragging towers
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = canvasToSim(e.clientX, e.clientY);
    const tResult = result?.towers || [];
    // Check towers first
    for (let i = 0; i < tResult.length; i++) {
      const t = tResult[i];
      const dx = x - t.position.x, dy = y - t.position.y;
      if (Math.sqrt(dx * dx + dy * dy) < 22) {
        draggingTowerRef.current = i;
        e.preventDefault();
        return;
      }
    }
    // Check users
    const u = usersRef.current;
    for (let i = 0; i < u.length; i++) {
      const dx = x - u[i].x, dy = y - u[i].y;
      if (Math.sqrt(dx * dx + dy * dy) < 16) {
        draggingUserRef.current = i;
        e.preventDefault();
        return;
      }
    }
  }, [canvasToSim, result]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = canvasToSim(e.clientX, e.clientY);
    if (draggingTowerRef.current !== null) {
      const i = draggingTowerRef.current;
      setTowers(prev => {
        const next = [...prev];
        next[i] = {
          ...next[i],
          position: {
            x: Math.max(20, Math.min(CANVAS_W - 20, x)),
            y: Math.max(20, Math.min(CANVAS_H - 20, y)),
          }
        };
        return next;
      });
    } else if (draggingUserRef.current !== null) {
      const i = draggingUserRef.current;
      setUsers(prev => {
        const next = [...prev];
        next[i] = {
          x: Math.max(20, Math.min(CANVAS_W - 20, x)),
          y: Math.max(20, Math.min(CANVAS_H - 20, y)),
        };
        return next;
      });
    }
  }, [canvasToSim]);

  const handleMouseUp = useCallback(() => {
    const wasDraggingTower = draggingTowerRef.current !== null;
    const wasDraggingUser = draggingUserRef.current !== null;
    draggingTowerRef.current = null;
    draggingUserRef.current = null;
    if (wasDraggingTower || wasDraggingUser) {
      runSimulation(towersRef.current, usersRef.current);
    }
  }, [runSimulation]);

  // draw canvas
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;

    // background
    ctx.fillStyle = "#0f1117";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // grid
    ctx.strokeStyle = "#1a1d27";
    ctx.lineWidth = 1;
    for (let x = 0; x < CANVAS_W; x += 50) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_H); ctx.stroke();
    }
    for (let y = 0; y < CANVAS_H; y += 50) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke();
    }

    const towerResults = result?.towers || [];
    const userResults = result?.users || [];

    // draw coverage circles
    towerResults.forEach((t: any, i: number) => {
      ctx.beginPath();
      ctx.arc(t.position.x, t.position.y, t.coverage_radius * SCALE, 0, Math.PI * 2);
      ctx.strokeStyle = TOWER_COLORS[i] + "40";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = TOWER_COLORS[i] + "08";
      ctx.fill();
    });

    // draw connectivity beams — one cone per connection (multi-user fix)
    towerResults.forEach((t: any, i: number) => {
      const conns: any[] = t.connections || [];
      conns.forEach((conn: any, connIdx: number) => {
        const u = userResults[conn.user_id];
        if (!u) return;
        const alpha = Math.max(0.15, conn.signal_strength / 100);
        const dx = u.position.x - t.position.x;
        const dy = u.position.y - t.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);
        // Slightly offset spread per connection so two cones are visually distinct
        const spread = 0.12 + connIdx * 0.04;
        const userColor = USER_COLORS[conn.user_id] || TOWER_COLORS[i];

        // filled cone
        ctx.beginPath();
        ctx.moveTo(t.position.x, t.position.y);
        ctx.lineTo(
          t.position.x + dist * Math.cos(angle - spread),
          t.position.y + dist * Math.sin(angle - spread)
        );
        ctx.lineTo(
          t.position.x + dist * Math.cos(angle + spread),
          t.position.y + dist * Math.sin(angle + spread)
        );
        ctx.closePath();
        // blend tower color with user color
        ctx.fillStyle = TOWER_COLORS[i] + Math.round(alpha * 35).toString(16).padStart(2, "0");
        ctx.fill();

        // center line tinted with user color
        ctx.beginPath();
        ctx.moveTo(t.position.x, t.position.y);
        ctx.lineTo(u.position.x, u.position.y);
        ctx.strokeStyle = userColor + Math.round(alpha * 200).toString(16).padStart(2, "0");
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    });

    // draw towers
    towerResults.forEach((t: any, i: number) => {
      const isDragging = draggingTowerRef.current === i;
      // glow for dragging
      if (isDragging) {
        ctx.shadowColor = TOWER_COLORS[i];
        ctx.shadowBlur = 16;
      }
      ctx.fillStyle = TOWER_COLORS[i];
      ctx.beginPath();
      ctx.moveTo(t.position.x, t.position.y - 18);
      ctx.lineTo(t.position.x - 10, t.position.y + 10);
      ctx.lineTo(t.position.x + 10, t.position.y + 10);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;

      // drag handle ring
      ctx.beginPath();
      ctx.arc(t.position.x, t.position.y - 4, 14, 0, Math.PI * 2);
      ctx.strokeStyle = TOWER_COLORS[i] + (isDragging ? "cc" : "44");
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = "#e4e6ef";
      ctx.font = "bold 11px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`T${i + 1}`, t.position.x, t.position.y + 24);
    });

    // draw users
    users.forEach((u, i) => {
      const isActive = i === activeUser;
      ctx.beginPath();
      ctx.arc(u.x, u.y, isActive ? 12 : 10, 0, Math.PI * 2);
      ctx.fillStyle = USER_COLORS[i] + (isActive ? "cc" : "88");
      ctx.fill();
      if (isActive) {
        ctx.strokeStyle = USER_COLORS[i];
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.fillStyle = "#fff";
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`U${i + 1}`, u.x, u.y);
      ctx.textBaseline = "alphabetic";
    });

  }, [result, users, activeUser]);

  const updateTowerParam = (i: number, key: string, value: number) => {
    setTowers(prev => prev.map((t, idx) => idx === i ? { ...t, [key]: value } : t));
  };

  return (
    <div className="mx-auto max-w-screen-2xl p-4">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-text-primary">5G Simulator</h1>
        <p className="text-sm text-text-secondary">
          3 towers, 2 users — drag towers/users on canvas | Arrow Keys (U1) / WASD (U2) / Tab to switch
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        {/* Canvas */}
        <div className="rounded-lg border border-border bg-bg-surface p-4">
          <canvas
            ref={canvasRef}
            className="w-full rounded border border-border cursor-grab active:cursor-grabbing"
            style={{ maxHeight: 600, aspectRatio: `${CANVAS_W}/${CANVAS_H}` }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          />
          <div className="mt-3 flex gap-4 text-xs text-text-muted">
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: USER_COLORS[0] }} />
              User 1 (Arrows){activeUser === 0 && " ← active"}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: USER_COLORS[1] }} />
              User 2 (WASD){activeUser === 1 && " ← active"}
            </span>
            <span className="ml-auto">Tab = switch · Drag towers/users</span>
          </div>
        </div>

        {/* Tower Parameter Cards */}
        <div className="flex flex-col gap-3 overflow-y-auto" style={{ maxHeight: "calc(100vh - 120px)" }}>
          {loading && (
            <span className="text-xs text-accent-green animate-pulse">Updating…</span>
          )}

          {towers.map((tower, i) => {
            const tResult = (result?.towers || [])[i];
            const conns: any[] = tResult?.connections || [];
            return (
              <div
                key={i}
                className="rounded-lg border bg-bg-surface p-4 transition-colors"
                style={{ borderColor: TOWER_COLORS[i] + "66" }}
              >
                <div className="mb-3 flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded-sm"
                    style={{ background: TOWER_COLORS[i] }}
                  />
                  <h3 className="text-sm font-semibold text-text-primary">
                    Tower {i + 1}
                  </h3>
                  {conns.length > 0 && (
                    <span className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={{ background: TOWER_COLORS[i] + "22", color: TOWER_COLORS[i] }}>
                      {conns.length} user{conns.length > 1 ? "s" : ""}
                    </span>
                  )}
                </div>

                {/* Editable sliders */}
                <div className="space-y-2">
                  <TowerSlider
                    label="Elements" value={tower.num_elements}
                    min={4} max={128} step={4}
                    onChange={(v) => updateTowerParam(i, "num_elements", v)}
                  />
                  <TowerSlider
                    label="Coverage (m)" value={tower.coverage_radius}
                    min={100} max={1000} step={50}
                    onChange={(v) => updateTowerParam(i, "coverage_radius", v)}
                  />
                  <TowerSlider
                    label="Frequency" value={tower.frequency}
                    min={1e9} max={100e9} step={1e9} unit="Hz"
                    onChange={(v) => updateTowerParam(i, "frequency", v)}
                  />
                  <TowerSlider
                    label="SNR" value={tower.snr}
                    min={0} max={500} step={10}
                    onChange={(v) => updateTowerParam(i, "snr", v)}
                  />
                </div>

                {/* Position info */}
                <div className="mt-2 flex gap-3 text-[10px] text-text-muted border-t border-border pt-2">
                  <span>x: {Math.round(tower.position.x)}</span>
                  <span>y: {Math.round(tower.position.y)}</span>
                  {tResult?.parameters?.steering_angle !== undefined && (
                    <span className="ml-auto">steer: {tResult.parameters.steering_angle.toFixed(1)}°</span>
                  )}
                </div>

                {conns.length > 0 && (
                  <div className="mt-2 border-t border-border pt-2">
                    {conns.map((c: any) => (
                      <div key={c.user_id} className="flex justify-between text-xs">
                        <span style={{ color: USER_COLORS[c.user_id] }}>
                          User {c.user_id + 1}
                        </span>
                        <span className="font-mono text-text-primary">
                          {c.distance}m | {c.signal_strength}%
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* User Signal Summary */}
          {result?.users?.map((u: any, i: number) => (
            <div key={i} className="rounded-lg border border-border bg-bg-surface p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-block h-3 w-3 rounded-full" style={{ background: USER_COLORS[i] }} />
                <span className="text-sm font-semibold text-text-primary">User {i + 1}</span>
              </div>
              <div className="text-xs text-text-secondary">
                <p>Connected to: {u.connected_towers.length > 0 ? u.connected_towers.map((t: number) => `T${t + 1}`).join(", ") : "No towers"}</p>
                {Object.entries(u.signal_strengths || {}).map(([tid, str]) => (
                  <div key={tid} className="flex justify-between mt-1">
                    <span>Tower {Number(tid) + 1}</span>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 rounded-full bg-bg-elevated overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${str}%`,
                            background: TOWER_COLORS[Number(tid)],
                          }}
                        />
                      </div>
                      <span className="font-mono text-text-primary w-8 text-right">{String(str)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
