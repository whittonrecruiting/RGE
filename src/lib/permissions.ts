import type { Member, Role } from "./auth";

export type Action = "mpc.view" | "mpc.edit" | "team.manage" | "team.setRole" | "team.remove" | "settings.edit";

export type PermissionTarget = { ownerUserId?: string; targetRole?: Role };

const isManager = (role: Role) => role === "owner" || role === "admin";

/**
 * What a member may do inside their own agency. Agency isolation itself is enforced by
 * row-level security; this decides roles within an agency. Unknown or incomplete targets deny.
 */
export function can(member: Member, action: Action, target: PermissionTarget = {}): boolean {
  switch (action) {
    case "mpc.view":
      return true;
    case "mpc.edit":
      if (isManager(member.role)) return true;
      return target.ownerUserId !== undefined && target.ownerUserId === member.userId;
    case "team.manage":
    case "settings.edit":
      return isManager(member.role);
    case "team.setRole":
    case "team.remove":
      // There is exactly one Owner; nobody removes or re-roles them here (ownership transfer is
      // a separate, deliberate flow).
      return isManager(member.role) && target.targetRole !== undefined && target.targetRole !== "owner";
    default: {
      const unknown: never = action;
      void unknown;
      return false;
    }
  }
}
