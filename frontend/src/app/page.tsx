"use client";

import Link from "next/link";

const APPS = [
  {
    href: "/beamforming",
    title: "Beamforming Core",
    subtitle: "Phased Array Simulator",
    description:
      "Customize array parameters, visualize constructive/destructive interference maps, beam profiles, and apply apodization windows for side-lobe reduction.",
    accentText: "text-accent-teal",
    accentDot: "bg-accent-teal",
    features: ["10+ Parameters", "Interference Map", "Beam Profile", "Apodization"],
  },
  {
    href: "/fiveg",
    title: "5G Simulator",
    subtitle: "Tower Connectivity",
    description:
      "Place 3 towers and 2 users. Watch beams auto-steer to maintain connectivity as users move. Real-time parameter updates visible per tower.",
    accentText: "text-accent-green",
    accentDot: "bg-accent-green",
    features: ["3 Towers", "2 Users", "Auto-Steering", "Keyboard Control"],
  },
  {
    href: "/ultrasound",
    title: "Ultrasound Simulator",
    subtitle: "A-Mode / B-Mode / Doppler",
    description:
      "Scan a Shepp–Logan phantom with realistic tissue properties. Visualize A-mode, build B-mode images, and measure blood flow with Doppler mode.",
    accentText: "text-accent-blue",
    accentDot: "bg-accent-blue",
    features: ["Shepp-Logan Phantom", "A / B / Doppler", "Tissue Editing", "Blood Vessel"],
  },
  {
    href: "/radar",
    title: "Radar Simulator",
    subtitle: "360° Scanning",
    description:
      "Electronic 360° beam sweep with PPI display. Place up to 5 solid targets, adjust beam width for the wide-scan vs narrow-focus trade-off.",
    accentText: "text-accent-amber",
    accentDot: "bg-accent-amber",
    features: ["360° Sweep", "5 Targets", "Wide/Narrow Beam", "PPI Display"],
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-screen-xl px-4 py-12">
      {/* Hero */}
      <div className="mb-12 text-center">
        <h1 className="mb-3 text-3xl font-bold tracking-tight text-text-primary">
          2D Beamforming Simulator
        </h1>
        <p className="mx-auto max-w-2xl text-sm text-text-secondary leading-relaxed">
          Explore phased array beamforming across wireless communications, medical
          ultrasound, and radar systems. Adjust parameters in real time and observe
          the physics of constructive and destructive interference.
        </p>
      </div>

      {/* Application Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {APPS.map((app) => (
          <Link
            key={app.href}
            href={app.href}
            className="group flex flex-col rounded-lg border border-border bg-bg-surface p-5 transition-colors hover:bg-bg-elevated hover:border-border-focus"
          >
            <div className="mb-3 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full ${app.accentDot}`} />
                  <h2 className="text-lg font-semibold text-text-primary">
                    {app.title}
                  </h2>
                </div>
                <p className={`mt-0.5 text-xs font-medium ${app.accentText}`}>
                  {app.subtitle}
                </p>
              </div>
              <span className="text-text-muted transition-transform group-hover:translate-x-1">
                →
              </span>
            </div>

            <p className="mb-4 flex-1 text-sm leading-relaxed text-text-secondary">
              {app.description}
            </p>

            <div className="flex flex-wrap gap-1.5">
              {app.features.map((f) => (
                <span
                  key={f}
                  className="rounded border border-border px-2 py-0.5 text-[11px] text-text-muted"
                >
                  {f}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>

      {/* Info */}
      <div className="mt-10 rounded-lg border border-border bg-bg-surface p-5">
        <h3 className="mb-3 text-sm font-semibold text-text-primary">
          How It Works
        </h3>
        <div className="grid gap-4 text-sm text-text-secondary md:grid-cols-3">
          <div>
            <p className="mb-1 text-xs font-medium text-text-primary">Phased Arrays</p>
            <p className="text-xs leading-relaxed">
              Multiple antenna elements with controlled phase shifts create
              constructive interference in a desired direction — forming a
              steerable beam without mechanical rotation.
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-text-primary">Apodization</p>
            <p className="text-xs leading-relaxed">
              Window functions (Hamming, Blackman, Kaiser, etc.) taper element
              amplitudes to reduce side lobes at the cost of wider main lobes.
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-text-primary">SNR Control</p>
            <p className="text-xs leading-relaxed">
              Add realistic Gaussian noise to all signals. Observe how noise
              degrades interference maps, A-mode traces, and radar returns.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
