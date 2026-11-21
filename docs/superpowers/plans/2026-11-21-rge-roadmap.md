# RGE v1 Build Roadmap

Spec: `docs/superpowers/specs/2026-11-20-rge-v1-design.md`

The spec covers several subsystems. It is built as six plans, in order. Each plan ends with working, deployed software that the WR team can use for what it covers. Each later plan is written when the previous one is done, against the code that exists then.

| # | Plan | Ends with | Spec sections |
|---|------|-----------|---------------|
| 1 | Foundation | Team signs in, roles work, MPCs can be added from a resume, notes, transcripts or Find more, edited, paused, consent recorded; agency settings with defaults; branded shell on desktop and phone; deployed. | 3, 6, 16 (settings skeleton), 20, 22 |
| 2 | Ledger and inboxes | Gmail inboxes connected (internal Workspace app), contact and company ledger, opt-out and bounce list, do-not-contact list (manual and CSV), WR history imported. | 10 (connect, domain checks), 17 (Gmail), 18, 19 |
| 3 | Research engine | Daily research run: openings and speculative targets, checks in order, Apollo, email tiers, scoring, buckets, allocation, firm universe, audit log, usage metering. | 7, 23 |
| 4 | Drafting and approvals | Drafts from templates, draft guard, approval feed (phone and desktop), Ask RGE, approval modes, version hashes. | 8, 9 |
| 5 | Sending, follow-ups, replies | Capacity caps, warm-up, send window, spacing, overflow, domain health, open tracking setting, fixed follow-ups, reply classification and reply drafts, push notifications. | 10, 11, 12, 15, 21 |
| 6 | CRM, dashboard, integrations | Pipeline stages and value, Lost, Clients, dashboard and health strip, Loxo import and export, Google Calendar times. | 13, 14, 17 (Loxo, Calendar) |

WR switches off the bots after Plan 5 is verified against live sends; Plan 6 follows.
