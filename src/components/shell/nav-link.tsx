"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "./nav-items";

function useActive(href: string) {
  const pathname = usePathname();
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarLink({ item }: { item: NavItem }) {
  const active = useActive(item.href);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-10 items-center rounded-md px-3 text-sm font-medium transition-colors ${
        active ? "bg-hover text-gold" : "text-text-soft hover:bg-hover hover:text-text"
      }`}
    >
      {item.label}
    </Link>
  );
}

export function TabLink({ item }: { item: NavItem }) {
  const active = useActive(item.href);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-14 flex-1 items-center justify-center px-1 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
        active ? "text-gold" : "text-muted hover:text-text"
      }`}
    >
      {item.label}
    </Link>
  );
}
