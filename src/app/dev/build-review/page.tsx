import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import { BuildReviewPreview } from "./review-preview";

// The step after Build profile, with no auth and a stand-in extraction. Not available in production.
// ?review=fail: the extraction is rate limited. ?review=ok: the review opens. Like the MPC page, the
// review strips ?review from the address; "Re-render without review" renders this page again without it.
type Props = { searchParams: Promise<{ review?: string }> };

export default async function Page({ searchParams }: Props) {
  if (process.env.NODE_ENV === "production") notFound();
  const { review } = await searchParams;
  return (
    <AppShell>
      <div className="flex min-w-0 flex-col gap-6">
        <PageTitle>Build review</PageTitle>
        <p className="text-xs text-muted">Server render: {review ? `review=${review}` : "no review"}</p>
        <BuildReviewPreview outcome={review === "fail" || review === "ok" ? review : null} />
      </div>
    </AppShell>
  );
}
