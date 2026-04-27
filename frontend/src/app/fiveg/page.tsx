"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { simulate5G } from "@/lib/api";
import {
  TOWER_COLORS, USER_COLORS, DEFAULT_TOWERS, DEFAULT_USERS,
  SignalLegend, VizCheckboxes, TowerCard, UserCard,
} from "./components";

// Canvas renders at the actual element size — no fixed dimensions

export default function FiveGPage() {
  const [towers, setTowers] = useState(DEFAULT_TOWERS);
  const [users, setUsers] = useState(DEFAULT_USERS);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [globalSnr, setGlobalSnr] = useState(250);
  const [viz, setViz] = useState<Record<string, boolean>>({
    beams: true, sidelobes: true, coverage: true, connections: true, grid: true,
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingTowerRef = useRef<number | null>(null);
  const draggingUserRef = useRef<number | null>(null);
  const towersRef = useRef(towers);
  const usersRef = useRef(users);
  towersRef.current = towers;
  usersRef.current = users;

  const abortRef = useRef<AbortController | null>(null);
  const runSim = useCallback(async (t: typeof towers, u: typeof users) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const towersWithGlobals = t.map(tw => ({
        ...tw,
        snr: globalSnr >= 1000 ? 1000 : globalSnr,
        window_type: "kaiser",
        kaiser_beta: tw.kaiser_beta ?? 6.0,
      }));
      const data = await simulate5G({
        towers: towersWithGlobals,
        users: u,

      });
      if (!controller.signal.aborted) setResult(data);
    } catch (e: any) {
      if (e?.name !== "AbortError") console.warn("5G sim error:", e?.message);
    }
    if (!controller.signal.aborted) setLoading(false);
  }, [globalSnr]);

  useEffect(() => { runSim(towers, users); }, []);

  const debRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(() => runSim(towers, users), 400);
  }, [towers, users, globalSnr]);


  // Keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      let dx = 0, dy = 0;
      const step = 20;
      if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key)) {
        if (e.key === "ArrowUp") dy = -step;
        if (e.key === "ArrowDown") dy = step;
        if (e.key === "ArrowLeft") dx = -step;
        if (e.key === "ArrowRight") dx = step;
        e.preventDefault();
        setUsers(prev => {
          const next = [...prev];
          next[0] = { x: Math.max(20, Math.min(780, next[0].x + dx)), y: Math.max(20, Math.min(780, next[0].y + dy)) };
          runSim(towers, next);
          return next;
        });
      }
      if (["w","W","a","A","s","S","d","D"].includes(e.key)) {
        if (e.key.toLowerCase() === "w") dy = -step;
        if (e.key.toLowerCase() === "s") dy = step;
        if (e.key.toLowerCase() === "a") dx = -step;
        if (e.key.toLowerCase() === "d") dx = step;
        e.preventDefault();
        setUsers(prev => {
          const next = [...prev];
          next[1] = { x: Math.max(20, Math.min(780, next[1].x + dx)), y: Math.max(20, Math.min(780, next[1].y + dy)) };
          runSim(towers, next);
          return next;
        });
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [towers, runSim]);

  // Canvas coords
  const canvasToSim = useCallback((cx: number, cy: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const S = Math.min(rect.width, rect.height);
    const ox = (rect.width - S) / 2, oy = (rect.height - S) / 2;
    return {
      x: ((cx - rect.left - ox) / S) * 800,
      y: ((cy - rect.top - oy) / S) * 800,
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = canvasToSim(e.clientX, e.clientY);

    // Check towers
    const tRes = result?.towers || [];
    for (let i = 0; i < tRes.length; i++) {
      const t = tRes[i];
      const dx = x - t.position.x, dy = y - t.position.y;
      if (Math.sqrt(dx * dx + dy * dy) < 25) { draggingTowerRef.current = i; e.preventDefault(); return; }
    }
    // Check users
    const u = usersRef.current;
    for (let i = 0; i < u.length; i++) {
      const dx = x - u[i].x, dy = y - u[i].y;
      if (Math.sqrt(dx * dx + dy * dy) < 18) { draggingUserRef.current = i; e.preventDefault(); return; }
    }
  }, [canvasToSim, result]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = canvasToSim(e.clientX, e.clientY);
    if (draggingTowerRef.current !== null) {
      const i = draggingTowerRef.current;
      setTowers(prev => prev.map((t, idx) => idx === i ? { ...t, position: { x: Math.max(20, Math.min(780, x)), y: Math.max(20, Math.min(780, y)) } } : t));
    } else if (draggingUserRef.current !== null) {
      const i = draggingUserRef.current;
      setUsers(prev => prev.map((u, idx) => idx === i ? { x: Math.max(20, Math.min(780, x)), y: Math.max(20, Math.min(780, y)) } : u));
    }
  }, [canvasToSim]);

  const handleMouseUp = useCallback(() => {
    const wasDragging = draggingTowerRef.current !== null || draggingUserRef.current !== null;
    draggingTowerRef.current = null;
    draggingUserRef.current = null;
    if (wasDragging) runSim(towersRef.current, usersRef.current);
  }, [runSim]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => { e.preventDefault(); }, []);

  // ═══════════════ CANVAS RENDERING ═══════════════
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // The sim uses 800x800 coordinate space; we map it to a centered square
    const S = Math.min(W, H);
    const ox = (W - S) / 2, oy = (H - S) / 2;
    const scale = S / 800;
    const CENTER = ox + S / 2;
    const CY = oy + S / 2;
    const RADIUS = S / 2 - 40 * scale;

    // Helper: sim coords (0-800) to canvas pixel coords
    const sx = (x: number) => ox + x * scale;
    const sy = (y: number) => oy + y * scale;

    // BG
    ctx.fillStyle = "#080c14";
    ctx.fillRect(0, 0, W, H);

    // Grid
    if (viz.grid) {
      ctx.strokeStyle = "#111827"; ctx.lineWidth = 0.5;
      for (let i = 1; i <= 4; i++) {
        ctx.beginPath(); ctx.arc(CENTER, CY, RADIUS * i / 4, 0, Math.PI * 2);
        ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.beginPath(); ctx.moveTo(CENTER, CY - RADIUS - 10); ctx.lineTo(CENTER, CY + RADIUS + 10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(CENTER - RADIUS - 10, CY); ctx.lineTo(CENTER + RADIUS + 10, CY); ctx.stroke();
      const d = RADIUS + 10;
      ctx.beginPath(); ctx.moveTo(CENTER - d * 0.707, CY - d * 0.707); ctx.lineTo(CENTER + d * 0.707, CY + d * 0.707); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(CENTER + d * 0.707, CY - d * 0.707); ctx.lineTo(CENTER - d * 0.707, CY + d * 0.707); ctx.stroke();

      ctx.fillStyle = "#4d5568"; ctx.font = `${11 * scale}px monospace`; ctx.textAlign = "center";
      ctx.fillText("90°", CENTER, CY - RADIUS - 14);
      ctx.fillText("-90°", CENTER, CY + RADIUS + 20);
      ctx.textAlign = "left"; ctx.fillText("0°", CENTER + RADIUS + 8, CY + 4);
      ctx.textAlign = "right"; ctx.fillText("180°", CENTER - RADIUS - 8, CY + 4);
    }

    const towerResults = result?.towers || [];
    const userResults = result?.users || [];

    // ── Coverage circles ──
    if (viz.coverage) {
      towerResults.forEach((t: any, i: number) => {
        const tx = sx(t.position.x), ty = sy(t.position.y);
        const maxR = t.coverage_radius * scale;
        ctx.beginPath(); ctx.arc(tx, ty, maxR, 0, Math.PI * 2);
        ctx.strokeStyle = TOWER_COLORS[i] + "20"; ctx.lineWidth = 1;
        ctx.setLineDash([6, 6]); ctx.stroke(); ctx.setLineDash([]);
      });
    }

    // ── Beam patterns (MU-MIMO: one beam per connected user) ──
    if (viz.beams) {
      towerResults.forEach((t: any, i: number) => {
        const tx = sx(t.position.x), ty = sy(t.position.y);
        const maxR = t.coverage_radius * scale;
        const conns: any[] = t.connections || [];
        const beams: any[] = t.user_beams || [];

        // Collect beam renders: one per connected user, or the idle beam if no users
        const beamRenders: { profile: any; rotOff: number }[] = [];

        if (conns.length > 0 && beams.length > 0) {
          // Connected: render a beam for EACH connected user
          for (const beam of beams) {
            if (!beam?.beam_profile) continue;
            const uid = beam.user_id;
            const u = userResults[uid];
            let rotOff = 0;
            if (u) {
              const dx = sx(u.position.x) - tx;
              const dy = sy(u.position.y) - ty;
              const userDirScreen = Math.atan2(dy, dx);
              const steerRad = (beam.steering_angle || 0) * Math.PI / 180;
              rotOff = userDirScreen - (Math.PI / 2 - steerRad);
            }
            beamRenders.push({ profile: beam.beam_profile, rotOff });
          }
        }

        // Fallback: idle beam (no connected users)
        if (beamRenders.length === 0 && t.beam_profile) {
          beamRenders.push({ profile: t.beam_profile, rotOff: 0 });
        }

        // Draw each beam
        for (const { profile, rotOff } of beamRenders) {
          if (!profile?.angles || !profile?.magnitudes_db) continue;
          const angles = profile.angles as number[];
          const magsDb = profile.magnitudes_db as number[];

          const amps = magsDb.map((db: number) => {
            const clamped = Math.max(-40, Math.min(0, db));
            return Math.pow(10, clamped / 20);
          });

          ctx.beginPath();
          for (let j = 0; j < angles.length; j++) {
            const amp = amps[j];
            const r = viz.sidelobes ? amp * maxR : (amp > 0.5 ? amp * maxR : amp * maxR * 0.1);
            const ca = Math.PI / 2 - angles[j] * Math.PI / 180 + rotOff;
            const px = tx + r * Math.cos(ca), py = ty + r * Math.sin(ca);
            j === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          }
          for (let j = angles.length - 1; j >= 0; j--) {
            const r = amps[j] * maxR * 0.08;
            const ca = Math.PI / 2 - angles[j] * Math.PI / 180 + rotOff + Math.PI;
            const px = tx + r * Math.cos(ca), py = ty + r * Math.sin(ca);
            ctx.lineTo(px, py);
          }
          ctx.closePath();
          const grad = ctx.createRadialGradient(tx, ty, 0, tx, ty, maxR);
          grad.addColorStop(0, TOWER_COLORS[i] + "30");
          grad.addColorStop(0.5, TOWER_COLORS[i] + "18");
          grad.addColorStop(1, TOWER_COLORS[i] + "05");
          ctx.fillStyle = grad; ctx.fill();
          ctx.strokeStyle = TOWER_COLORS[i] + "55"; ctx.lineWidth = 1; ctx.stroke();
        }
      });
    }



    // ── Connection lines (LOS) ──
    if (viz.connections) {
      towerResults.forEach((t: any, i: number) => {
        (t.connections || []).forEach((conn: any) => {
          const u = userResults[conn.user_id];
          if (!u) return;
          const tpx = sx(t.position.x), tpy = sy(t.position.y);
          const upx = sx(u.position.x), upy = sy(u.position.y);

          // Direct LOS line
          ctx.save();
          ctx.shadowColor = "#22c55e";
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.moveTo(tpx, tpy); ctx.lineTo(upx, upy);
          ctx.strokeStyle = "#22c55ecc";
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();

          // Signal label at midpoint
          const mx = (tpx + upx) / 2, my = (tpy + upy) / 2;
          ctx.fillStyle = "#e2e5ed";
          ctx.font = `${9 * scale}px monospace`;
          ctx.textAlign = "center";
          ctx.fillText(`${conn.distance} m (LOS)`, mx, my - 6 * scale);
          ctx.fillStyle = conn.signal_dbm > -60 ? "#22c55e" : conn.signal_dbm > -90 ? "#f59e0b" : "#ef4444";
          ctx.fillText(`${conn.signal_dbm} dBm`, mx, my + 6 * scale);
        });
      });
    }

    // ── Draw towers (triangles) ──
    towerResults.forEach((t: any, i: number) => {
      const isDrag = draggingTowerRef.current === i;
      const tpx = sx(t.position.x), tpy = sy(t.position.y);
      if (isDrag) { ctx.shadowColor = TOWER_COLORS[i]; ctx.shadowBlur = 20; }

      ctx.fillStyle = TOWER_COLORS[i];
      ctx.beginPath();
      ctx.moveTo(tpx, tpy - 18 * scale);
      ctx.lineTo(tpx - 12 * scale, tpy + 10 * scale);
      ctx.lineTo(tpx + 12 * scale, tpy + 10 * scale);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.beginPath(); ctx.arc(tpx, tpy - 4 * scale, 16 * scale, 0, Math.PI * 2);
      ctx.strokeStyle = TOWER_COLORS[i] + (isDrag ? "cc" : "44");
      ctx.lineWidth = 1.5; ctx.stroke();

      ctx.fillStyle = "#e4e6ef"; ctx.font = `bold ${12 * scale}px monospace`; ctx.textAlign = "center";
      ctx.fillText(`T${i + 1}`, tpx, tpy + 26 * scale);
    });

    // ── Draw users (circles) ──
    users.forEach((u, i) => {
      const upx = sx(u.x), upy = sy(u.y);
      ctx.beginPath(); ctx.arc(upx, upy, 12 * scale, 0, Math.PI * 2);
      ctx.fillStyle = USER_COLORS[i] + "cc"; ctx.fill();
      ctx.strokeStyle = USER_COLORS[i]; ctx.lineWidth = 2; ctx.stroke();

      ctx.beginPath(); ctx.arc(upx, upy, 18 * scale, 0, Math.PI * 2);
      ctx.strokeStyle = USER_COLORS[i] + "33"; ctx.lineWidth = 1; ctx.stroke();

      ctx.fillStyle = "#fff"; ctx.font = `bold ${10 * scale}px monospace`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(`U${i + 1}`, upx, upy);
      ctx.textBaseline = "alphabetic";
    });

  }, [result, users, viz]);

  const updateTowerParam = (i: number, key: string, value: number) => {
    setTowers(prev => prev.map((t, idx) => idx === i ? { ...t, [key]: value } : t));
  };

  const resetAll = () => {
    setTowers(DEFAULT_TOWERS);
    setUsers(DEFAULT_USERS);
    setGlobalSnr(250);
    setTimeout(() => runSim(DEFAULT_TOWERS, DEFAULT_USERS), 50);
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 44px)", overflow: "hidden" }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-1.5" style={{ borderBottom: "1px solid #1a1f2e" }}>
        <button onClick={resetAll}
          className="rounded-md border border-border bg-bg-surface px-3 py-1 text-[11px] text-text-muted hover:text-text-primary hover:border-red-500/50 transition-colors">
          ↺ Reset All
        </button>
        <div className="flex items-center gap-3">
          <div className="snr-control">
            <label>SNR</label>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-green" />
            <input type="range" min={0} max={1000} step={10} value={globalSnr}
              onChange={e => setGlobalSnr(Number(e.target.value))} />
            <span className="snr-value">{globalSnr}</span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex gap-0 overflow-hidden">
        {/* Polar Canvas Area */}
        <div className="flex-1 flex items-center justify-center relative" style={{ minWidth: 0, overflow: "hidden" }}>
          <div className="relative" style={{ width: "100%", height: "100%" }}>
            <SignalLegend />
            <VizCheckboxes viz={viz} setViz={setViz} />
            <canvas
              ref={canvasRef}
              className="rounded-xl w-full h-full cursor-grab active:cursor-grabbing"
              style={{ border: "1px solid #1a1f2e" }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onContextMenu={handleContextMenu}
            />
            {/* Bottom canvas controls */}
            <div className="absolute bottom-3 right-3 flex items-center gap-2" style={{ zIndex: 10 }}>
              <button className="rounded-md border border-border bg-bg-surface/90 backdrop-blur-sm px-2.5 py-1 text-[10px] text-text-muted hover:text-text-primary flex items-center gap-1">
                <span>⊞</span> Array Factor (dB)
              </button>
            </div>
          </div>
          {/* Keyboard hint */}
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-4 text-[10px] text-text-muted" style={{ zIndex: 10 }}>
            <span className="flex items-center gap-1">
              <span className="font-bold" style={{ color: USER_COLORS[0] }}>N</span> User 1: Arrows
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: USER_COLORS[1] }} />
              User 2: WASD
            </span>

          </div>
        </div>

        {/* Right Panel */}
        <div className="flex-shrink-0 flex flex-col border-l border-border overflow-y-auto overflow-x-hidden" style={{ background: "#0a0e17", width: 420, minWidth: 420, maxWidth: 420 }}>
          {/* TOWERS */}
          <div className="p-3">
            <h2 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-3">TOWERS</h2>
            <div className="space-y-3">
              {towers.map((tower, i) => (
                <TowerCard key={i} tower={tower} tResult={(result?.towers || [])[i]}
                  index={i} updateParam={updateTowerParam}
                  userPositions={users.map(u => ({x: u.x, y: u.y}))} />
              ))}
            </div>
          </div>

          {/* USERS */}
          <div className="p-3 border-t border-border">
            <h2 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-3">USERS</h2>
            <div className="space-y-3">
              {(result?.users || []).map((u: any, i: number) => (
                <UserCard key={i} user={u} index={i} towers={result?.towers || []} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
