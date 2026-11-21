import type { Metadata } from "next";
import Link from "next/link";
import { PageTitle } from "@/components/shell/page-title";
import { ListFilters, type OwnerFilter, type StatusFilter } from "@/components/mpc/list-filters";
import { MpcList } from "@/components/mpc/mpc-list";
import { PauseAll } from "@/components/mpc/pause-all";
import { primaryButton } from "@/components/mpc/ui";
import { requireMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listMpcs } from "@/lib/mpc/queries";
import { MPC_STATUSES } from "@/lib/mpc/schema";

export const metadata: Metadata = { title: "MPCs" };

type Props = { searchParams: Promise<{ owner?: string | string[]; status?: string | string[] }> };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function MpcsPage({ searchParams }: Props) {
  const member = await requireMember();
  const sp = await searchParams;
  const owner: OwnerFilter = first(sp.owner) === "all" ? "all" : "me";
  const statusParam = first(sp.status);
  const status: StatusFilter = MPC_STATUSES.find((s) => s === statusParam);

  const rows = await listMpcs(member, { owner, status });

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <PageTitle>MPCs</PageTitle>
          <p className="mt-2 text-sm text-text-soft">{rows.length === 1 ? "1 MPC" : `${rows.length} MPCs`}</p>
        </div>
        <Link href="/mpcs/new" className={`${primaryButton} inline-flex items-center`}>
          Add MPC
        </Link>
      </div>

      <ListFilters owner={owner} status={status} />
      <PauseAll canPauseAgency={can(member, "team.manage")} />

      {rows.length === 0 ? (
        <div className="rounded border border-line bg-card p-6 text-sm text-text-soft">
          {owner === "me" ? "You have no MPCs here yet." : "There are no MPCs here yet."}
        </div>
      ) : (
        <MpcList rows={rows} showOwner={owner === "all"} />
      )}
    </div>
  );
}
