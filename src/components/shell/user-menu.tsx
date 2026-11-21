"use client";

import { useEffect, useRef, useState } from "react";
import { THEME_COOKIE, type Theme } from "@/lib/theme";

const THEMES: { value: Theme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

function readTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
}

export function UserMenu({ placement }: { placement: "above" | "below" }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  function toggle() {
    if (!open) setTheme(readTheme());
    setOpen(!open);
  }

  function choose(next: Theme) {
    applyTheme(next);
    setTheme(next);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="true"
        aria-expanded={open}
        className="flex min-h-10 items-center rounded-md border border-line px-3 text-xs font-semibold uppercase tracking-wider text-text-soft transition-colors hover:bg-hover hover:text-text"
      >
        Account
      </button>
      {open && (
        <div
          role="group"
          aria-label="Account menu"
          className={`absolute z-50 w-56 rounded-xl border border-line bg-card p-3 shadow-lg ${
            placement === "above" ? "bottom-full left-0 mb-2" : "right-0 top-full mt-2"
          }`}
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Theme</p>
          <div className="grid grid-cols-2 gap-2">
            {THEMES.map((t) => (
              <button
                key={t.value}
                type="button"
                aria-pressed={theme === t.value}
                onClick={() => choose(t.value)}
                className={`min-h-10 rounded-md border text-sm font-medium transition-colors ${
                  theme === t.value
                    ? "border-gold bg-hover text-gold"
                    : "border-line text-text-soft hover:bg-hover hover:text-text"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
