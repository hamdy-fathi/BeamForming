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

export default function FiveGPage() {
  const [towers, setTowers] = useState(DEFAULT_TOWERS);
  const [users, setUsers] = useState(DEFAULT_USERS);
  const [activeUser, setActiveUser] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const moveStep = 20;

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
  }, []);

  // keyboard controls
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      let dx = 0, dy = 0;
      // User 1: Arrow keys
      if (activeUser === 0) {
        if (e.key === "ArrowUp") dy = -moveStep;
        else if (e.key === "ArrowDown") dy = moveStep;
        else if (e.key === "ArrowLeft") dx = -moveStep;
        else if (e.key === "ArrowRight") dx = moveStep;
      }
      // User 2: WASD
      if (activeUser === 1) {
        if (e.key === "w" || e.key === "W") dy = -moveStep;
        else if (e.key === "s" || e.key === "S") dy = moveStep;
        else if (e.key === "a" || e.key === "A") dx = -moveStep;
        else if (e.key === "d" || e.key === "D") dx = moveStep;
      }
      // Switch active user with Tab
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

      // fill
      ctx.fillStyle = TOWER_COLORS[i] + "08";
      ctx.fill();
    });

    // draw connectivity beams
    towerResults.forEach((t: any, i: number) => {
      (t.connections || []).forEach((conn: any) => {
        const u = userResults[conn.user_id];
        if (!u) return;
        const alpha = Math.max(0.15, conn.signal_strength / 100);

        // beam cone
        const dx = u.position.x - t.position.x;
        const dy = u.position.y - t.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);
        const spread = 0.15; // beam spread angle

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
        ctx.fillStyle = TOWER_COLORS[i] + Math.round(alpha * 40).toString(16).padStart(2, "0");
        ctx.fill();

        // center line
        ctx.beginPath();
        ctx.moveTo(t.position.x, t.position.y);
        ctx.lineTo(u.position.x, u.position.y);
        ctx.strokeStyle = TOWER_COLORS[i] + Math.round(alpha * 255).toString(16).padStart(2, "0");
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    });

    // draw towers
    towerResults.forEach((t: any, i: number) => {
      // tower body
      ctx.fillStyle = TOWER_COLORS[i];
      ctx.beginPath();
      ctx.moveTo(t.position.x, t.position.y - 18);
      ctx.lineTo(t.position.x - 10, t.position.y + 10);
      ctx.lineTo(t.position.x + 10, t.position.y + 10);
      ctx.closePath();
      ctx.fill();

      // label
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
    });

  }, [result, users, activeUser]);

  return (
    <div className="mx-auto max-w-screen-2xl p-4">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-text-primary">5G Simulator</h1>
        <p className="text-sm text-text-secondary">
          3 towers, 2 users — use Arrow Keys (User 1) / WASD (User 2) / Tab to switch
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* Canvas */}
        <div className="rounded-lg border border-border bg-bg-surface p-4">
          <canvas
            ref={canvasRef}
            className="w-full rounded border border-border"
            style={{ maxHeight: 600, aspectRatio: `${CANVAS_W}/${CANVAS_H}` }}
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
            <span className="ml-auto">Tab = switch user</span>
          </div>
        </div>

        {/* Tower Parameter Cards */}
        <div className="flex flex-col gap-3">
          {loading && (
            <span className="text-xs text-accent-green animate-pulse">Updating…</span>
          )}

          {(result?.towers || DEFAULT_TOWERS).map((t: any, i: number) => {
            const params = t.parameters || t;
            const conns = t.connections || [];
            return (
              <div
                key={i}
                className="rounded-lg border bg-bg-surface p-4 transition-colors"
                style={{ borderColor: TOWER_COLORS[i] + "66" }}
              >
                <div className="mb-2 flex items-center gap-2">
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

                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div className="flex justify-between text-text-secondary">
                    <span>Elements</span>
                    <span className="font-mono text-text-primary">{params.num_elements}</span>
                  </div>
                  <div className="flex justify-between text-text-secondary">
                    <span>Spacing</span>
                    <span className="font-mono text-text-primary">{params.element_spacing}λ</span>
                  </div>
                  <div className="flex justify-between text-text-secondary">
                    <span>Freq</span>
                    <span className="font-mono text-text-primary">
                      {((params.frequency || 28e9) / 1e9).toFixed(1)} GHz
                    </span>
                  </div>
                  <div className="flex justify-between text-text-secondary">
                    <span>Steer</span>
                    <span className="font-mono text-text-primary">
                      {(params.steering_angle ?? 0).toFixed(1)}°
                    </span>
                  </div>
                  <div className="flex justify-between text-text-secondary">
                    <span>Window</span>
                    <span className="font-mono text-text-primary">{params.window_type}</span>
                  </div>
                  <div className="flex justify-between text-text-secondary">
                    <span>SNR</span>
                    <span className="font-mono text-text-primary">{params.snr}</span>
                  </div>
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
