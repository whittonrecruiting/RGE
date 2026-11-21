# Working in this repository

## What this is
RGE (Recruiter Growth Engine) is software that runs the candidate-led MPC sales process for recruiting agencies: store and manage MPC candidates, research and qualify prospects, draft pitches, present a daily numbered approval list, send approved emails through the recruiter's Gmail, run the one-touch follow-up, classify replies, and track agreements, placements and KPIs. Whitton Recruiting (WR) uses it free as the proving ground; other agencies pay a subscription.

Keep RGE strategy and economics separate from WR's recruiting business.

## Current phase
Build. The approved design is `docs/superpowers/specs/2026-11-20-rge-v1-design.md` (approved 2026-11-21). Build to it; changes to scope go back through a design update.

## Data and privacy rules
- Never commit candidate names, prospect or client contacts, email addresses, resumes, compensation, Loxo or Paraform exports, or any credential.
- Working files with real data go in `private/` (git-ignored). The process handoff (`mpc-sales-process-handoff.md`) belongs there, not in `docs/`.
- Secrets go in `.env.local` (git-ignored), never in code.

## Process rules the software must enforce
The approved design spec is the source of truth for product behavior; the MPC sales process handoff in `private/` is background on how WR works today. Summary of the non-negotiables:
- Nothing is sent without the recruiter's approval of the exact version; any edit voids approval. Standing exceptions (founder decision, 2026-11-20): the two fixed follow-ups, and auto approval of clean first-touch pitches when a user deliberately turns it on.
- Never contact companies on the agency's do-not-contact list (for example marketplace clients).
- Same contact within the repeat window (agency setting, WR default 60 days), declines, and repeat companies not on the large-firm list require a human decision.
- Opt-outs and bounces are permanently suppressed.
- Work email for prospects, personal email for candidates.
- Never invent or inflate candidate facts; interview-only facts stay out of emails.
- Never claim a speculative firm is hiring. No compensation, work authorization or confidential employer in a pitch. No em dashes.
- Send window is an agency setting; WR default Mon to Thu, before 5 PM Phoenix, spaced at least 4 minutes apart, within each inbox's safe daily cap.

## Writing style for drafts
Direct, consultative, leader to leader. No em dashes, no hype, no emojis.
