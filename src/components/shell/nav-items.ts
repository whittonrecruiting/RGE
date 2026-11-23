export type NavItem = { label: string; href: string };

export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Approvals", href: "/approvals" },
  { label: "MPCs", href: "/mpcs" },
  { label: "Pipeline", href: "/pipeline" },
  { label: "Campaign", href: "/campaign" },
  { label: "Settings", href: "/settings" },
] as const;

/** Shown as bottom tabs on phones (<768px): all five, no Menu sheet. */
export const PHONE_TAB_ITEMS = NAV_ITEMS;
