import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { agencies, memberships, users } from "@/db/schema";
import { POST } from "@/app/api/webhooks/clerk/route";
import { createClerkWebhookHandler } from "@/lib/clerk-webhook";
import { asOwner, createTestDb, type TestDb } from "../helpers/test-db";

// A throwaway signing secret generated per run (not a Clerk credential). Payloads are signed the
// way Clerk (Svix / Standard Webhooks) signs them, and verified by Clerk's real verifyWebhook.
const secretBytes = randomBytes(32);
const SECRET = `whsec_${secretBytes.toString("base64")}`;

let db: TestDb;
let close: (() => Promise<void>) | undefined;
beforeEach(async () => {
  vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", SECRET);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const t = await createTestDb();
  db = t.db;
  close = t.close;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await close?.();
  close = undefined;
});

function signedRequest(event: unknown, opts: { sign?: boolean; secret?: Buffer } = {}): Request {
  const body = JSON.stringify(event);
  const headers = new Headers({ "content-type": "application/json" });
  if (opts.sign !== false) {
    const id = `msg_${randomUUID()}`;
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = createHmac("sha256", opts.secret ?? secretBytes).update(`${id}.${ts}.${body}`).digest("base64");
    headers.set("svix-id", id);
    headers.set("svix-timestamp", ts);
    headers.set("svix-signature", `v1,${sig}`);
  }
  return new Request("http://localhost/api/webhooks/clerk", { method: "POST", headers, body });
}

const org = (over: Record<string, unknown> = {}) => ({
  object: "organization",
  id: "org_abc",
  name: "Acme Recruiting",
  slug: "acme",
  created_at: 1,
  updated_at: 1,
  ...over,
});

const membershipEvent = (type: string, role = "org:admin", over: Record<string, unknown> = {}) => ({
  type,
  object: "event",
  data: {
    object: "organization_membership",
    id: "orgmem_1",
    role,
    permissions: [],
    created_at: 1,
    updated_at: 1,
    organization: org(),
    public_user_data: {
      identifier: "pat@acme.example",
      first_name: "Pat",
      last_name: "Lee",
      image_url: "",
      has_image: false,
      user_id: "user_pat",
    },
    ...over,
  },
});

const userEvent = (type: string, over: Record<string, unknown> = {}) => ({
  type,
  object: "event",
  data: {
    object: "user",
    id: "user_pat",
    first_name: "Pat",
    last_name: "Lee",
    primary_email_address_id: "idn_2",
    email_addresses: [
      { id: "idn_1", object: "email_address", email_address: "old@acme.example" },
      { id: "idn_2", object: "email_address", email_address: "pat@acme.example" },
    ],
    created_at: 1,
    updated_at: 1,
    ...over,
  },
});

async function snapshot() {
  return asOwner(db, async (tx) => ({
    agencies: await tx.select().from(agencies),
    users: await tx.select().from(users),
    memberships: await tx.select().from(memberships),
  }));
}

describe("Clerk webhook", () => {
  test("a signed organizationMembership.created creates agency, user and membership (org:admin -> admin)", async () => {
    const res = await POST(signedRequest(membershipEvent("organizationMembership.created")));
    expect(res.status).toBe(200);
    const s = await snapshot();
    expect(s.agencies).toEqual([expect.objectContaining({ clerkOrgId: "org_abc", name: "Acme Recruiting" })]);
    expect(s.users).toEqual([
      expect.objectContaining({ clerkUserId: "user_pat", email: "pat@acme.example", name: "Pat Lee" }),
    ]);
    expect(s.memberships).toEqual([
      expect.objectContaining({ agencyId: s.agencies[0].id, userId: s.users[0].id, role: "admin" }),
    ]);
  });

  test("an unsigned payload returns 401 and writes nothing", async () => {
    const res = await POST(signedRequest(membershipEvent("organizationMembership.created"), { sign: false }));
    expect(res.status).toBe(401);
    expect(await snapshot()).toEqual({ agencies: [], users: [], memberships: [] });
  });

  test("a payload signed with the wrong secret returns 401 and writes nothing", async () => {
    const res = await POST(
      signedRequest(membershipEvent("organizationMembership.created"), { secret: randomBytes(32) }),
    );
    expect(res.status).toBe(401);
    expect(await snapshot()).toEqual({ agencies: [], users: [], memberships: [] });
  });

  test("a missing signing secret is a server configuration error, not a 401", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(signedRequest(membershipEvent("organizationMembership.created")));
    expect(res.status).toBe(500);
    expect(await res.text()).toMatch(/CLERK_WEBHOOK_SIGNING_SECRET/);
    expect(await snapshot()).toEqual({ agencies: [], users: [], memberships: [] });
  });

  test("replaying the same events changes nothing", async () => {
    const events = [
      { type: "organization.created", object: "event", data: org() },
      userEvent("user.created"),
      membershipEvent("organizationMembership.created", "org:recruiter"),
    ];
    for (const e of events) expect((await POST(signedRequest(e))).status).toBe(200);
    const first = await snapshot();
    for (const e of events) expect((await POST(signedRequest(e))).status).toBe(200);
    expect(await snapshot()).toEqual(first);
    expect(first.memberships).toHaveLength(1);
  });

  test("organization.updated renames the agency; user.updated changes email and name", async () => {
    await POST(signedRequest(membershipEvent("organizationMembership.created")));
    await POST(signedRequest({ type: "organization.updated", object: "event", data: org({ name: "Acme Talent" }) }));
    await POST(
      signedRequest(
        userEvent("user.updated", {
          first_name: "Patricia",
          primary_email_address_id: "idn_1",
        }),
      ),
    );
    const s = await snapshot();
    expect(s.agencies[0].name).toBe("Acme Talent");
    expect(s.users[0]).toMatchObject({ name: "Patricia Lee", email: "old@acme.example" });
  });

  test("a membership event does not overwrite a newer agency name or user profile", async () => {
    await POST(signedRequest({ type: "organization.created", object: "event", data: org({ name: "Acme Talent" }) }));
    await POST(signedRequest(userEvent("user.created", { first_name: "Patricia" })));
    await POST(signedRequest(membershipEvent("organizationMembership.created")));
    const s = await snapshot();
    expect(s.agencies[0].name).toBe("Acme Talent");
    expect(s.users[0].name).toBe("Patricia Lee");
  });

  test("organizationMembership.updated changes the role", async () => {
    await POST(signedRequest(membershipEvent("organizationMembership.created", "org:recruiter")));
    await POST(signedRequest(membershipEvent("organizationMembership.updated", "org:owner")));
    expect((await snapshot()).memberships[0].role).toBe("owner");
  });

  test("an unknown Clerk role maps to recruiter and logs a warning", async () => {
    const res = await POST(signedRequest(membershipEvent("organizationMembership.created", "org:member")));
    expect(res.status).toBe(200);
    expect((await snapshot()).memberships[0].role).toBe("recruiter");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("org:member"));
  });

  test("organization.deleted keeps our rows and logs", async () => {
    await POST(signedRequest(membershipEvent("organizationMembership.created")));
    const before = await snapshot();
    expect(
      (await POST(signedRequest({ type: "organization.deleted", object: "event", data: { object: "organization", id: "org_abc", deleted: true } }))).status,
    ).toBe(200);
    expect(await snapshot()).toEqual(before);
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("organization.deleted"));
  });

  test("unhandled event types are acknowledged and ignored", async () => {
    const res = await POST(signedRequest({ type: "session.created", object: "event", data: { id: "sess_1" } }));
    expect(res.status).toBe(200);
    expect(await snapshot()).toEqual({ agencies: [], users: [], memberships: [] });
  });

  test("the verifier is injectable", async () => {
    const handler = createClerkWebhookHandler({
      verify: async () => membershipEvent("organizationMembership.created", "org:owner") as never,
    });
    expect((await handler(new Request("http://localhost/x", { method: "POST", body: "{}" }))).status).toBe(200);
    expect((await snapshot()).memberships[0].role).toBe("owner");
    const failing = createClerkWebhookHandler({
      verify: async () => {
        throw new Error("bad signature");
      },
    });
    expect((await failing(new Request("http://localhost/x", { method: "POST", body: "{}" }))).status).toBe(401);
  });
});

describe("Clerk webhook and removed members", () => {
  async function markRemoved() {
    await asOwner(db, (tx) => tx.update(memberships).set({ status: "removed" }));
  }

  test("organizationMembership.created for a previously removed user reactivates the membership", async () => {
    await POST(signedRequest(membershipEvent("organizationMembership.created", "org:recruiter")));
    await markRemoved();
    expect((await snapshot()).memberships[0].status).toBe("removed");
    expect((await POST(signedRequest(membershipEvent("organizationMembership.created", "org:recruiter")))).status).toBe(200);
    const s = await snapshot();
    expect(s.memberships).toHaveLength(1);
    expect(s.memberships[0]).toMatchObject({ status: "active", role: "recruiter" });
  });

  test("organizationMembership.updated for a removed user reactivates it and applies the new role", async () => {
    await POST(signedRequest(membershipEvent("organizationMembership.created", "org:recruiter")));
    await markRemoved();
    await POST(signedRequest(membershipEvent("organizationMembership.updated", "org:admin")));
    expect((await snapshot()).memberships[0]).toMatchObject({ status: "active", role: "admin" });
  });

  test("replaying an event for an active member changes nothing", async () => {
    await POST(signedRequest(membershipEvent("organizationMembership.created", "org:recruiter")));
    const before = await snapshot();
    await POST(signedRequest(membershipEvent("organizationMembership.created", "org:recruiter")));
    expect(await snapshot()).toEqual(before);
  });

  test("organizationMembership.deleted soft-removes the membership; replays change nothing", async () => {
    await POST(signedRequest(membershipEvent("organizationMembership.created", "org:recruiter")));
    expect((await POST(signedRequest(membershipEvent("organizationMembership.deleted")))).status).toBe(200);
    const once = await snapshot();
    expect(once.memberships).toHaveLength(1);
    expect(once.memberships[0].status).toBe("removed");
    expect((await POST(signedRequest(membershipEvent("organizationMembership.deleted")))).status).toBe(200);
    expect(await snapshot()).toEqual(once);
  });

  test("organizationMembership.deleted for an unknown member is acknowledged and writes nothing", async () => {
    expect((await POST(signedRequest(membershipEvent("organizationMembership.deleted")))).status).toBe(200);
    expect(await snapshot()).toEqual({ agencies: [], users: [], memberships: [] });
  });
});
