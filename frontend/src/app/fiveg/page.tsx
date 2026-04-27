"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { simulate5G } from "@/lib/api";
import {
  TOWER_COLORS, USER_COLORS, DEFAULT_TOWERS, DEFAULT_USERS, DEFAULT_OBSTACLES,
  SignalLegend, VizCheckboxes, TowerCard, UserCard,
} from "./components";

// Canvas renders at the actual element size — no fixed dimensions

export default function FiveGPage() {
  const [towers, setTowers] = useState(DEFAULT_TOWERS);
  const [users, setUsers] = useState(DEFAULT_USERS);
  const [obstacles, setObstacles] = useState(DEFAULT_OBSTACLES);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [globalSnr, setGlobalSnr] = useState(250);
  const [globalWindow, setGlobalWindow] = useState("kaiser");
  const [globalBeta, setGlobalBeta] = useState(6.0);
  const [addObstacleMode, setAddObstacleMode] = useState(false);
  const [viz, setViz] = useState<Record<string, boolean>>({
    beams: true, sidelobes: true, coverage: true, connections: true, grid: true,
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingTowerRef = useRef<number | null>(null);
  const draggingUserRef = useRef<number | null>(null);
  const draggingObstacleRef = useRef<number | null>(null);
  const towersRef = useRef(towers);
  const usersRef = useRef(users);
  const obstaclesRef = useRef(obstacles);
  towersRef.current = towers;
  usersRef.current = users;
  obstaclesRef.current = obstacles;

  const abortRef = useRef<AbortController | null>(null);
  const runSim = useCallback(async (t: typeof towers, u: typeof users, obs?: typeof obstacles) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const towersWithGlobals = t.map(tw => ({
        ...tw,
        snr: globalSnr >= 1000 ? 1000 : globalSnr,
        window_type: globalWindow,
        kaiser_beta: globalBeta,
      }));
      const data = await simulate5G({
        towers: towersWithGlobals,
        users: u,
        obstacles: obs ?? obstaclesRef.current,
      });
      if (!controller.signal.aborted) setResult(data);
    } catch (e: any) {
      if (e?.name !== "AbortError") console.warn("5G sim error:", e?.message);
    }
    if (!controller.signal.aborted) setLoading(false);
  }, [globalSnr, globalWindow, globalBeta]);

  useEffect(() => { runSim(towers, users, obstacles); }, []);

  const debRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(() => runSim(towers, users, obstacles), 400);
  }, [towers, users, obstacles, globalSnr, globalWindow, globalBeta]);


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

    // Right-click to remove obstacle
    if (e.button === 2) {
      const obs = obstaclesRef.current;
      for (let i = 0; i < obs.length; i++) {
        const o = obs[i];
        if (Math.abs(x - o.x) < o.width / 2 && Math.abs(y - o.y) < o.height / 2) {
          setObstacles(prev => prev.filter((_, idx) => idx !== i));
          e.preventDefault();
          return;
        }
      }
      return;
    }

    // Add obstacle mode — TOP PRIORITY: place obstacle anywhere
    if (addObstacleMode && obstaclesRef.current.length < 5) {
      const newId = obstaclesRef.current.length > 0
        ? Math.max(...obstaclesRef.current.map(o => o.id)) + 1
        : 0;
      setObstacles(prev => [...prev, { id: newId, x, y, width: 60, height: 60, reflection_loss_db: 6 }]);
      setAddObstacleMode(false);
      e.preventDefault();
      return;
    }

    // Check obstacles for dragging
    const obs = obstaclesRef.current;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (Math.abs(x - o.x) < o.width / 2 && Math.abs(y - o.y) < o.height / 2) {
        draggingObstacleRef.current = i;
        e.preventDefault();
        return;
      }
    }

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
  }, [canvasToSim, result, addObstacleMode]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = canvasToSim(e.clientX, e.clientY);
    if (draggingObstacleRef.current !== null) {
      const i = draggingObstacleRef.current;
      setObstacles(prev => prev.map((o, idx) => idx === i ? { ...o, x: Math.max(40, Math.min(760, x)), y: Math.max(40, Math.min(760, y)) } : o));
    } else if (draggingTowerRef.current !== null) {
      const i = draggingTowerRef.current;
      setTowers(prev => prev.map((t, idx) => idx === i ? { ...t, position: { x: Math.max(20, Math.min(780, x)), y: Math.max(20, Math.min(780, y)) } } : t));
    } else if (draggingUserRef.current !== null) {
      const i = draggingUserRef.current;
      setUsers(prev => prev.map((u, idx) => idx === i ? { x: Math.max(20, Math.min(780, x)), y: Math.max(20, Math.min(780, y)) } : u));
    }
  }, [canvasToSim]);

  const handleMouseUp = useCallback(() => {
    const wasDragging = draggingTowerRef.current !== null || draggingUserRef.current !== null || draggingObstacleRef.current !== null;
    draggingTowerRef.current = null;
    draggingUserRef.current = null;
    draggingObstacleRef.current = null;
    if (wasDragging) runSim(towersRef.current, usersRef.current, obstaclesRef.current);
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

    // ── Beam patterns ──
    if (viz.beams) {
      towerResults.forEach((t: any, i: number) => {
        const tx = sx(t.position.x), ty = sy(t.position.y);
        const maxR = t.coverage_radius * scale;
        const conns: any[] = t.connections || [];
        const beams: any[] = t.user_beams || [];

        // Choose profile + direction:
        // - Connected → use user_beam profile, aim toward first connected user
        // - Idle → use primary beam_profile, aim by manual steering slider
        let profile: any;
        let rotOff: number;

        if (conns.length > 0 && beams.length > 0 && beams[0]?.beam_profile) {
          // Connected: auto-steer toward first connected user
          profile = beams[0].beam_profile;
          const uid = beams[0].user_id;
          const u = userResults[uid];
          if (u) {
            // Compute small correction: align profile peak to actual user screen direction
            const dx = sx(u.position.x) - tx;
            const dy = sy(u.position.y) - ty;
            const userDirScreen = Math.atan2(dy, dx); // standard canvas: 0°=right
            const steerRad = (beams[0].steering_angle || 0) * Math.PI / 180;
            // Profile peak is at steerRad (backend convention). Its canvas pos = π/2 - steerRad
            rotOff = userDirScreen - (Math.PI / 2 - steerRad);
          } else {
            rotOff = 0;
          }
        } else {
          // Idle: no correction needed
          profile = t.beam_profile;
          rotOff = 0;
        }

        if (!profile?.angles || !profile?.magnitudes_db) return;
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
          // Backend angles: atan2(dx,dy) convention. Convert to canvas cos/sin: negate + π/2
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
      });
    }

    // ── Draw obstacles (buildings) ──
    obstacles.forEach((obs, i) => {
      const ox = sx(obs.x), oy = sy(obs.y);
      const ow = obs.width * scale, oh = obs.height * scale;

      // Building body
      ctx.fillStyle = "#64748b44";
      ctx.fillRect(ox - ow / 2, oy - oh / 2, ow, oh);
      ctx.strokeStyle = "#94a3b888";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(ox - ow / 2, oy - oh / 2, ow, oh);

      // Building icon (grid lines)
      ctx.strokeStyle = "#94a3b844";
      ctx.lineWidth = 0.5;
      for (let r = 1; r < 3; r++) {
        const ry = oy - oh / 2 + (r / 3) * oh;
        ctx.beginPath(); ctx.moveTo(ox - ow / 2, ry); ctx.lineTo(ox + ow / 2, ry); ctx.stroke();
      }
      for (let c = 1; c < 3; c++) {
        const cx2 = ox - ow / 2 + (c / 3) * ow;
        ctx.beginPath(); ctx.moveTo(cx2, oy - oh / 2); ctx.lineTo(cx2, oy + oh / 2); ctx.stroke();
      }

      // Label
      ctx.fillStyle = "#94a3b8";
      ctx.font = `bold ${9 * scale}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(`B${i + 1}`, ox, oy + 3 * scale);
    });

    // ── Connection lines (LOS + NLOS paths) ──
    if (viz.connections) {
      towerResults.forEach((t: any, i: number) => {
        (t.connections || []).forEach((conn: any) => {
          const u = userResults[conn.user_id];
          if (!u) return;
          const tpx = sx(t.position.x), tpy = sy(t.position.y);
          const upx = sx(u.position.x), upy = sy(u.position.y);
          const paths: any[] = conn.paths || [];

          if (paths.length === 0) {
            // Fallback: simple direct line
            ctx.beginPath();
            ctx.moveTo(tpx, tpy); ctx.lineTo(upx, upy);
            ctx.strokeStyle = USER_COLORS[conn.user_id] + "88";
            ctx.lineWidth = 2;
            ctx.stroke();
          }

          paths.forEach((p: any) => {
            const isLOS = p.type === "LOS";
            const color = isLOS ? "#22c55e" : "#f59e0b";

            ctx.save();
            ctx.shadowColor = color;
            ctx.shadowBlur = 6;

            if (isLOS) {
              // Solid line: tower → user
              ctx.beginPath();
              ctx.moveTo(tpx, tpy); ctx.lineTo(upx, upy);
              ctx.strokeStyle = color + "cc";
              ctx.lineWidth = 2;
              ctx.setLineDash([]);
              ctx.stroke();
            } else if (p.via) {
              // Dashed line: tower → bounce → user
              const vx = sx(p.via.x), vy = sy(p.via.y);
              ctx.beginPath();
              ctx.moveTo(tpx, tpy); ctx.lineTo(vx, vy); ctx.lineTo(upx, upy);
              ctx.strokeStyle = color + "cc";
              ctx.lineWidth = 1.5;
              ctx.setLineDash([6, 4]);
              ctx.stroke();
              ctx.setLineDash([]);

              // Bounce point diamond
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.moveTo(vx, vy - 5 * scale);
              ctx.lineTo(vx + 5 * scale, vy);
              ctx.lineTo(vx, vy + 5 * scale);
              ctx.lineTo(vx - 5 * scale, vy);
              ctx.closePath();
              ctx.fill();
            }
            ctx.restore();
          });

          // Signal label at midpoint
          const mx = (tpx + upx) / 2, my = (tpy + upy) / 2;
          const pathType = conn.los_blocked ? "NLOS" : "LOS";
          ctx.fillStyle = "#e2e5ed";
          ctx.font = `${9 * scale}px monospace`;
          ctx.textAlign = "center";
          ctx.fillText(`${conn.distance} m (${pathType})`, mx, my - 6 * scale);
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

  }, [result, users, obstacles, viz]);

  const updateTowerParam = (i: number, key: string, value: number) => {
    setTowers(prev => prev.map((t, idx) => idx === i ? { ...t, [key]: value } : t));
  };

  const resetAll = () => {
    setTowers(DEFAULT_TOWERS);
    setUsers(DEFAULT_USERS);
    setObstacles(DEFAULT_OBSTACLES);
    setGlobalSnr(250);
    setGlobalWindow("kaiser");
    setGlobalBeta(6.0);
    setAddObstacleMode(false);
    setTimeout(() => runSim(DEFAULT_TOWERS, DEFAULT_USERS, DEFAULT_OBSTACLES), 50);
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 44px)", overflow: "hidden" }}>
      {/* Top bar with SNR */}
      <div className="flex items-center justify-end px-5 py-1.5" style={{ borderBottom: "1px solid #1a1f2e" }}>
        <div className="snr-control">
          <label>SNR</label>
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-green" />
          <input type="range" min={0} max={1000} step={10} value={globalSnr}
            onChange={e => setGlobalSnr(Number(e.target.value))} />
          <span className="snr-value">{globalSnr}</span>
        </div>
        <button className="ml-3 text-text-muted hover:text-text-secondary text-sm">⚙</button>
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
              className={`rounded-xl w-full h-full ${addObstacleMode ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
              style={{ border: addObstacleMode ? "1px solid #f59e0b66" : "1px solid #1a1f2e" }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onContextMenu={handleContextMenu}
            />
            {/* Bottom canvas controls */}
            <div className="absolute bottom-3 right-3 flex items-center gap-2" style={{ zIndex: 10 }}>
              <button
                className={`rounded-md border px-2.5 py-1 text-[10px] flex items-center gap-1 transition-colors ${
                  addObstacleMode
                    ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                    : 'border-border bg-bg-surface/90 backdrop-blur-sm text-text-muted hover:text-text-primary'
                }`}
                onClick={() => setAddObstacleMode(!addObstacleMode)}
              >
                <span>🏢</span> {addObstacleMode ? 'Click to place…' : `Add Obstacle (${obstacles.length}/5)`}
              </button>
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
            <span className="flex items-center gap-1">
              <span className="text-amber-400">🏢</span> Right-click to remove
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

      {/* Global Parameters Bar */}
      <div className="global-param-bar">
        <div className="param-item">
          <span className="param-label">Elements</span>
          <span className="param-value">{towers[0]?.num_elements || 32}</span>
        </div>
        <div className="param-item">
          <span className="param-label">Spacing (λ)</span>
          <span className="param-value">{towers[0]?.element_spacing || 0.5}</span>
        </div>
        <div className="param-item">
          <span className="param-label">Frequency</span>
          <span className="param-value">{((towers[0]?.frequency || 28e9) / 1e9).toFixed(1)} GHz</span>
        </div>
        <div className="param-item">
          <span className="param-label">SNR</span>
          <span className="param-value">{globalSnr}</span>
        </div>
        <div className="param-item">
          <span className="param-label">Window</span>
          <select value={globalWindow} onChange={e => setGlobalWindow(e.target.value)}>
            <option value="kaiser">Kaiser (β)</option>
            <option value="hamming">Hamming</option>
            <option value="hanning">Hanning</option>
            <option value="blackman">Blackman</option>
            <option value="rectangular">Rectangular</option>
          </select>
        </div>
        <div className="param-item">
          <span className="param-label">β</span>
          <span className="param-value">{globalBeta.toFixed(1)}</span>
          <input type="range" min={0} max={20} step={0.5} value={globalBeta}
            onChange={e => setGlobalBeta(Number(e.target.value))} />
        </div>
        <button onClick={resetAll}>Reset All</button>
      </div>
    </div>
  );
}
