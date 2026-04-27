"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  {
    href: "/fiveg",
    label: "5G Simulator",
    color: "#06b6d4",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6.5 12.5l5-5 5 5" />
        <path d="M8.5 15.5l3-3 3 3" />
        <line x1="12" y1="2" x2="12" y2="22" />
      </svg>
    ),
  },
  {
    href: "/beamforming",
    label: "Beamforming",
    color: "#3b82f6",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12h4l3-9 4 18 3-9h4" />
      </svg>
    ),
  },
  {
    href: "/ultrasound",
    label: "Ultrasound",
    color: "#22c55e",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7z" />
        <circle cx="12" cy="9" r="2.5" />
      </svg>
    ),
  },
  {
    href: "/radar",
    label: "Radar",
    color: "#f59e0b",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 12l7-7" />
        <circle cx="12" cy="12" r="3" />
        <circle cx="12" cy="12" r="6" opacity="0.5" />
      </svg>
    ),
  },
];

const PAGE_LABELS: Record<string, string> = {
  "/fiveg": "5G",
  "/beamforming": "Beamforming",
  "/ultrasound": "Ultrasound",
  "/radar": "Radar",
};

export default function Navbar() {
  const pathname = usePathname();
  const pageLabel = PAGE_LABELS[pathname] || "";

  return (
    <nav
      className="sticky top-0 z-50 bg-[#080c14]/95 backdrop-blur-md"
      style={{ borderBottom: "1px solid #1a1f2e" }}
    >
      <div className="mx-auto flex h-11 max-w-screen-2xl items-center px-5">
        {/* Brand — flex-1 to balance with settings */}
        <div className="flex-1 flex items-center">
          <Link href="/" className="flex items-baseline gap-1.5 shrink-0">
            <span className="text-sm font-bold text-text-primary tracking-tight">
              BeamSim{pageLabel ? ` ${pageLabel}` : ""}
            </span>
            {pageLabel && (
              <span className="text-[10px] text-text-muted hidden sm:inline">
                2D Beamforming Simulator
              </span>
            )}
          </Link>
        </div>

        {/* Nav items — centered */}
        <div className="flex items-center gap-0.5">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium transition-all duration-200 ${
                  isActive
                    ? "text-text-primary bg-[#141922]"
                    : "text-text-muted hover:text-text-secondary hover:bg-[#0d1119]"
                }`}
                style={
                  isActive
                    ? {
                        boxShadow: `0 0 12px -4px ${item.color}`,
                        border: `1px solid ${item.color}33`,
                      }
                    : { border: "1px solid transparent" }
                }
              >
                <span
                  style={{ color: isActive ? item.color : "#4b5563" }}
                >
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}
        </div>

        {/* Settings — flex-1 to balance with brand */}
        <div className="flex-1 flex justify-end">
          <button className="text-text-muted hover:text-text-secondary text-sm shrink-0">
            ⚙
          </button>
        </div>
      </div>
    </nav>
  );
}
