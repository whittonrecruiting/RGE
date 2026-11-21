# Working in this repository

## What this is
RGE (Recruiter Growth Engine) is software that runs the candidate-led MPC sales process for recruiting agencies: store and manage MPC candidates, research and qualify prospects, draft pitches, present a daily numbered approval list, send approved emails through the recruiter's Gmail, run the one-touch follow-up, classify replies, and track agreements, placements and KPIs. Whitton Recruiting (WR) uses it free as the proving ground; other agencies pay a subscription.

Keep RGE strategy and economics separate from WR's recruiting business.

## Current phase
Ideation and design. Do not scaffold or write product code until a design doc in `docs/superpowers/specs/` is approved.

## Data and privacy rules
- Never commit candidate names, prospect or client contacts, email addresses, resumes, compensation, Loxo or Paraform exports, or any credential.
- Working files with real data go in `private/` (git-ignored). The process handoff (`mpc-sales-process-handoff.md`) belongs there, not in `docs/`.
- Secrets go in `.env.local` (git-ignored), never in code.

## Process rules the software must enforce
The source of truth is the MPC sales process handoff in `private/`. Summary of the non-negotiables:
- Nothing is sent without the recruiter's approval of the exact version; any edit voids approval. The only standing exception is the one-touch follow-up.
- Never contact the agency's Paraform (or other marketplace) clients.
- Same contact within 60 days, declines, and non-Big-Law repeat firms require a human decision.
- Opt-outs and bounces are permanently suppressed.
- Work email for prospects, personal email for candidates.
- Never invent or inflate candidate facts; interview-only facts stay out of emails.
- Never claim a speculative firm is hiring. No compensation, work authorization or confidential employer in a pitch. No em dashes.
- Send window Mon to Thu, before 5 PM Phoenix, spaced 4 minutes apart.

## Writing style for drafts
Direct, consultative, leader to leader. No em dashes, no hype, no emojis.
