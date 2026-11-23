import { describe, expect, it } from "vitest";
import { NAV_ITEMS, PHONE_TAB_ITEMS } from "./nav-items";

describe("nav items", () => {
  it("keeps the agreed order", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(["Approvals", "MPCs", "Pipeline", "Campaign", "Settings"]);
    expect(NAV_ITEMS.map((i) => i.href)).toEqual(["/approvals", "/mpcs", "/pipeline", "/campaign", "/settings"]);
  });
  it("shows all five as phone tabs", () => {
    expect(PHONE_TAB_ITEMS.map((i) => i.label)).toEqual(["Approvals", "MPCs", "Pipeline", "Campaign", "Settings"]);
  });
});
