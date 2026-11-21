import { describe, expect, it } from "vitest";
import { NAV_ITEMS, PHONE_MENU_ITEMS, PHONE_TAB_ITEMS } from "./nav-items";

describe("nav items", () => {
  it("keeps the agreed order", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual([
      "Approvals",
      "MPCs",
      "Pipeline",
      "Sent",
      "Opt-outs",
      "Dashboard",
      "Team",
      "Settings",
    ]);
  });
  it("splits phone tabs from the menu sheet without losing items", () => {
    expect(PHONE_TAB_ITEMS.map((i) => i.label)).toEqual(["Approvals", "MPCs", "Pipeline", "Sent"]);
    expect([...PHONE_TAB_ITEMS, ...PHONE_MENU_ITEMS]).toEqual([...NAV_ITEMS]);
  });
});
