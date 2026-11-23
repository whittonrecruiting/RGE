# RGE v1 Design: Recruiter Growth Engine

Date: 2026-11-20
Status: Approved by the founder, 2026-11-21
Source: design interview with the founder (2026-11-20), the MPC sales process handoff and Prospector's research process spec (both in `private/`, not committed).

## 1. Intent

RGE runs the candidate-led MPC (Most Placeable Candidate) sales process for a recruiting agency in one product: store MPCs, research who should hear about each one, draft hyper-targeted candidate-led pitches, put them in a daily approval feed, send approved emails safely from the recruiter's own inboxes, run a fixed follow-up sequence, handle replies, and track the resulting sales pipeline until a fee agreement is signed.

Today Whitton Recruiting (WR) runs this with about seven AI bots, text files, CSV logs and chat threads. It works but needs constant babysitting, rules drift between files, checks run by judgment and sometimes get skipped, and a live lead once ended up in a suppression file. RGE replaces the bots entirely.

WR uses RGE first, free, until it is dialed in and producing results. Then RGE is sold as a subscription to other recruiting agencies in any niche (legal, accounting, healthcare, tech, hospitality, trades).

Principle: **everything starts from the candidate.** RGE never starts from a company list and never sends generic "are you hiring" outreach. Research asks "who needs this person?", every email leads with the candidate, and results roll up per MPC.

## 2. Goals, non-goals, anti-goals

### Goals
- A recruiter's morning is: open RGE on phone or desktop, skim the day's drafts, approve all or most, deny a few. No bot conversations.
- Research finds up to 10 prospects per MPC per day, limited by what the agency's inboxes can safely send, and keeps going until a market is exhausted, flagging shortfalls.
- Every process rule is enforced by code, in a fixed order, every time.
- One record per contact and company, shared across the agency, so opt-outs, repeats, declines and live leads never get mixed up.
- Excellent on desktop and on phone, equally. Same features on both.
- Built for multiple agencies from day one, so public launch needs no rebuild.

### Non-goals (v1)
- Recruiting delivery after the agreement: submittals, interviews, placements, invoicing. Those stay in the agency's ATS and other tools.
- RGE's own contact database. Agencies bring their own data provider; built-in data is a later premium add-on.
- Subscription billing, self-serve public signup, Google's restricted-scope security review. These come at public launch, after WR dials it in.
- A campaign builder, multi-step sequence editor, company list uploads, or anything else that starts from companies.
- A native App Store app.
- Writing every pitch and reply back into the ATS.
- Creating redacted (blind) resumes. The recruiter attaches their own and moves the lead to "Resume sent." A redacted-resume generator is a candidate value-add for later.

### Anti-goals (failure even if it technically works)
- **Brand damage:** emails that read as AI or generic, wrong or inflated candidate facts, contacting opted-out people or marketplace clients, a domain that lands in spam.
- **Constant bottlenecks and snags:** the recruiter babysitting jobs, chasing failures, or checking several places to know whether it worked.
- **Unnecessary complexity:** settings and screens nobody needs (the stated weakness of tools like Flynt and Pin).

## 3. Users and accounts

- **Agency** is the account (tenant). All data belongs to one agency and is never visible to another.
- Roles:
  - **Owner:** everything, including adding and removing users, making admins, team-wide data, and (at public launch) billing.
  - **Admin:** manage users and settings and view team data; cannot delete the Owner or manage billing.
  - **Recruiter:** own login, own MPCs, own inbox(es), own approval feed and pipeline.
- **Shared across the agency:** companies, contacts, the contact ledger (sends, replies, declines), the opt-out and bounce list, the do-not-contact company list, agency settings.
- **Owned by a recruiter:** MPCs and pipeline leads. Teammates can view but not edit.
- WR setup: the founder is Owner; three recruiters are Recruiters.

## 4. Approaches considered

| Approach | What it is | Trade-off |
|---|---|---|
| **A. Custom web app (chosen)** | One codebase: web app, database, background jobs, AI calls, Gmail and data-provider integrations. | Most work up front. Full control of the rules, the look and the multi-agency model. The only option that can be sold as a product. |
| B. Assemble existing tools | A CRM plus a sending tool plus automation glue plus AI steps. | Fast to start, but cannot enforce the approval and suppression rules end to end, looks like several products, and cannot be sold. |
| C. Keep the bots, add a screen | Bots keep researching and sending; RGE becomes a dashboard over their files. | Least new work, but inherits every failure in the research spec (judgment-based checks, drifting files, skipped checks). Contradicts "the bots go away." |

The founder handed over the how ("start building"). A was chosen because it is the only one that meets the anti-goals and the plan to sell.

## 5. The daily loop

1. **Overnight, before the send window:** sync jobs refresh the contact ledger from connected Gmail inboxes and refresh ATS data.
2. **Research run** (default 5:00 AM in the agency's time zone, on send days): for each active MPC, find prospects up to the day's allocation (section 7), run checks, find the decision maker, verify the email, score and sort.
3. **Drafting:** draft a pitch for each qualified prospect from the agency template, then run the draft guard (section 8).
4. **Approval feed** is ready when the recruiter wakes up. A push notification says how many are waiting.
5. **Recruiter approves** (or auto approval, if turned on, approves clean drafts).
6. **Sending** starts at the send window opening, spaced and capped per inbox (section 10).
7. **Follow-ups** go out on schedule; **replies** are detected and handled continuously during the day (sections 11, 12).

## 6. MPCs (candidates)

### Adding and editing
- **Sources first (founder decision, 2026-11-23).** Add MPC starts with the recruiter's material, not a form: upload or paste any mix of resume (PDF, Word), interview notes and call transcripts, several at once. "Build profile" immediately saves a **Draft** MPC holding those documents, runs AI extraction, and shows the review. Nothing typed by hand is required to start.
- A Draft becomes **Active** automatically as soon as its required fields (headline role and location) are filled, from extraction or by hand. Until then the MPC page highlights the missing required fields in amber and the list shows a "Draft" badge. Drafts are never researched, drafted or pitched.
- If extraction cannot run (rate limit, outage, missing key), the Draft and its documents are still saved and the recruiter fills the profile by hand or retries.
- MPCs can also come from the connected ATS (Plan 6), landing as Drafts the same way.
- **Find more:** RGE searches the public web (firm bio, bar or license listings, published cases, articles, awards) and brings back facts with a source link for each.
- AI builds a structured profile. Every field and fact shows its source. The recruiter can edit, replace, add or delete anything at any time, including replacing the resume.

### Structured profile (industry-agnostic)
- Status: draft, active, paused (with reason), removed. Placed is terminal. Headline role and location may be empty only while Draft.
- Headline role type (used in subject lines and the opening line), location, years of experience, seniority.
- Industry and specialty tags (practice area for legal, unit for nursing, stack for engineering, and so on).
- Credentials: licenses, admissions, certifications, each with region and whether verified.
- Work preferences: on-site, hybrid or remote; employer type preference (for legal: in-house only, firm only, either); target cities.
- Pay floor (strict or flag-only) and target.
- **Pitchable facts:** accomplishments with source and status. Resume and linked-web facts are usable. Facts from notes or transcripts are **interview only** and are never used in a pitch until the recruiter taps Confirm.
- **Restrictions** (hard, the drafting AI cannot override): never-say phrases, confidential fields (for example current employer), excluded companies, region exclusions (for example "no roles requiring an Arizona license").
- Overlap priority with other MPCs (which MPC wins when two target the same company).
- Missing key fields (years, pay target) show as flags.

### Sample pitch (founder decision, 2026-11-23)
- Every MPC page has a **Sample pitch** card: an example pitch drafted from that MPC's usable and confirmed facts with the agency pitch template, using the speculative form (subject from the headline role, `[First Name]` left as a placeholder, no company). It runs through the same draft guard as real drafts (section 8) and is never sent.
- Readiness flag on the MPC list and page: **Pitch ready** when three strong usable or confirmed facts exist; **Needs facts** otherwise, with the reason ("Only 2 strong facts. Confirm a note or run Find more.").
- Controls: Regenerate; Swap a bullet (choose a different fact for one of the three); **Use these bullets**, which saves the recruiter's preferred three facts on the MPC. Real drafts (Plan 4) start from the saved bullets and change one only when a specific company calls for it. Editing or deleting a saved fact clears it from the saved bullets.
- Generating a sample counts as a paid AI call (metered and rate limited like extraction).

### Consent
- Each MPC has a consent record: date, method (verbal, email, signed form), optional uploaded proof.
- Missing consent is a **warning, not a block:** amber "No consent on file" badge on the MPC and on its drafts. RGE records that outreach went out without consent logged.

### Pause
- Pause outreach for one MPC or all MPCs. Pausing stops new research and drafting for that MPC and holds unsent approved pitches. Follow-ups on already-sent pitches continue unless the recruiter also pauses follow-ups.

## 7. Research

Rebuilt from Prospector's actual practice, with its failures fixed.

### Sources
- **Advertised openings:** employer applicant tracking system (ATS) APIs first (Greenhouse, Ashby, Lever, Workday), then job boards and web search. Record first published, updated and last-seen-live dates. LinkedIn is never logged in to.
- **Speculative targets:** required whenever an MPC lacks enough qualified openings. Each needs a specific candidate-based reason (specialty match, matter or work types, location, client base, growth, recent hires or expansion), never just "same industry."
- **Firm universe:** a saved, growing list of companies per specialty and region, with every company considered, pitched or rejected and the reason. Rejected companies are not re-researched unless something changes.

### Order of work (cheapest first; nothing paid until free checks pass)
1. Company-level exclusions: do-not-contact list (for example marketplace clients; entries match the company's domains and any parent or subsidiary names entered as aliases), recruiting-industry companies, MPC excluded companies, already handed off for this MPC.
2. Repeat check against the contact ledger: by company domain and by contact, within the agency's repeat window.
3. Decline check: any decline from that company in the ledger.
4. MPC hard filters: location, licensing, employer-type preference, overqualification limit, strict pay floor.
5. Decision maker search (free search on the data provider and the web).
6. Paid email lookup only for survivors.
7. Email quality tier and optional second validation.
8. Score and sort.

### Decision maker priority (default, agency-editable)
1. The person the role reports to, if named.
2. Leader of the relevant team or practice in the candidate's location; at small firms, the owner or managing partner.
3. Head of the function (for example General Counsel, CNO, VP Engineering).
4. Most senior relevant person found. HR and talent are a fallback only if the agency enables it.

### Email tiers
- T1 verified, not catch-all. T2 verified, catch-all domain. T3 independently validated. T4 published on the company site. T5 found in the agency's own sent mail. T6 unverified.
- Clean draft requires T1, or T2 plus T3. T4 and T5 produce a flagged draft. T6 goes to Needs research. Guessed patterns are never shown as verified.

### Postings
- Stale = not live on the employer's own ATS today, or first published more than the stale age (default 90 days) without an update. Aggregator-only postings are "unconfirmed" and flagged. A posting that disappears turns the prospect speculative or sends it to Needs research.

### Scoring and sorting
- Score (logged, shown under More): specialty match 0 to 3, seniority 0 to 2, location 0 to 2, pay 0 to 2 (unknown 1), hiring signal 0 to 2, decision-maker quality 0 to 2, email tier 0 to 2. A plain-English "why this company" line is always kept.
- Outcome buckets (replacing Sections A, B, C):
  - **Drop:** any hard rule fails. Logged with reason, never shown in the feed.
  - **Needs research:** no verified email, no decision maker, posting unconfirmed or stale, fit unestablished. Shown in a separate list, not the approval feed.
  - **Flagged draft (needs your call):** same contact within the repeat window, different contact at a non-large company within the window, company declined before, third pitch to the company for the same MPC, posting says "no recruiters," missing consent, weaker email tier, open question on the MPC. Drafted, shown in the feed with an amber flag, excluded from Approve all.
  - **Clean draft:** everything else, ordered advertised first, then by score.
- **Repeat rules, precisely** (all read from the agency-wide ledger, across every MPC and recruiter):
  - Same contact pitched within the repeat window, for any MPC by anyone: flagged.
  - Different contact at the same company within the window: flagged, unless the company is on the large-firm list (then clean with an info note).
  - Company declined before (any time): flagged.
  - Same MPC already pitched to this company (any contact, any time): dropped unless something new turned up (new posting, new decision maker); if new, flagged as "third pitch" once two prior pitches exist.
  - Overlap priority between MPCs is decided per research run: when two MPCs qualify for the same company the same day, the higher-priority MPC takes it; the other can take it on a later day subject to the rules above.
- Large-company rule: a different contact at a company on the agency's **large-firm list** (for WR: AmLaw and Big Law) is allowed within the repeat window and shown as clean with an info note.

### Volume and allocation
- Target: 10 prospects per MPC per day.
- Hard limit: total daily sending capacity (section 10). Research only fills capacity, so no credits are spent on prospects that cannot be sent.
- Allocation round-robin: one per active MPC, then a second each, up to 10 each or capacity.
- Shortfall flag per MPC with a reason ("found 3 of 10: few employers in this specialty within 50 miles").
- **Exhausted** status when no new qualified companies remain, with a prompt to widen (more cities, adjacent specialties, remote).

### Audit
- Every search, ATS call, data-provider call and AI research step is logged with inputs and outputs per run, viewable by Owners and Admins.
- Data-provider lookups used per day and per recruiter are shown so nobody is surprised by their provider bill.

## 8. Drafting

### Default pitch template (agency-editable)
```
Subject: [Role Title]?

Hi [First Name],

I'm working with a [location] [role type] whose [specific background] could be relevant to your team:

- [bullet]
- [bullet]
- [bullet]

Would you be open to a call to discuss?

Best,
[Signature]
[Agency postal address]
[Opt-out line]
```
- The agency postal address (required by US CAN-SPAM) is a required inbox or agency setting and appears on every pitch and follow-up, as WR's signature does today. Rules for agencies outside the US (GDPR, PECR, CASL) are handled at public launch.
- Advertised: subject uses the posted role title. Speculative: subject uses the candidate's role type. Both end with "?".
- Exactly three bullets of about 5 to 10 words: real highlights (results, volume, certifications earned through work), never baseline facts (school, license held, years), never team numbers as the candidate's, never interview-only facts unless confirmed.
- Opt-out line (default): "Prefer not to receive these candidate introductions? Reply 'stop' and I'll remove you."
- Signature: pulled from the sending inbox (HTML signature supported).

### Draft guard (runs on every draft and every AI edit; a failing draft is regenerated or held, never sent)
- No em dashes, no emojis, no bold, no links in the body.
- Template shape exact; exactly three bullets.
- Only confirmed facts; nothing from the never-say list; no confidential fields.
- No compensation, no work authorization, no candidate name.
- Speculative pitches never claim or imply the company is hiring.
- Recipient is a work email; candidates are only ever emailed at personal addresses (outside the MPC pitch flow).

### Ask RGE (chat)
- Desktop: docked panel beside the feed. Phone: an "AI" button in the bottom bar opens a sheet.
- Scope: changes to drafts within the template ("swap bullet 2 for her trade compliance work"), explanations ("why this company?"), and simple MPC updates. It cannot change the template shape, bypass the guard, or send.
- Any edit creates a new draft version; approval of a previous version is void.

## 9. Approval feed

- Single scrolling feed (layout A) with the real email preview (from layout B): each card shows Advertised or Speculative, company, contact name and title, flags, then the email rendered on white exactly as the recipient will see it (To, Subject, body, signature, opt-out line).
- Per card: **More** (why this company, why this person, posting link if any, email tier, checks passed, score), **Deny** (collapses to one line with Undo), **Approve**.
- Top: date, counts (drafts, denied, need your call), filter chips (All, Flagged, Advertised, Speculative).
- Bottom bar (fixed): AI chat button, "N ready · M flagged wait for you", **Approve N**. Approve all only includes clean drafts. Deny all is available with a confirm.
- Flagged cards have an amber border and the reason up top; each needs an individual decision.
- Desktop: wider center column, chat docked right, keyboard shortcuts (A approve, D deny, J/K next/previous, M more).
- Approval is per exact version (content hash). Sending verifies the hash; any change after approval voids it.
- **Approval mode** setting: manual (default) or auto. Auto requires a warning confirmation ("Emails will send without your review. You are responsible for every message sent from your account.") and can be set agency-wide or per MPC. Auto only approves clean drafts; flagged drafts and reply drafts always wait.
- Reply drafts (section 12) appear at the top of the feed, visually distinct. An approved reply sends immediately, any day and any hour, because speed after a "yes" is what closes; the send window applies to first-touch pitches and follow-ups only.
- **Supersedes CLAUDE.md's earlier summary:** by founder decision on 2026-11-20, the standing exceptions to per-email approval are (a) the two fixed follow-ups (section 11) and (b) auto approval of clean first-touch pitches when the user deliberately turns it on. Everything else still needs approval of the exact version.

Reference mockups: `private/mockups/approvals-mobile-v2.png` (phone), `approvals-a.png` and `approvals-b.png` (desktop directions).

## 10. Sending

- **Inboxes:** connect one or more Gmail or Google Workspace inboxes per recruiter (Microsoft 365 later). Choose which inbox an MPC sends from; default is the recruiter's primary.
- **Safe daily cap per inbox** (RGE-calculated, not a free number): new cold pitches default 40 per inbox per day, plus room for follow-ups. If a user asks for more total volume than inboxes allow, RGE says how many inboxes to add. No override.
- **Warm-up:** a new or never-used-for-cold inbox starts at about 10 new pitches a day and ramps to the full cap over about 2 to 3 weeks; shown as "warming up, day 6 of 18."
- **Send window:** agency setting. WR default: Monday to Thursday, 9:00 AM to 5:00 PM America/Phoenix, no sends at or after 5:00 PM (one constant). Due items outside the window roll to the next window.
- **Spacing:** at least 4 minutes between sends from the same inbox, and at least 1 minute after any other send from it.
- **Overflow:** approved pitches beyond today's capacity roll to the next send day, oldest first.
- **Pre-send checks** (again, at send time): suppression, repeat window, bounce history, version hash, inbox health.
- Each send is verified in Sent mail and recorded in the ledger with message id, thread id and time.
- **Domain setup check:** when an inbox is connected, RGE checks the sending domain's SPF, DKIM and DMARC records and warns (with fix steps) if any are missing.
- **Domain health:** bounce rate and spam complaints per inbox are tracked; past a threshold, RGE pauses that inbox automatically and says why.
- **Open tracking:** inbox setting, off by default. Turning it on shows: "Open tracking adds a hidden image to each email, which can hurt deliverability and land more of your emails in spam. Open counts are also inflated by email apps that preview messages automatically." Open rate displays as "estimated" and never counts as a response or moves a lead.

## 11. Follow-ups

- Fixed sequence, no editor: pitch, then follow-up 1 three business days later, then the breakup five business days after that. Both are replies in the same thread from the same inbox, sent automatically (the standing exception to per-email approval).
- Follow-up 1:
  ```
  Hey [First Name], thoughts on this candidate?
  [Signature]
  [Opt-out line]
  ```
- Breakup:
  ```
  Hi [First Name],

  Last email about this candidate. If I come across another candidate who could be a fit for your team, I'll reach out.

  Best,
  [Signature]
  [Opt-out line]
  ```
- Stops immediately on any human reply on the thread or from that company's domain, opt-out, bounce, or MPC pause. Business days follow the send window (a Friday due date goes Monday for WR).
- Wording is an agency setting; the step count and timing defaults are fixed.

## 12. Replies

- Inbound mail on connected inboxes is read continuously and classified: interested, declined, opt-out, out of office, bounce, automated. Opens and auto-replies are never human responses.
- **Interested:** stop follow-ups, create or move the lead to "Replied interested," send a push notification immediately, and draft a reply at the top of the feed. The reply draft thanks them, proposes 2 to 3 specific call times (from the connected Google Calendar's free time, else the recruiter's working hours setting), and offers the redacted resume. No booking links. Reply drafts are never sent automatically.
- **Declined:** logged on the contact and company; future pitches to that company become flagged.
- **Opt-out or bounce:** permanently suppressed agency-wide; pending follow-ups cancelled.
- **Out of office:** follow-up timing shifts past the return date when one is stated.
- If the recruiter replies directly in Gmail, RGE sees it and drafts nothing.

## 13. CRM (sales pipeline)

- Stages: Replied interested (10%), Call booked (25%), Resume sent (40%), Agreement sent (65%), Agreement signed (100%). Percentages are agency-editable defaults.
- Agreement signed turns the company into a **Client**: it leaves the pipeline, later email to it counts as client email, and (if an ATS is connected) the company and contacts are exported to the ATS as a client.
- **Lost** can be set at any stage with a short reason. Opt-outs are a separate list, not Lost.
- Each lead: company, contact, MPC, recruiter, stage, notes, value. Value defaults to the agency's **average fee** (set in CRM settings) and can be overridden per lead.
- Pipeline value = sum of value × stage chance; shown in total and per stage.
- Views: pipeline board (desktop) and stage list (phone); Lost list. Deal numbers (agreements sent and signed, pipeline value) live here.

## 14. Campaign tab (founder decision, 2026-11-23; replaces the separate Sent, Opt-outs and Dashboard tabs)

- Health strip at the top: "Research ran 5:02 AM · 74 drafts · 2 inboxes healthy · next send 9:00."
- **Performance**, with day, week and month ranges, filterable by recruiter and by MPC:
  - Sending: pitches sent, follow-ups sent, sends queued for tomorrow.
  - Replies: human reply rate, interested replies, calls booked, open rate (estimated, only if tracking is on).
  - Research: prospects found vs target, shortfalls, exhausted MPCs, data-provider lookups used.
  - Per-MPC roll-up ("40 pitched, 6 replies, 2 calls").
- **Activity:** every sent pitch and follow-up with its status (sent, replied, followed up, bounced, failed).
- **Opt-outs and bounces:** the agency's permanent do-not-email list.
- **Errors:** sends and research steps that failed, with the reason and whether RGE will retry.
- Owners and Admins see per-recruiter and team totals.
- Until sending exists (Plans 2 to 5), each section shows an empty state saying what will appear there.

## 15. Notifications

- Push (installed web app) and email: drafts ready, interested reply, something only the user can fix (inbox disconnected, data provider key failing, inbox auto-paused).
- Nothing else. No routine status pings.

## 16. Settings (kept minimal; every setting has a default and a one-line explanation)

- Agency: name, time zone, send days and window, repeat window (2 weeks, 30, 60, 90 days, custom; WR default 60), stale posting age (90 days), large-firm list, do-not-contact companies, recruiting-industry exclusion on or off, decision-maker priority, average fee, stage chances, approval mode.
- Templates: pitch, follow-up 1, breakup, opt-out line.
- Inboxes: connect, signature, daily cap (calculated, shown), warm-up status, open tracking.
- Integrations: data provider (Apollo first, ZoomInfo next), ATS (Loxo first, then Bullhorn and others), Google Calendar.
- Team (a section of Settings, not its own tab): users, roles, invites. Recruiters see it read-only.

## 17. Integrations

- **Gmail / Google Workspace:** send, read threads, read inbound, signature. All WR sending inboxes are on WR's own Google Workspace, so WR connects through an **internal** Workspace OAuth app (no Google verification, no weekly token expiry). Public launch requires a separate external app that passes Google's restricted-scope verification.
- **Google Calendar:** free/busy for proposing call times.
- **Contact data:** agency's own Apollo key first (people search, people match for work email only, never personal email, no waterfall, no phone, no Apollo sequences). ZoomInfo next. Built-in data later.
- **ATS:** Loxo first. Import candidates as MPCs; export signed clients (company and contacts). Bullhorn and others after.
- **No marketplace integrations** (Paraform or similar). The do-not-contact company list is maintained by hand or by CSV upload in settings; each entry holds the company name, domains and any parent or subsidiary aliases, and companies stay blocked until removed.
- **Web search and AI:** Claude models for research reasoning, fit writing, drafting, the guard's language checks, reply classification and Ask RGE; a web search tool for openings, company research and Find more.

## 18. Data model (summary)

- Agency, User, Membership (role).
- MPC (structured profile), MpcFact (source, status: usable, interview-only, confirmed), MpcRestriction, MpcConsent, MpcDocument (resume, notes, transcripts).
- Company (domains, aliases, size class, large-firm flag, do-not-contact flag and source, client flag), Contact (company, title, email, email tier, status).
- **Ledger event** (one table, agency-wide): contact, company, MPC, recruiter, inbox, event type (proposed, drafted, approved, denied, sent, follow-up sent, replied interested, replied declined, opted out, bounced, out of office, lead stage change, agreement signed), message and thread ids, timestamps. Suppression, repeat checks and the CRM read from it.
- Posting (source, URLs, dates, live status), Prospect (MPC × company × contact, bucket, score, reasons, research run), ResearchRun and ResearchLog.
- Draft (versioned, content hash), ApprovalDecision, SendJob, FollowUp, Reply, Lead (stage, value, notes, lost reason).
- Inbox (provider, tokens, cap, warm-up state, health), Settings, IntegrationConnection.

## 19. Migration of WR's existing data (before the first send)

Import from `private/`: the MPC roster (21 active, removals and holds as statuses, restrictions as structured fields), both suppression files merged, every send log and sales outcome, the companies WR already blocks as marketplace clients (into the do-not-contact list), and the founder's Gmail sent and inbound mail back to the start of MPC outreach (October 2026) or the longest repeat window, whichever is earlier, plus every inbox the bots or recruiters used for MPC outreach. Opt-outs, bounces and declines are imported regardless of age and stay permanent. Repeat and opt-out checks must know everyone the bots already emailed before RGE sends anything.

## 20. Look and feel

- Brand from the RGE logo package and the live RGE marketing page: background `#0A0A0A`, surfaces `#141414` / `#1A1A1A`, borders `#2A2A2A`, text `#F5F5F0` / `#CCCCCC`, muted `#888888`, gold `#C8A84E` (light `#D4B96A`, dark `#A68A3E`). Montserrat for UI; Playfair Display italic only as a rare accent. Uppercase headings with letter-spacing as on the marketing page. Buttons: gold primary, outline secondary, 6 px radius; cards 12 px radius.
- Gold is used sparingly for the things that matter: Approve, counts waiting on the user, positive replies. Amber `#E0A23A` for flags; muted red for deny and errors; green for sent and approved.
- Email previews render on white so the user sees exactly what the recipient sees.
- Dark by default; light theme uses the light logo variants.
- Logo: mark-only icon for favicon and collapsed nav; slim header logo for the top bar. Assets from the RGE logo package (copied into the app at build time).
- Desktop and phone are equal priorities. Every screen is designed and checked at both sizes before it counts as done.
- Navigation (founder decision, 2026-11-23): Approvals, MPCs, Pipeline, Campaign, Settings. Five tabs on every size; phone shows all five in the bottom bar with no menu sheet. Team lives inside Settings.

## 21. Reliability

- Every background step is retried automatically; a failed send never double-sends (idempotent by approval id).
- Inbox disconnects pause that inbox's sends and resume on reconnect.
- Empty data-provider results move to the next prospect.
- Runs and sends are checkpointed; a stopped batch resumes only within its approved scope and window.
- The user only hears about problems only the user can fix.

## 22. Security and privacy

- Agency data isolated at the database level.
- OAuth tokens and API keys encrypted at rest; never logged.
- Candidate names never appear in outgoing pitches. Resumes and notes are stored privately and only visible to the agency.
- No real candidate or client data in the code repository (per CLAUDE.md).

## 23. Running cost

- Today's comparison per recruiter per month: about $150 for Apollo (paid by the agency directly, unchanged under RGE) and about $30 for the bot running the sales outreach.
- The founder considers $100 to $200 per person per month fair, and only if RGE produces the same results. RGE must not cost 2 to 3 times today's spend.
- Design target: AI, web search, hosting and job costs stay **at or under about $50 per active recruiter per month** at full inbox capacity, with a hard ceiling of $100. That leaves room to price the subscription in the $100 to $200 range.
- How: cheaper, faster Claude models for bulk steps (posting matching, reply sorting, guard checks), the strongest model only where quality shows (fit reasoning and drafting); reuse the saved firm universe and cached company research across MPCs and recruiters instead of re-researching; research only up to sending capacity; no paid lookups before free checks.
- Usage is metered per agency and per recruiter from day one and shown to Owners, so cost per pitch and per agreement is visible while WR dials it in.

## 24. Technical shape (builder's call, recorded here)

- TypeScript web app (Next.js) deployed on Vercel, installable to the home screen with web push.
- Postgres database with row-level agency isolation.
- Durable background job runner for research runs, spaced sends, follow-ups and syncs (supports sleeps of minutes to days and retries).
- File storage for resumes and transcripts.
- Claude via the Anthropic API for AI steps.
- Exact libraries and services are settled in the implementation plan.

## 25. Calls made by the designer (not raised by the founder; check these)

1. Flagged drafts are excluded from Approve all.
2. Each feed card shows the full email, not a two-line preview.
3. Auto approval covers clean first-touch pitches only and can be per MPC.
4. Interview-only facts need a tap to confirm before use; resume and linked-web facts are usable by default.
5. Warm-up ramp for new inboxes; default cap 40 new pitches per inbox per day.
6. Pause stops research and new sends but not follow-ups on already-sent pitches unless also paused.
7. Out-of-office replies delay follow-ups instead of stopping them.
8. Public-launch items (billing, signup, Google security review) come after WR's dial-in.
9. WR's history is imported before the first send.
10. Web app installable on phones rather than a native app.
11. Agency settings: repeat window, stale age, large-firm list, decision-maker priority, do-not-contact list, templates.
12. Repeat rules across MPCs and recruiters as written in section 7; overlap priority decided per research run.
13. Approved replies send immediately at any hour; the send window applies to pitches and follow-ups.
14. Agency postal address required on every pitch and follow-up (CAN-SPAM).
15. Running-cost target of about $50 per recruiter per month, ceiling $100, read from "$100 to $200 per person would be fair" as the subscription price range.
16. Do-not-contact companies are a manual or CSV list (no marketplace integration, per founder).

## 26. Left to the builder

- Exact libraries, schema details and job runner choice.
- Exact scoring weights and thresholds after the first weeks of WR data.
- Exact domain-health thresholds for auto-pause.
- Wording of empty states, errors and settings help text (plain, no em dashes).
