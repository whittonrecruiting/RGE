"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TabLink } from "./nav-link";
import { PHONE_MENU_ITEMS, PHONE_TAB_ITEMS } from "./nav-items";

export function PhoneNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 bg-black/60 md:hidden"
          />
          <div
            role="dialog"
            aria-label="More navigation"
            className="fixed inset-x-0 bottom-14 z-40 rounded-t-xl border-t border-line bg-surface p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:hidden"
          >
            <ul className="flex flex-col gap-1">
              {PHONE_MENU_ITEMS.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="flex min-h-12 items-center rounded-md px-3 text-sm font-medium text-text-soft transition-colors hover:bg-hover hover:text-text"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {PHONE_TAB_ITEMS.map((item) => (
          <TabLink key={item.href} item={item} />
        ))}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className={`flex min-h-14 flex-1 items-center justify-center px-1 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
            open ? "text-gold" : "text-muted hover:text-text"
          }`}
        >
          Menu
        </button>
      </nav>
    </>
  );
}
