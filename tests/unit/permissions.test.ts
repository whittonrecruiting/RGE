import { describe, expect, test } from "vitest";
import { can } from "@/lib/permissions";

const rec = { userId: "u1", agencyId: "a", role: "recruiter" } as const;
const admin = { ...rec, userId: "u2", role: "admin" } as const;
const owner = { ...rec, userId: "u3", role: "owner" } as const;

describe("can", () => {
  test("recruiter edits only own MPC", () => {
    expect(can(rec, "mpc.edit", { ownerUserId: "u1" })).toBe(true);
    expect(can(rec, "mpc.edit", { ownerUserId: "u9" })).toBe(false);
    expect(can(rec, "mpc.view", { ownerUserId: "u9" })).toBe(true);
  });

  test("admin and owner edit any MPC", () => {
    expect(can(admin, "mpc.edit", { ownerUserId: "u9" })).toBe(true);
    expect(can(owner, "mpc.edit", { ownerUserId: "u9" })).toBe(true);
  });

  test("admin cannot remove or re-role the owner", () => {
    expect(can(admin, "team.remove", { targetRole: "owner" })).toBe(false);
    expect(can(admin, "team.setRole", { targetRole: "owner" })).toBe(false);
    expect(can(admin, "team.remove", { targetRole: "recruiter" })).toBe(true);
    expect(can(rec, "team.manage")).toBe(false);
    expect(can(rec, "settings.edit")).toBe(false);
  });

  test("recruiter edit without a known owner is denied (fail closed)", () => {
    expect(can(rec, "mpc.edit")).toBe(false);
  });

  test("owner manages the team and settings; admin manages team and settings", () => {
    expect(can(owner, "team.manage")).toBe(true);
    expect(can(owner, "settings.edit")).toBe(true);
    expect(can(owner, "team.setRole", { targetRole: "admin" })).toBe(true);
    expect(can(admin, "team.manage")).toBe(true);
    expect(can(admin, "settings.edit")).toBe(true);
    expect(can(admin, "team.setRole", { targetRole: "recruiter" })).toBe(true);
  });

  test("team actions need a target role and the owner cannot be removed by anyone", () => {
    expect(can(admin, "team.remove")).toBe(false);
    expect(can(owner, "team.remove", { targetRole: "owner" })).toBe(false);
    expect(can(rec, "team.remove", { targetRole: "recruiter" })).toBe(false);
    expect(can(rec, "team.setRole", { targetRole: "recruiter" })).toBe(false);
  });

  test("recruiter can manage own inbox only", () => {
    expect(can(rec, "inbox.connect")).toBe(true);
    expect(can(rec, "inbox.manage", { ownerUserId: "u1" })).toBe(true);
    expect(can(rec, "inbox.manage", { ownerUserId: "u9" })).toBe(false);
    expect(can(rec, "inbox.manage")).toBe(false);
    expect(can(admin, "inbox.manage", { ownerUserId: "u9" })).toBe(true);
  });

  test("only managers edit do-not-contact and import history", () => {
    for (const a of ["dnc.edit", "history.import"] as const) {
      expect(can(rec, a)).toBe(false);
      expect(can(admin, a)).toBe(true);
      expect(can(owner, a)).toBe(true);
    }
  });

  test("any member can add a suppression", () => {
    expect(can(rec, "suppression.add")).toBe(true);
    expect(can(admin, "suppression.add")).toBe(true);
  });
});
