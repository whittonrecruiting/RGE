"use client";

import { useRouter } from "next/navigation";
import { BuildReview } from "@/components/mpc/BuildReview";
import type { ProfileDraft } from "@/lib/ai/extract-profile";

// Same text as USER_HOURLY_LIMIT_ERROR; that module reads the database, so it is not imported here.
const LIMITED = "You've hit the hourly limit for AI lookups. Try again later.";

const draft: ProfileDraft = {
  fields: { yearsExperience: 8, workMode: "hybrid" },
  facts: [
    {
      text: "Led discovery on a $120M breach of contract matter",
      sourceKind: "resume",
      sourceRef: "sample-resume.pdf",
      sourceQuote: "Led discovery on a $120M breach of contract matter",
    },
  ],
  restrictionsSuggested: [],
} as ProfileDraft;

// Dev layout checks only: the step after Build profile with a stand-in extraction that fails
// (rate limited) or succeeds. "Re-render without review" makes the server render this page again with
// no ?review, as a revalidating server action on the MPC page can.
export function BuildReviewPreview({ outcome }: { outcome: "fail" | "ok" | null }) {
  const router = useRouter();
  return (
    <>
      <BuildReview
        mpcId="a"
        autoStart={outcome !== null}
        extract={async () =>
          outcome === "fail" ? { ok: false, error: LIMITED } : { ok: true, draft, issuedAt: 0, signature: "" }
        }
      />
      <div>
        <button type="button" onClick={() => router.replace("/dev/build-review")} className="text-sm text-text-soft underline">
          Re-render without review
        </button>
      </div>
    </>
  );
}
