const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
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
  num_elements: 16,
  element_spacing: 0.5,
  frequency: 1e9,
  steering_angle: 0,
  phase_offset: 0,
  signal_type: "sine",
  snr: 100,
  window_type: "rectangular",
  medium_speed: 3e8,
  map_resolution: 150,
};

export function computeBeamforming(params: BeamformingParams) {
  return request<any>("/api/beamforming/compute", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export function getWindows() {
  return request<any>("/api/beamforming/windows");
}

/* ── 5G ──────────────────────────────────────────────────────────────── */
export function simulate5G(data: any) {
  return request<any>("/api/fiveg/simulate", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function moveUser5G(data: any) {
  return request<any>("/api/fiveg/move-user", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/* ── Ultrasound ──────────────────────────────────────────────────────── */
export function getPhantom() {
  return request<any>("/api/ultrasound/phantom");
}

export function aModeScan(data: any) {
  return request<any>("/api/ultrasound/a-mode", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function bModeScan(data: any) {
  return request<any>("/api/ultrasound/b-mode", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function dopplerScan(data: any) {
  return request<any>("/api/ultrasound/doppler", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateTissue(data: any) {
  return request<any>("/api/ultrasound/phantom/tissue", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

/* ── Radar ───────────────────────────────────────────────────────────── */
export function radarScan(data: any) {
  return request<any>("/api/radar/scan", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function radarFullSweep(data: any) {
  return request<any>("/api/radar/full-sweep", {
    method: "POST",
    body: JSON.stringify(data),
  });
}
