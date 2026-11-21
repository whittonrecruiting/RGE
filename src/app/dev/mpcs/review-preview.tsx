"use client";

import { ExtractionReview } from "@/components/mpc/ExtractionReview";
import type { ProfileDraft } from "@/lib/ai/extract-profile";

// Dev layout check only: the review panel with a no-op close handler.
export function ReviewPreview({ draft }: { draft: ProfileDraft }) {
  return <ExtractionReview mpcId="a" draft={draft} issuedAt={0} signature="" onClose={() => {}} />;
}
