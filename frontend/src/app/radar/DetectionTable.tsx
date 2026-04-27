"use client";
import { MatchedDetection } from "./helpers";

interface Props {
  matched: MatchedDetection[];
  numDetections: number;
  ppiBuffer: Array<{angle: number, returns: number[]}>;
  scanning: boolean;
}

export default function DetectionTable({ matched, numDetections, ppiBuffer, scanning }: Props) {
  if (!matched || matched.length === 0) return (
    <div className="rounded-xl border border-border bg-bg-surface p-4 text-center text-text-muted text-xs">
      Waiting for target analysis...
    </div>
  );

  // A target is visible if its true_angle is within the angles present in the ppiBuffer
  const isAngleScanned = (angle: number) => {
    if (!ppiBuffer || ppiBuffer.length === 0) return false;
    // Check if the target's angle is close to any angle in the buffer
    return ppiBuffer.some(p => Math.abs(((p.angle - angle + 180) % 360) - 180) < 15);
  };

  const visibleMatched = scanning ? matched.filter((m) => m.detected || isAngleScanned(m.true_angle)) : matched;

  const detected = visibleMatched.filter(m => m.detected);
  const rate = visibleMatched.length > 0 ? (detected.length / visibleMatched.length * 100).toFixed(0) : "0";
  const avgRangeErr = detected.length > 0
    ? (detected.reduce((s, m) => s + Math.abs(m.range_error!), 0) / detected.length / 1000).toFixed(2)
    : "—";
  const avgAngleErr = detected.length > 0
    ? (detected.reduce((s, m) => s + Math.abs(m.angle_error!), 0) / detected.length).toFixed(1)
    : "—";

  return (
    <div className="rounded-xl border border-border bg-bg-surface p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-400">Detection Analysis</h3>
        <div className="flex gap-4 text-[10px]">
          <span className="text-text-muted">Detection Rate: <span className="text-amber-400 font-mono">{rate}%</span></span>
          <span className="text-text-muted">Avg Range Error: <span className="text-cyan-400 font-mono">{avgRangeErr} km</span></span>
          <span className="text-text-muted">Avg Angle Error: <span className="text-cyan-400 font-mono">{avgAngleErr}°</span></span>
          <span className="text-text-muted">Raw Detections: <span className="text-green-400 font-mono">{numDetections}</span></span>
        </div>
      </div>
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
            {visibleMatched.map((m, i) => (
              <tr key={i} className="border-b border-border/30 hover:bg-bg-elevated/50 transition-colors">
                <td className="py-1.5 px-2 font-semibold text-text-primary">T{m.target_id + 1}</td>
                <td className="py-1.5 px-2">
                  {m.detected
                    ? <span className="text-green-400 font-bold">✓ Detected</span>
                    : <span className="text-red-400 font-bold">✗ Missed</span>}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-blue-400">{(m.true_range / 1000).toFixed(1)} km</td>
                <td className="py-1.5 px-2 text-right font-mono text-amber-400">{m.est_range != null ? `${(m.est_range / 1000).toFixed(1)} km` : "—"}</td>
                <td className="py-1.5 px-2 text-right font-mono text-cyan-400">{m.range_error != null ? `${(m.range_error / 1000).toFixed(2)} km` : "—"}</td>
                <td className="py-1.5 px-2 text-right font-mono text-blue-400">{m.true_angle.toFixed(0)}°</td>
                <td className="py-1.5 px-2 text-right font-mono text-amber-400">{m.est_angle != null ? `${m.est_angle.toFixed(1)}°` : "—"}</td>
                <td className="py-1.5 px-2 text-right font-mono text-cyan-400">{m.angle_error != null ? `${m.angle_error.toFixed(1)}°` : "—"}</td>
                <td className="py-1.5 px-2 text-right font-mono text-blue-400">{m.true_size.toFixed(1)} m</td>
                <td className="py-1.5 px-2 text-right font-mono text-amber-400">{m.est_size != null ? `${m.est_size.toFixed(1)} m` : "—"}</td>
                <td className="py-1.5 px-2 text-right font-mono text-cyan-400">{m.size_error != null ? `${m.size_error.toFixed(1)} m` : "—"}</td>
                <td className="py-1.5 px-2 text-right font-mono text-green-400">{m.signal_level != null ? `${m.signal_level.toFixed(1)} dB` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-text-muted italic">
        * Narrower beam width → more accurate angle estimation · Higher SNR → fewer missed detections
      </p>
    </div>
  );
}
