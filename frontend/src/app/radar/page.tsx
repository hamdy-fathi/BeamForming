"use client";
import { useState, useCallback, useEffect, useRef } from "react";
import { radarFullSweep } from "@/lib/api";
import { Target, Detection, MatchedDetection, DEFAULT_TARGETS, MAX_TARGETS } from "./helpers";
import GroundTruthMap from "./GroundTruthMap";
import RadarPPI from "./RadarPPI";
import DetectionTable from "./DetectionTable";

export default function RadarPage() {
  const [targets, setTargets] = useState<Target[]>(DEFAULT_TARGETS);
  const [beamWidth, setBeamWidth] = useState(10);
  const [scanSpeed, setScanSpeed] = useState(30);
  const [numElements, setNumElements] = useState(32);
  const [snr, setSnr] = useState(200);
  const [windowType, setWindowType] = useState("hamming");
  const [detectionThreshold, setDetectionThreshold] = useState(12);
  const [sweepResult, setSweepResult] = useState<any>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [matched, setMatched] = useState<MatchedDetection[]>([]);
  const [revealedDetectionIds, setRevealedDetectionIds] = useState<number[]>([]);
  const [sweepAngle, setSweepAngle] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editTarget, setEditTarget] = useState<number | null>(null);
  const autoSweepTimerRef = useRef<number | null>(null);

  const runSweep = useCallback(async () => {
    setLoading(true);
    try {
      const d = await radarFullSweep({
        beam_width: beamWidth, scan_speed: scanSpeed, targets,
        num_elements: numElements, element_spacing: 0.5, frequency: 3e9,
        window_type: windowType, snr, detection_threshold: detectionThreshold,
      });
      setSweepResult(d);
      setDetections(d.detections || []);
      setMatched(d.matched || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [beamWidth, scanSpeed, targets, numElements, snr, windowType, detectionThreshold]);

  const handleScanToggle = useCallback(async () => {
    if (scanning) {
      setScanning(false);
      setRevealedDetectionIds([]);
      return;
    }
    setScanning(true);
  }, [scanning]);

  useEffect(() => {
    // If scene changes while scan is stopped, drop stale detections/results.
    if (scanning) return;
    setSweepResult(null);
    setDetections([]);
    setMatched([]);
    setRevealedDetectionIds([]);
    setSweepAngle(0);
  }, [targets, beamWidth, scanSpeed, numElements, snr, windowType, detectionThreshold, scanning]);

  useEffect(() => {
    if (!scanning) {
      if (autoSweepTimerRef.current !== null) {
        window.clearTimeout(autoSweepTimerRef.current);
        autoSweepTimerRef.current = null;
      }
      return;
    }

    if (autoSweepTimerRef.current !== null) {
      window.clearTimeout(autoSweepTimerRef.current);
    }
    autoSweepTimerRef.current = window.setTimeout(() => {
      void runSweep();
    }, 220);

    return () => {
      if (autoSweepTimerRef.current !== null) {
        window.clearTimeout(autoSweepTimerRef.current);
        autoSweepTimerRef.current = null;
      }
    };
  }, [scanning, runSweep]);

  const addTarget = () => {
    if (targets.length >= MAX_TARGETS) return;
    setTargets(prev => [...prev, { id: prev.length, distance: 20000, angle: Math.random() * 360, size: 20 }]);
  };

  const removeTarget = (i: number) => {
    setTargets(prev => prev.filter((_, idx) => idx !== i).map((t, idx) => ({ ...t, id: idx })));
    if (editTarget === i) setEditTarget(null);
  };

  const updateTarget = (i: number, key: keyof Target, val: number) => {
    setTargets(prev => prev.map((t, idx) => idx === i ? { ...t, [key]: val } : t));
  };

  return (
    <div className="mx-auto max-w-screen-2xl p-4">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-text-primary">Radar Simulator</h1>
        <p className="text-sm text-text-secondary">Dual-map radar with signal-based detection — place targets on the left, the radar discovers them on the right</p>
      </div>

      {/* Dual maps */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_320px] mb-4">
        {/* Ground Truth Map */}
        <div className="rounded-xl border border-blue-900/30 bg-bg-surface p-4">
          <GroundTruthMap targets={targets} setTargets={setTargets} onTargetsChanged={() => {}} />
        </div>

        {/* Radar PPI */}
        <div className="rounded-xl border border-green-900/30 bg-bg-surface p-4">
          <RadarPPI
            sweepResult={sweepResult}
            detections={detections}
            scanning={scanning}
            scanSpeed={scanSpeed}
            beamWidth={beamWidth}
            sweepAngle={sweepAngle}
            setSweepAngle={setSweepAngle}
            onRevealedDetectionIdsChange={setRevealedDetectionIds}
          />
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-3">
          {/* Actions */}
          <div className="flex gap-2">
            <button onClick={handleScanToggle} disabled={loading} className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all disabled:opacity-50 ${scanning ? "bg-red-500/20 text-red-400 border border-red-500/40" : "bg-green-500/20 text-green-400 border border-green-500/40"}`}>
              {scanning ? "⏹ Stop" : "▶ Scan"}
            </button>
            <button onClick={runSweep} disabled={loading} className="flex-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-400 font-medium hover:bg-amber-500/20 disabled:opacity-50 transition-all">
              {loading ? "Computing…" : "⟳ Sweep"}
            </button>
          </div>

          {/* Scan params */}
          <div className="rounded-xl border border-green-900/30 bg-bg-surface p-3 space-y-2.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-green-400">Scan Parameters</h3>
            <div className="flex flex-col gap-0.5">
              <div className="flex justify-between text-[11px]"><span className="text-text-secondary">Beam Width</span><span className="font-mono text-green-400">{beamWidth}°</span></div>
              <input type="range" min={1} max={90} value={beamWidth} onChange={e => setBeamWidth(Number(e.target.value))} />
              <p className="text-[9px] text-text-muted">{beamWidth > 20 ? "Wide → fast but inaccurate" : beamWidth < 5 ? "Narrow → slow but precise" : "Balanced"}</p>
            </div>
            <div className="flex flex-col gap-0.5">
              <div className="flex justify-between text-[11px]"><span className="text-text-secondary">Scan Speed</span><span className="font-mono text-green-400">{scanSpeed} RPM</span></div>
              <input type="range" min={1} max={120} value={scanSpeed} onChange={e => setScanSpeed(Number(e.target.value))} />
            </div>
            <div className="flex flex-col gap-0.5">
              <div className="flex justify-between text-[11px]"><span className="text-text-secondary">Elements</span><span className="font-mono text-green-400">{numElements}</span></div>
              <input type="range" min={4} max={128} value={numElements} onChange={e => setNumElements(Number(e.target.value))} />
            </div>
            <div className="flex flex-col gap-0.5">
              <div className="flex justify-between text-[11px]"><span className="text-text-secondary">SNR</span><span className="font-mono text-green-400">{snr}</span></div>
              <input type="range" min={0} max={1000} value={snr} onChange={e => setSnr(Number(e.target.value))} />
            </div>
            <div className="flex flex-col gap-0.5">
              <div className="flex justify-between text-[11px]"><span className="text-text-secondary">Det. Threshold</span><span className="font-mono text-amber-400">{detectionThreshold} dB</span></div>
              <input type="range" min={1} max={50} value={detectionThreshold} onChange={e => setDetectionThreshold(Number(e.target.value))} />
              <p className="text-[9px] text-text-muted">Higher = fewer false alarms, lower = more sensitivity</p>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] text-text-secondary">Window</span>
              <select value={windowType} onChange={e => setWindowType(e.target.value)} className="rounded border border-border bg-bg-elevated px-2 py-1 text-xs text-text-primary outline-none">
                <option value="rectangular">Rectangular</option>
                <option value="hamming">Hamming</option>
                <option value="hanning">Hanning</option>
                <option value="blackman">Blackman</option>
              </select>
            </div>
          </div>

          {/* Target manager */}
          <div className="rounded-xl border border-blue-900/30 bg-bg-surface p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-blue-400">Targets ({targets.length}/{MAX_TARGETS})</h3>
              <button onClick={addTarget} disabled={targets.length >= MAX_TARGETS} className="rounded bg-blue-500/20 px-2 py-0.5 text-[10px] text-blue-400 hover:bg-blue-500/30 disabled:opacity-30 transition-all">+ Add</button>
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {targets.map((t, i) => (
                <div key={i} className={`rounded-lg border p-2 text-[11px] transition-all cursor-pointer ${editTarget === i ? "border-blue-500/50 bg-blue-500/10" : "border-border hover:border-border-focus"}`} onClick={() => setEditTarget(editTarget === i ? null : i)}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-text-primary">T{i + 1}</span>
                    <button onClick={(e) => { e.stopPropagation(); removeTarget(i); }} className="text-red-400 hover:text-red-300 text-sm">×</button>
                  </div>
                  {editTarget === i ? (
                    <div className="space-y-1 mt-1.5">
                      <div><span className="text-text-muted text-[10px]">Distance (m)</span>
                        <input type="number" value={t.distance} onChange={e => updateTarget(i, "distance", Number(e.target.value))} className="w-full rounded border border-border bg-bg-primary px-2 py-0.5 text-text-primary text-xs" /></div>
                      <div><span className="text-text-muted text-[10px]">Angle (°)</span>
                        <input type="number" value={t.angle} min={0} max={360} onChange={e => updateTarget(i, "angle", Number(e.target.value))} className="w-full rounded border border-border bg-bg-primary px-2 py-0.5 text-text-primary text-xs" /></div>
                      <div><span className="text-text-muted text-[10px]">Size (m)</span>
                        <input type="number" value={t.size} min={1} onChange={e => updateTarget(i, "size", Number(e.target.value))} className="w-full rounded border border-border bg-bg-primary px-2 py-0.5 text-text-primary text-xs" /></div>
                    </div>
                  ) : (
                    <div className="flex gap-2 text-text-muted text-[10px] mt-0.5">
                      <span>{(t.distance / 1000).toFixed(1)} km</span>
                      <span>{t.angle}°</span>
                      <span>{t.size}m</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Detection comparison table */}
      <DetectionTable
        matched={matched}
        numDetections={detections.length}
        revealedDetectionIds={revealedDetectionIds}
        scanning={scanning}
      />
    </div>
  );
}
