
-- Team removal is soft (memberships.status = 'removed'). The app can no longer delete membership
-- rows, so a removed member's references from MPCs, consents and facts stay intact, and it can
-- update the status (alongside the role) of memberships in its own agency.
REVOKE DELETE ON "memberships" FROM rge_app;--> statement-breakpoint
GRANT UPDATE ("status") ON "memberships" TO rge_app;
