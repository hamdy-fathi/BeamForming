"use client";
import { useState, useCallback, useEffect, useRef } from "react";
import { radarScanSector, radarDetect, computeBeamforming } from "@/lib/api";
import { Target, Detection, MatchedDetection, DEFAULT_TARGETS, MAX_TARGETS, DEFAULT_MAX_RANGE } from "./helpers";
import GroundTruthMap from "./GroundTruthMap";
import RadarPPI from "./RadarPPI";
import DetectionTable from "./DetectionTable";

// Window-type beamwidth multiplier: beamwidth ≈ factor / N  (for d = 0.5λ)
const BW_FACTOR: Record<string, number> = {
  rectangular: 102,
  hamming: 120,
  hanning: 115,
  blackman: 140,
};

function localBeamWidth(numElements: number, windowType: string): number {
  const factor = BW_FACTOR[windowType] ?? 102;
  return Math.max(2, factor / Math.max(numElements, 2));
}

export default function RadarPage() {
  const [targets, setTargets] = useState<Target[]>(DEFAULT_TARGETS);
  const [maxRange, setMaxRange] = useState(DEFAULT_MAX_RANGE);
  const [beamformingResult, setBeamformingResult] = useState<any>(null);
  const [scanSpeed, setScanSpeed] = useState(30);
  const [numElements, setNumElements] = useState(32);
  const [snr, setSnr] = useState(200);
  const [frequency, setFrequency] = useState(3e9);
  const [windowType, setWindowType] = useState("hamming");
  const [detectionThreshold, setDetectionThreshold] = useState(12);
  const [ppiBuffer, setPpiBuffer] = useState<Array<{angle: number, returns: number[]}>>([]); 
  const [detections, setDetections] = useState<Detection[]>([]);
  const [matched, setMatched] = useState<MatchedDetection[]>([]);
  const [sweepAngle, setSweepAngle] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editTarget, setEditTarget] = useState<number | null>(null);
  const [scanMode, setScanMode] = useState<"custom" | "broad" | "narrow">("custom");
  
  // Derived: beam width computed instantly from numElements + window
  const computedBeamWidth = localBeamWidth(numElements, windowType);

  const lastScanAngleRef = useRef(0);
  const ppiBufferRef = useRef(ppiBuffer);
  ppiBufferRef.current = ppiBuffer;
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Map beam width slider → num_elements + auto-adjust scan speed
  // Narrow beam = more elements = slower scan = accurate size
  // Wide beam   = fewer elements = faster scan = rough size
  const updateBeamWidth = useCallback((bw: number) => {
    const factor = BW_FACTOR[windowType] ?? 102;
    const n = Math.round(factor / Math.max(bw, 1));
    setNumElements(Math.max(4, Math.min(128, n)));
    // Auto-link RPM: wider beam → faster scan, narrow → slower
    const autoRPM = Math.round(Math.max(5, Math.min(120, bw * 2)));
    setScanSpeed(autoRPM);
    // Clear old data so mixed beam-width profiles don't cause false positives
    setPpiBuffer([]); setDetections([]); setMatched([]);
    setScanMode("custom");
  }, [windowType]);

  // Preset: Broad Scan (fast detection, poor size accuracy)
  const applyBroadScan = useCallback(() => {
    setScanMode("broad");
    setNumElements(4);
    setScanSpeed(60);
    setPpiBuffer([]); setDetections([]); setMatched([]);
  }, []);

  // Preset: Narrow Scan (slow, accurate size estimation)
  const applyNarrowScan = useCallback(() => {
    setScanMode("narrow");
    setNumElements(34);
    setScanSpeed(10);
    setPpiBuffer([]); setDetections([]); setMatched([]);
  }, []);

  // Fire-and-forget backend call for beam profile data (not blocking UI)
  const computePhysics = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await computeBeamforming({
          num_elements: numElements,
          element_spacing: 0.5,
          frequency: frequency,
          steering_angle: 0,
          phase_offset: 0,
          signal_type: "sine",
          snr: snr,
          window_type: windowType,
          medium_speed: 3e8,
          map_resolution: 300,
        });
        setBeamformingResult(data);
      } catch (e) { console.error(e); }
    }, 300);
  }, [numElements, snr, windowType, frequency]);

  useEffect(() => { computePhysics(); }, [computePhysics]);

  const handleScanToggle = useCallback(async () => {
    if (scanning) {
      setScanning(false);
      return;
    }
    setScanning(true);
  }, [scanning]);

  // Refs for detection params so the detect timer can read current values
  // without being in the scan-effect dependency array.
  const detThreshRef = useRef(detectionThreshold);
  detThreshRef.current = detectionThreshold;
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const maxRangeRef = useRef(maxRange);
  maxRangeRef.current = maxRange;
  const frequencyRef = useRef(frequency);
  frequencyRef.current = frequency;
  const beamWidthRef = useRef(computedBeamWidth);
  beamWidthRef.current = computedBeamWidth;
  const scanningRef = useRef(scanning);
  scanningRef.current = scanning;
  const numElementsRef = useRef(numElements);
  numElementsRef.current = numElements;
  const windowTypeRef = useRef(windowType);
  windowTypeRef.current = windowType;
  const snrRef = useRef(snr);
  snrRef.current = snr;
  const scanSpeedRef = useRef(scanSpeed);
  scanSpeedRef.current = scanSpeed;

  // ── Run detection on current buffer (called from multiple places) ────
  const runDetection = useCallback(async () => {
    const buf = ppiBufferRef.current;
    if (buf.length === 0) return;
    try {
      const d = await radarDetect({
        ppi_data: buf,
        beam_width: beamWidthRef.current,
        frequency: frequencyRef.current,
        detection_threshold: detThreshRef.current,
        targets: targetsRef.current,
        max_range: maxRangeRef.current,
      });
      setDetections(d.detections || []);
      setMatched(d.matched || []);
    } catch (e) { console.error("radarDetect error:", e); }
  }, []);

  // ── Re-run detection when threshold changes (no scan restart) ────────
  useEffect(() => {
    if (!scanning) return;
    runDetection();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectionThreshold]);

  // ── Main scan loop ───────────────────────────────────────────────────
  // Only re-runs when scanning is toggled on/off. All parameter values
  // are read from refs inside the timer callbacks so slider changes
  // take effect immediately WITHOUT restarting the scan or clearing data.
  useEffect(() => {
    if (!scanning) {
      setSweepAngle(0);
      lastScanAngleRef.current = 0;
      return;
    }

    // Clear buffer at scan start
    setPpiBuffer([]);
    setDetections([]);
    setMatched([]);

    let sweepComplete = false;

    const fetchInterval = 300;
    const scanTimer = setInterval(async () => {
      const bw = beamWidthRef.current;
      const speed = scanSpeedRef.current;
      const startAngle = lastScanAngleRef.current;
      const step = (speed * 360 / 60) * (fetchInterval / 1000);
      const endAngle = startAngle + step;

      try {
        // Step at beam_width/2 (Nyquist sampling of the beam pattern —
        // needed for accurate size estimation via RCS inversion)
        const stepAngle = Math.max(1, bw / 2);
        const sectorData = await radarScanSector({
          start_angle: startAngle,
          end_angle: endAngle % 360,
          step_angle: stepAngle,
          beam_width: bw,
          targets: targetsRef.current,
          num_elements: numElementsRef.current,
          element_spacing: 0.5,
          frequency: frequencyRef.current,
          window_type: windowTypeRef.current,
          snr: snrRef.current,
          max_range: maxRangeRef.current,
        });
        
        setPpiBuffer(prev => {
          const next = [...prev, ...sectorData];
          // Keep ~1 full rotation of data, capped at 400 profiles
          const maxLen = Math.min(400, Math.ceil(360 / stepAngle) + 20);
          return next.slice(-maxLen);
        });
      } catch(e) { console.error("radarScanSector error:", e); }

      lastScanAngleRef.current = endAngle % 360;

      // Detect when a full sweep completes (crosses 0°)
      if (endAngle >= 360 && !sweepComplete) {
        sweepComplete = true;
        setTimeout(() => runDetection(), 100);
      }
    }, fetchInterval);

    // Periodic detection — every 3s for ongoing updates
    const detectTimer = setInterval(() => {
      runDetection();
    }, 3000);

    return () => {
      clearInterval(scanTimer);
      clearInterval(detectTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

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
          <GroundTruthMap targets={targets} setTargets={setTargets} onTargetsChanged={() => {}} maxRange={maxRange} />
        </div>

        {/* Radar PPI */}
        <div className="rounded-xl border border-green-900/30 bg-bg-surface p-4">
          <RadarPPI
            ppiBuffer={ppiBuffer}
            detections={detections}
            scanning={scanning}
            scanSpeed={scanSpeed}
            beamWidth={computedBeamWidth}
            sweepAngle={sweepAngle}
            setSweepAngle={setSweepAngle}
            maxRange={maxRange}
            beamformingResult={beamformingResult}
          />
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-3">
          {/* Actions */}
          <div className="flex gap-2">
            <button onClick={handleScanToggle} disabled={loading} className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all disabled:opacity-50 ${scanning ? "bg-red-500/20 text-red-400 border border-red-500/40" : "bg-green-500/20 text-green-400 border border-green-500/40"}`}>
              {scanning ? "⏹ Stop" : "▶ Scan"}
            </button>
          </div>

          {/* Scan Mode Presets */}
          <div className="rounded-xl border border-amber-900/30 bg-bg-surface p-3">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-amber-400 mb-2">Scan Mode</h3>
            <div className="grid grid-cols-2 gap-1.5">
              <button onClick={applyBroadScan}
                className={`rounded-lg px-2 py-2 text-[10px] font-medium transition-all border ${
                  scanMode === "broad" ? "bg-amber-500/20 text-amber-300 border-amber-500/50" : "bg-bg-elevated text-text-muted border-border hover:border-amber-500/30"
                }`}>
                <div className="font-bold">📡 Broad Scan</div>
                <div className="text-[8px] mt-0.5 opacity-70">Fast detect · ~30° beam</div>
              </button>
              <button onClick={applyNarrowScan}
                className={`rounded-lg px-2 py-2 text-[10px] font-medium transition-all border ${
                  scanMode === "narrow" ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/50" : "bg-bg-elevated text-text-muted border-border hover:border-cyan-500/30"
                }`}>
                <div className="font-bold">🎯 Narrow Scan</div>
                <div className="text-[8px] mt-0.5 opacity-70">Accurate size · ~3° beam</div>
              </button>
            </div>
            {/* Mode explanation */}
            <div className={`mt-2 rounded-lg p-2 text-[9px] leading-relaxed transition-all ${
              scanMode === "broad" ? "bg-amber-500/10 text-amber-300/90 border border-amber-500/20" :
              scanMode === "narrow" ? "bg-cyan-500/10 text-cyan-300/90 border border-cyan-500/20" :
              "bg-bg-elevated text-text-muted border border-border"
            }`}>
              {scanMode === "broad" && "Wide beam sweeps fast to detect all targets. Size estimates will be rough. Use this first to find targets."}
              {scanMode === "narrow" && "Narrow beam scans slowly but estimates target size precisely. Use after broad scan to measure detected targets."}
              {scanMode === "custom" && "Custom parameters. Adjust beam width and speed manually."}
            </div>
          </div>

          {/* Scan params */}
          <div className="rounded-xl border border-green-900/30 bg-bg-surface p-3 space-y-2.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-green-400">Scan Parameters</h3>
            {/* Beam Width — primary control */}
            <div className="flex flex-col gap-0.5">
              <div className="flex justify-between text-[11px]"><span className="text-text-secondary">Beam Width</span><span className="font-mono text-green-400">{computedBeamWidth.toFixed(1)}°</span></div>
              <input type="range" min={2} max={45} step={0.5} value={Math.round(computedBeamWidth)}
                onChange={e => updateBeamWidth(Number(e.target.value))} />
              <div className="flex justify-between text-[9px] text-text-muted">
                <span>Narrow (accurate)</span><span>Wide (fast)</span>
              </div>
            </div>
            {/* Accuracy indicator */}
            <div className="rounded-lg bg-bg-elevated p-2 flex items-center gap-2">
              <div className="flex-1">
                <div className="text-[9px] text-text-muted mb-1">Size Accuracy</div>
                <div className="h-1.5 rounded-full bg-bg-primary overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-300" style={{
                    width: `${Math.max(5, Math.min(100, (1 - computedBeamWidth / 45) * 100))}%`,
                    background: computedBeamWidth < 8 ? "#06b6d4" : computedBeamWidth < 20 ? "#f59e0b" : "#ef4444"
                  }} />
                </div>
              </div>
              <div className="flex-1">
                <div className="text-[9px] text-text-muted mb-1">Scan Speed</div>
                <div className="h-1.5 rounded-full bg-bg-primary overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-300" style={{
                    width: `${Math.max(5, Math.min(100, (computedBeamWidth / 45) * 100))}%`,
                    background: computedBeamWidth > 20 ? "#22c55e" : computedBeamWidth > 8 ? "#f59e0b" : "#ef4444"
                  }} />
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              <div className="flex justify-between text-[11px]"><span className="text-text-secondary">Elements</span><span className="font-mono text-text-muted">{numElements}</span></div>
              <p className="text-[9px] text-text-muted">Auto-set from beam width</p>
            </div>
            <div className="flex flex-col gap-0.5">
              <div className="flex justify-between text-[11px]"><span className="text-text-secondary">Max Range</span><span className="font-mono text-green-400">{(maxRange/1000).toFixed(0)} km</span></div>
              <input type="range" min={10000} max={100000} step={10000} value={maxRange} onChange={e => setMaxRange(Number(e.target.value))} />
            </div>
            <div className="flex flex-col gap-0.5">
              <div className="flex justify-between text-[11px]"><span className="text-text-secondary">Scan Speed</span><span className="font-mono text-green-400">{scanSpeed} RPM</span></div>
              <input type="range" min={1} max={120} value={scanSpeed} onChange={e => { setScanSpeed(Number(e.target.value)); setScanMode("custom"); }} />
              <p className="text-[9px] text-text-muted">Auto-linked to beam width</p>
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
            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
              {targets.map((t, i) => (
                <div key={i} className="rounded-lg border border-border bg-bg-elevated p-2.5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-text-primary text-xs">T{i + 1}</span>
                    <button onClick={() => removeTarget(i)} 
                      className="w-6 h-6 flex items-center justify-center rounded-full bg-red-500/20 text-red-400 hover:bg-red-500/40 hover:text-red-300 text-sm font-bold transition-all" 
                      title="Delete target">×</button>
                  </div>
                  {/* Distance */}
                  <div className="mb-1.5">
                    <div className="flex justify-between text-[10px] mb-0.5">
                      <span className="text-text-muted">Distance</span>
                      <span className="font-mono text-blue-400">{(t.distance / 1000).toFixed(1)} km</span>
                    </div>
                    <input type="range" min={1000} max={maxRange} step={500} value={t.distance}
                      onChange={e => updateTarget(i, "distance", Number(e.target.value))} />
                  </div>
                  {/* Angle */}
                  <div className="mb-1.5">
                    <div className="flex justify-between text-[10px] mb-0.5">
                      <span className="text-text-muted">Angle</span>
                      <span className="font-mono text-blue-400">{Math.round(t.angle)}°</span>
                    </div>
                    <input type="range" min={0} max={359} step={1} value={Math.round(t.angle)}
                      onChange={e => updateTarget(i, "angle", Number(e.target.value))} />
                  </div>
                  {/* Size */}
                  <div>
                    <div className="flex justify-between text-[10px] mb-0.5">
                      <span className="text-text-muted">Size</span>
                      <span className="font-mono text-blue-400">{t.size} m</span>
                    </div>
                    <input type="range" min={1} max={100} step={1} value={t.size}
                      onChange={e => updateTarget(i, "size", Number(e.target.value))} />
                  </div>
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
        ppiBuffer={ppiBuffer}
        scanning={scanning}
        beamWidth={computedBeamWidth}
        scanMode={scanMode}
      />

    </div>
  );
}
