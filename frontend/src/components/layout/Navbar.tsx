"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/beamforming", label: "Beamforming" },
  { href: "/fiveg", label: "5G" },
  { href: "/ultrasound", label: "Ultrasound" },
  { href: "/radar", label: "Radar" },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-bg-primary/95 backdrop-blur-sm">
      <div className="mx-auto flex h-12 max-w-screen-2xl items-center justify-between px-4">
        <Link href="/" className="text-sm font-semibold tracking-tight text-text-primary">
          BeamSim
        </Link>

        <div className="flex items-center gap-0.5">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-bg-elevated text-text-primary"
                    : "text-text-muted hover:text-text-secondary"
                }`}
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
