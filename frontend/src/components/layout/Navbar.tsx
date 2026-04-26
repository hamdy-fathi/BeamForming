"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Home", color: "#8892a6" },
  { href: "/beamforming", label: "Beamforming", color: "#06b6d4" },
  { href: "/fiveg", label: "5G", color: "#3b82f6" },
  { href: "/ultrasound", label: "Ultrasound", color: "#22c55e" },
  { href: "/radar", label: "Radar", color: "#f59e0b" },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 bg-bg-primary/95 backdrop-blur-sm" style={{ borderBottom: '1px solid #1e2433' }}>
      <div className="mx-auto flex h-12 max-w-screen-2xl items-center justify-between px-5">
        <Link href="/" className="text-sm font-bold tracking-tight text-text-primary">
          BeamSim
        </Link>

        <div className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                  isActive
                    ? "text-text-primary"
                    : "text-text-muted hover:text-text-secondary"
                }`}
                style={isActive ? {
                  background: '#141922',
                  boxShadow: `0 0 12px -4px ${item.color}`,
                  border: `1px solid ${item.color}33`,
                } : {}}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
