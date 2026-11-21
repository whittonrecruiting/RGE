export type NavItem = { label: string; href: string };

export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Approvals", href: "/approvals" },
  { label: "MPCs", href: "/mpcs" },
  { label: "Pipeline", href: "/pipeline" },
  { label: "Sent", href: "/sent" },
  { label: "Opt-outs", href: "/opt-outs" },
  { label: "Dashboard", href: "/dashboard" },
  { label: "Team", href: "/team" },
  { label: "Settings", href: "/settings" },
] as const;

/** Shown as bottom tabs on phones (<768px). */
export const PHONE_TAB_ITEMS = NAV_ITEMS.slice(0, 4);

/** Reached through the Menu sheet on phones. */
export const PHONE_MENU_ITEMS = NAV_ITEMS.slice(4);
