"use client";

import { BuildReview } from "@/components/mpc/BuildReview";

// Same text as USER_HOURLY_LIMIT_ERROR; that module reads the database, so it is not imported here.
const LIMITED = "You've hit the hourly limit for AI lookups. Try again later.";

// Dev layout check only: the review step after Build profile when the extraction is rate limited.
export function ReviewFailurePreview() {
  return <BuildReview mpcId="a" extract={async () => ({ ok: false, error: LIMITED })} />;
}
