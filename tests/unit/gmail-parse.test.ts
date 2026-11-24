import { describe, expect, test } from "vitest";
import type { GmailMeta } from "@/lib/google/client";
import { messageToInputs } from "@/lib/gmail-sync/parse";

const ctx = { inboxId: "inbox-1", inboxEmail: "pat@example.com", userId: "user-1", ownDomains: ["example.com"] };
const AT = Date.parse("2026-11-20T16:30:00Z");

const meta = (over: Partial<GmailMeta> & { headers: Record<string, string> }): GmailMeta => ({
  id: "m1",
  threadId: "t1",
  internalDate: AT,
  labelIds: ["INBOX"],
  ...over,
});

describe("messageToInputs", () => {
  test("a sent message to two recipients and one internal cc gives two sent inputs", () => {
    const inputs = messageToInputs(
      meta({
        labelIds: ["SENT"],
        headers: {
          from: "Pat Example <pat@example.com>",
          to: '"Lee, Alex" <alex.lee@example.org>, jordan@example.net',
          cc: "Sam Colleague <sam@example.com>",
          subject: "Quick question",
        },
      }),
      ctx,
    );
    expect(inputs).toHaveLength(2);
    expect(inputs.map((i) => i.email)).toEqual(["alex.lee@example.org", "jordan@example.net"]);
    for (const i of inputs) {
      expect(i.type).toBe("sent");
      expect(i.source).toBe("gmail");
      expect(i.occurredAt.getTime()).toBe(AT);
      expect(i.inboxId).toBe("inbox-1");
      expect(i.userId).toBe("user-1");
      expect(i.gmailMessageId).toBe("m1");
      expect(i.gmailThreadId).toBe("t1");
      // The subject is never carried into the ledger.
      expect(JSON.stringify(i)).not.toContain("Quick question");
    }
    expect(inputs[0]!.name).toBe("Lee, Alex");
    expect(inputs[0]!.dedupeKey).toBe("gmail:inbox-1:m1:alex.lee@example.org");
    expect(inputs[1]!.dedupeKey).toBe("gmail:inbox-1:m1:jordan@example.net");
  });

  test("bcc recipients count and a repeated address gives one input", () => {
    const inputs = messageToInputs(
      meta({ labelIds: ["SENT"], headers: { to: "jordan@example.net", bcc: "Jordan@Example.net, casey@example.org" } }),
      ctx,
    );
    expect(inputs.map((i) => i.email)).toEqual(["jordan@example.net", "casey@example.org"]);
  });

  test("a failure DSN gives bounced inputs for X-Failed-Recipients", () => {
    const inputs = messageToInputs(
      meta({
        headers: {
          from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
          subject: "Delivery Status Notification (Failure)",
          "x-failed-recipients": "gone@example.org, Missing@example.net",
          "auto-submitted": "auto-replied",
        },
      }),
      ctx,
    );
    expect(inputs).toHaveLength(2);
    expect(inputs.map((i) => [i.type, i.email, i.dedupeKey])).toEqual([
      ["bounced", "gone@example.org", "gmail:inbox-1:m1:bounce:gone@example.org"],
      ["bounced", "missing@example.net", "gmail:inbox-1:m1:bounce:missing@example.net"],
    ]);
  });

  test("an Undeliverable notice from postmaster is a bounce", () => {
    const inputs = messageToInputs(
      meta({
        headers: {
          from: "postmaster@example.org",
          subject: "Undeliverable: Quick question",
          "x-failed-recipients": "gone@example.org",
        },
      }),
      ctx,
    );
    expect(inputs.map((i) => i.type)).toEqual(["bounced"]);
  });

  test("a delay DSN gives nothing", () => {
    expect(
      messageToInputs(
        meta({
          headers: {
            from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
            subject: "Delivery Status Notification (Delay)",
            "auto-submitted": "auto-replied",
          },
        }),
        ctx,
      ),
    ).toEqual([]);
    // A failure subject without X-Failed-Recipients is not trusted either.
    expect(
      messageToInputs(
        meta({ headers: { from: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification (Failure)" } }),
        ctx,
      ),
    ).toEqual([]);
  });

  test("newsletters and auto-replies give nothing", () => {
    const from = "News Desk <news@example.org>";
    const cases: Record<string, string>[] = [
      { "list-unsubscribe": "<mailto:unsubscribe@example.org>" },
      { precedence: "bulk" },
      { precedence: "List" },
      { precedence: "junk" },
      { "auto-submitted": "auto-replied" },
      { "auto-submitted": "auto-generated" },
    ];
    for (const extra of cases) {
      expect(messageToInputs(meta({ headers: { from, ...extra } }), ctx), JSON.stringify(extra)).toEqual([]);
    }
  });

  test("a human reply gives one received input", () => {
    const inputs = messageToInputs(
      meta({ headers: { from: "Alex Lee <Alex.Lee@example.org>", to: "pat@example.com", "auto-submitted": "no", subject: "Re: Quick question" } }),
      ctx,
    );
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      type: "received",
      email: "alex.lee@example.org",
      name: "Alex Lee",
      source: "gmail",
      dedupeKey: "gmail:inbox-1:m1:from",
      gmailMessageId: "m1",
      gmailThreadId: "t1",
    });
    expect(inputs[0]!.occurredAt.getTime()).toBe(AT);
  });

  test("mail from an own domain, drafts and spam give nothing", () => {
    expect(messageToInputs(meta({ headers: { from: "sam@example.com" } }), ctx)).toEqual([]);
    expect(messageToInputs(meta({ labelIds: ["DRAFT"], headers: { to: "alex@example.org" } }), ctx)).toEqual([]);
    expect(messageToInputs(meta({ labelIds: ["SPAM"], headers: { from: "alex@example.org" } }), ctx)).toEqual([]);
  });
});
