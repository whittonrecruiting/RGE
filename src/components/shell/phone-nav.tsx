"use client";

import { TabLink } from "./nav-link";
import { PHONE_TAB_ITEMS } from "./nav-items";

export function PhoneNav() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {PHONE_TAB_ITEMS.map((item) => (
        <TabLink key={item.href} item={item} />
      ))}
    </nav>
  );
}
