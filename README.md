# RGE: Recruiter Growth Engine

Proprietary software for running the candidate-led **MPC (Most Placeable Candidate)** sales process end to end: candidate roster, prospect research, pitch drafting, a daily approval list, Gmail sending, follow-ups, reply handling, fee agreements and reporting.

Whitton Recruiting is the first user and runs on it for free; RGE is the product that other recruiting agencies subscribe to.

## Status

Design phase. The concept is being dialed in before any product code is written. See `docs/` for design documents as they are approved.

## Repository layout

```
docs/        Design docs, specs and plans (no candidate or client data)
private/     Local-only working files, ignored by git (handoffs, rosters, exports)
```

## Data rule

This repository must never contain candidate names, client contacts, email addresses, resumes, API keys or OAuth tokens. Real data lives in the application database and in `private/` (git-ignored). See `CLAUDE.md`.
