import { asc, eq } from "drizzle-orm";
import { inboxes, users, type InboxStatus } from "@/db/schema";
import { withAgency } from "@/db/with-agency";
import type { Member } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { parseDomainCheck, type DomainCheck } from "./domain-check";

export type InboxView = {
  id: string;
  email: string;
  ownerName: string;
  isMine: boolean;
  status: InboxStatus;
  isPrimary: boolean;
  hasSignature: boolean;
  domainCheck: DomainCheck | null;
  backfillFrom: Date;
  backfillDoneAt: Date | null;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
  canManage: boolean;
};

/** Every inbox in the member's agency, the member's own first. Never selects credentials. */
export async function listInboxes(member: Member): Promise<InboxView[]> {
  const rows = await withAgency(member.agencyId, (tx) =>
    tx
      .select({
        id: inboxes.id,
        email: inboxes.email,
        userId: inboxes.userId,
        ownerName: users.name,
        status: inboxes.status,
        isPrimary: inboxes.isPrimary,
        signatureHtml: inboxes.signatureHtml,
        domainCheck: inboxes.domainCheck,
        backfillFrom: inboxes.backfillFrom,
        backfillDoneAt: inboxes.backfillDoneAt,
        lastSyncedAt: inboxes.lastSyncedAt,
        lastSyncError: inboxes.lastSyncError,
      })
      .from(inboxes)
      .innerJoin(users, eq(users.id, inboxes.userId))
      .orderBy(asc(inboxes.email)),
  );
  const views = rows.map(
    (r): InboxView => ({
      id: r.id,
      email: r.email,
      ownerName: r.ownerName,
      isMine: r.userId === member.userId,
      status: r.status,
      isPrimary: r.isPrimary,
      hasSignature: Boolean(r.signatureHtml),
      domainCheck: parseDomainCheck(r.domainCheck),
      backfillFrom: r.backfillFrom,
      backfillDoneAt: r.backfillDoneAt,
      lastSyncedAt: r.lastSyncedAt,
      lastSyncError: r.lastSyncError,
      canManage: can(member, "inbox.manage", { ownerUserId: r.userId }),
    }),
  );
  return [...views.filter((v) => v.isMine), ...views.filter((v) => !v.isMine)];
}
