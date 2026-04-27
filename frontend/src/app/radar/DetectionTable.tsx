"use client";
import { useRef, useEffect } from "react";
import { MatchedDetection } from "./helpers";

interface Props {
  matched: MatchedDetection[];
  numDetections: number;
  ppiBuffer: Array<{ angle: number; returns: number[] }>;
  scanning: boolean;
  beamWidth?: number;
  scanMode?: "custom" | "broad" | "narrow";
}

/**
 * Keeps a persistent "memory" of every target we have ever seen.
 * Rules:
 *  - If a target is detected → store it (or update it).
 *  - If a target is NOT detected BUT its angle has just been re-scanned
 *    → mark it as missed (update in place).
 *  - If a target has never been scanned yet → show as "Pending".
 *  - A target that was previously detected keeps its last good fix until
 *    the beam sweeps over it again.
 */
export default function DetectionTable({
  matched,
  numDetections,
  ppiBuffer,
  scanning,
  beamWidth,
  scanMode,
}: Props) {
  // Persistent memory: target_id → last known MatchedDetection
  const memoryRef = useRef<Map<number, MatchedDetection & { everScanned: boolean }>>(
    new Map()
  );

  // On every new matched update, merge into memory
  useEffect(() => {
    if (!matched || matched.length === 0) return;

    matched.forEach((m) => {
      const prev = memoryRef.current.get(m.target_id);

      const angleJustScanned = ppiBuffer?.some(
        (p) => Math.abs(((p.angle - m.true_angle + 180) % 360) - 180) < 15
      ) ?? false;

      if (m.detected) {
        // Always update with the latest detection
        memoryRef.current.set(m.target_id, { ...m, everScanned: true });
      } else if (angleJustScanned) {
        // Beam just swept over this target and missed it — update status
        memoryRef.current.set(m.target_id, { ...m, everScanned: true });
      } else if (prev) {
        // Beam hasn't reached this target yet this sweep — keep previous data
        // (don't overwrite a good fix with a miss from an unscanned angle)
      } else {
        // Never seen before, not yet scanned
        memoryRef.current.set(m.target_id, { ...m, everScanned: false });
      }
    });
  }, [matched, ppiBuffer]);

  if (!matched || matched.length === 0)
    return (
      <div className="rounded-xl border border-border bg-bg-surface p-4 text-center text-text-muted text-xs">
        Waiting for target analysis...
      </div>
    );

  // Build display rows from persistent memory, fallback to live matched
  const displayRows = matched.map((m) => {
    const mem = memoryRef.current.get(m.target_id);
    return mem ?? { ...m, everScanned: false };
  });

  const detected = displayRows.filter((m) => m.detected);
  const everScanned = displayRows.filter((m) => m.everScanned);
  const rate =
    everScanned.length > 0
      ? ((detected.length / everScanned.length) * 100).toFixed(0)
      : "0";
  const avgRangeErr =
    detected.length > 0
      ? (
        detected.reduce((s, m) => s + Math.abs(m.range_error!), 0) /
        detected.length /
        1000
      ).toFixed(2)
      : "—";
  const avgAngleErr =
    detected.length > 0
      ? (
        detected.reduce((s, m) => s + Math.abs(m.angle_error!), 0) /
        detected.length
      ).toFixed(1)
      : "—";
  const avgSizeErr =
    detected.filter(m => m.size_error != null).length > 0
      ? (
        detected.filter(m => m.size_error != null).reduce((s, m) => s + Math.abs(m.size_error!), 0) /
        detected.filter(m => m.size_error != null).length
      ).toFixed(1)
      : "—";

  // Row status label
  const statusCell = (m: MatchedDetection & { everScanned: boolean }) => {
    if (!m.everScanned)
      return <span className="text-text-muted italic">Pending…</span>;
    if (m.detected)
      return <span className="text-green-400 font-bold">✓ Detected</span>;
    return <span className="text-red-400 font-bold">✗ Missed</span>;
  };

  return (
    <div className="rounded-xl border border-border bg-bg-surface p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-400">
          Detection Analysis
        </h3>
        <div className="flex gap-4 text-[10px]">
          <span className="text-text-muted">
            Detection Rate:{" "}
            <span className="text-amber-400 font-mono">{rate}%</span>
          </span>
          <span className="text-text-muted">
            Avg Range Error:{" "}
            <span className="text-cyan-400 font-mono">{avgRangeErr} km</span>
          </span>
          <span className="text-text-muted">
            Avg Angle Error:{" "}
            <span className="text-cyan-400 font-mono">{avgAngleErr}°</span>
          </span>
          <span className="text-text-muted">
            Avg Size Error:{" "}
            <span className="text-cyan-400 font-mono">{avgSizeErr} m</span>
          </span>
          <span className="text-text-muted">
            Raw Detections:{" "}
            <span className="text-green-400 font-mono">{numDetections}</span>
          </span>
        </div>
      </div>

      {/* Beam width accuracy banner */}
      {beamWidth != null && (
        <div className={`mb-3 rounded-lg p-2.5 text-[10px] flex items-center gap-3 border ${
          scanMode === "broad" ? "bg-amber-500/10 border-amber-500/20 text-amber-300" :
          scanMode === "narrow" ? "bg-cyan-500/10 border-cyan-500/20 text-cyan-300" :
          "bg-bg-elevated border-border text-text-muted"
        }`}>
          <span className="font-semibold">Beam: {beamWidth.toFixed(1)}°</span>
          <span>·</span>
          <span>{beamWidth > 15 ? "⚡ Fast scan — size estimates are rough" :
                 beamWidth < 6 ? "🎯 High precision — size estimates are accurate" :
                 "⚖️ Balanced — moderate accuracy"}</span>
          {scanMode === "broad" && <span className="ml-auto text-[9px] opacity-70">Tip: Switch to Narrow Scan to refine sizes</span>}
          {scanMode === "narrow" && <span className="ml-auto text-[9px] opacity-70">Tip: Use Broad Scan first to find all targets</span>}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-text-muted">
              <th className="text-left py-1.5 px-2">Target</th>
              <th className="text-left py-1.5 px-2">Status</th>
              <th className="text-right py-1.5 px-2">True Range</th>
              <th className="text-right py-1.5 px-2">Est. Range</th>
              <th className="text-right py-1.5 px-2">Range Error</th>
              <th className="text-right py-1.5 px-2">True Angle</th>
              <th className="text-right py-1.5 px-2">Est. Angle</th>
              <th className="text-right py-1.5 px-2">Angle Error</th>
              <th className="text-right py-1.5 px-2">True Size</th>
              <th className="text-right py-1.5 px-2">Est. Size</th>
              <th className="text-right py-1.5 px-2">Size Error</th>
              <th className="text-right py-1.5 px-2">Signal</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((m, i) => (
              <tr
                key={i}
                className="border-b border-border/30 hover:bg-bg-elevated/50 transition-colors"
              >
                <td className="py-1.5 px-2 font-semibold text-text-primary">
                  T{m.target_id + 1}
                </td>
                <td className="py-1.5 px-2">{statusCell(m)}</td>
                <td className="py-1.5 px-2 text-right font-mono text-blue-400">
                  {(m.true_range / 1000).toFixed(1)} km
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-amber-400">
                  {m.est_range != null
                    ? `${(m.est_range / 1000).toFixed(1)} km`
                    : "—"}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-cyan-400">
                  {m.range_error != null
                    ? `${(m.range_error / 1000).toFixed(2)} km`
                    : "—"}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-blue-400">
                  {m.true_angle.toFixed(0)}°
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-amber-400">
                  {m.est_angle != null ? `${m.est_angle.toFixed(1)}°` : "—"}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-cyan-400">
                  {m.angle_error != null
                    ? `${m.angle_error.toFixed(1)}°`
                    : "—"}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-blue-400">
                  {m.true_size.toFixed(1)} m
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-amber-400">
                  {m.est_size != null ? `${m.est_size.toFixed(1)} m` : "—"}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-cyan-400">
                  {m.size_error != null
                    ? `${m.size_error.toFixed(1)} m`
                    : "—"}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-green-400">
                  {m.signal_level != null
                    ? `${m.signal_level.toFixed(1)} dB`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[10px] text-text-muted italic">
        * Targets persist until re-scanned · Narrower beam → better angle
        accuracy · Higher SNR → fewer misses
      </p>
    </div>
  );
}
