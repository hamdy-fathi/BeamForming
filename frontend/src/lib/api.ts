const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API Error ${res.status}: ${text}`);
  }
  return res.json();
}

/* ── Beamforming ─────────────────────────────────────────────────────── */
export interface BeamformingParams {
  num_elements: number;
  element_spacing: number;
  frequency: number;
  steering_angle: number;
  phase_offset: number;
  signal_type: string;
  snr: number;
  window_type: string;
  medium_speed: number;
  map_resolution: number;
}

export const defaultBeamformingParams: BeamformingParams = {
  num_elements: 16, element_spacing: 0.5, frequency: 1e9, steering_angle: 0,
  phase_offset: 0, signal_type: "sine", snr: 100, window_type: "rectangular",
  medium_speed: 3e8, map_resolution: 400,
};

export function computeBeamforming(params: BeamformingParams) {
  return request<any>("/api/beamforming/compute", { method: "POST", body: JSON.stringify(params) });
}
export function getWindows() { return request<any>("/api/beamforming/windows"); }

/* ── 5G ──────────────────────────────────────────────────────────────── */
export function simulate5G(data: any) {
  return request<any>("/api/fiveg/simulate", { method: "POST", body: JSON.stringify(data) });
}
export function moveUser5G(data: any) {
  return request<any>("/api/fiveg/move-user", { method: "POST", body: JSON.stringify(data) });
}

/* ── Ultrasound ──────────────────────────────────────────────────────── */
export interface USBeamParams {
  frequency: number;
  num_elements: number;
  element_spacing: number;
  window_type: string;
  snr: number;
}

export const defaultUSBeamParams: USBeamParams = {
  frequency: 5e6, num_elements: 64, element_spacing: 0.5,
  window_type: "hamming", snr: 200,
};

export interface AModePayload {
  probe_x: number; probe_y: number; beam_angle: number;
  beam_params: USBeamParams;
}

export interface BModePayload {
  probe_x: number; probe_y: number;
  sweep_start_angle: number; sweep_end_angle: number;
  num_scanlines: number; beam_params: USBeamParams;
}

export interface DopplerPayload {
  probe_x: number; probe_y: number; beam_angle: number;
  vx: number; vy: number; beam_params: USBeamParams;
}

export function getPhantom() { return request<any>("/api/ultrasound/phantom"); }

export function aModeScan(data: AModePayload)  {
  return request<any>("/api/ultrasound/a-mode", { method: "POST", body: JSON.stringify(data) });
}
export function bModeSweep(data: BModePayload) {
  return request<any>("/api/ultrasound/b-mode", { method: "POST", body: JSON.stringify(data) });
}
export function dopplerScan(data: DopplerPayload) {
  return request<any>("/api/ultrasound/doppler", { method: "POST", body: JSON.stringify(data) });
}

export function updateTissue(data: any) {
  return request<any>("/api/ultrasound/phantom/tissue", { method: "PUT", body: JSON.stringify(data) });
}
export function updateGeometry(data: any) {
  return request<any>("/api/ultrasound/phantom/geometry", { method: "PUT", body: JSON.stringify(data) });
}
export function updateVessel(data: any) {
  return request<any>("/api/ultrasound/phantom/vessel", { method: "PUT", body: JSON.stringify(data) });
}

/* ── Radar ───────────────────────────────────────────────────────────── */
export function radarScan(data: any) {
  return request<any>("/api/radar/scan", { method: "POST", body: JSON.stringify(data) });
}

export interface RadarScanSectorPayload {
  start_angle: number;
  end_angle: number;
  step_angle: number;
  beam_width: number;
  targets: Array<{ id: number; distance: number; angle: number; size: number }>;
  num_elements: number;
  element_spacing: number;
  frequency: number;
  window_type: string;
  snr: number;
  max_range: number;
}

export function radarScanSector(data: RadarScanSectorPayload) {
  return request<any>("/api/radar/scan-sector", { method: "POST", body: JSON.stringify(data) });
}

export interface RadarDetectPayload {
  ppi_data: Array<{ angle: number; returns: number[] }>;
  beam_width: number;
  frequency: number;
  detection_threshold: number;
  targets: Array<{ id: number; distance: number; angle: number; size: number }>;
  max_range: number;
}

export function radarDetect(data: RadarDetectPayload) {
  return request<any>("/api/radar/detect", { method: "POST", body: JSON.stringify(data) });
}
