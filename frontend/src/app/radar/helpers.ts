export const PPI_SIZE = 480;
export const GT_SIZE = 480;
export const MAX_TARGETS = 5;
export const DEFAULT_MAX_RANGE = 50000;

export interface Target { id: number; distance: number; angle: number; size: number; }
export interface Detection { det_id: number; est_range: number; est_angle: number; signal_level: number; est_size: number; uncertainty_range: number; uncertainty_angle: number; uncertainty_size: number; num_hits: number; }
export interface MatchedDetection { target_id: number; detected: boolean; true_range: number; true_angle: number; true_size: number; est_range: number|null; est_angle: number|null; est_size: number|null; range_error: number|null; angle_error: number|null; size_error: number|null; signal_level: number|null; det_id: number|null; }

export const DEFAULT_TARGETS: Target[] = [
  { id: 0, distance: 15000, angle: 45, size: 20 },
  { id: 1, distance: 25000, angle: 150, size: 35 },
  { id: 2, distance: 10000, angle: 270, size: 15 },
];

export function polarToXY(angle: number, distance: number, cx: number, cy: number, radius: number, maxRange: number) {
  const a = angle * Math.PI / 180 - Math.PI / 2;
  const d = distance / maxRange * radius;
  return { x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d };
}

export function xyToPolar(mx: number, my: number, cx: number, cy: number, radius: number, maxRange: number) {
  const dx = mx - cx, dy = my - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > radius) return null;
  const angle = ((Math.atan2(dy, dx) + Math.PI / 2) * 180 / Math.PI + 360) % 360;
  return { angle, distance: dist / radius * maxRange };
}
