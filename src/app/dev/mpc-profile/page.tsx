import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { PageTitle } from "@/components/shell/page-title";
import { ConsentCard } from "@/components/mpc/ConsentCard";
import { FactList, type FactItem } from "@/components/mpc/FactList";
import { CredentialsEditor, RestrictionsEditor } from "@/components/mpc/RestrictionsEditor";
import { SamplePitch } from "@/components/mpc/SamplePitch";
import { Section } from "@/components/mpc/section";
import { DEFAULT_SETTINGS } from "@/lib/settings-defaults";

// Renders the Facts, Restrictions, Credentials and Consent sections with made-up data and no auth,
// for layout checks. Not available in production. ?view=readonly shows the teammate view;
// ?consent=none shows the no-consent warning. ?pitch= sets the Sample pitch card state: preview
// (default: a rendered pitch with a warning), saved (saved bullets plus a preview), draft, or empty
// (needs facts, nothing previewed yet).
const LONG_URL = "https://www.example.com/news/2026/11/a-very-long-article-path-with-many-segments/and-more-segments-to-force-wrapping-behaviour-1234567890";
const NINETY = "Do not mention the sealed settlement or any detail of the matter outside of public records ok";

const KINDS: FactItem["sourceKind"][] = ["resume", "notes", "transcript", "web", "manual"];
const STATUSES: FactItem["status"][] = ["usable", "interview_only", "confirmed"];

const facts: FactItem[] = Array.from({ length: 40 }, (_, i) => {
  const sourceKind = KINDS[i % KINDS.length];
  return {
    id: `f${i}`,
    text: `Fact ${i + 1}: Led discovery and trial preparation on a complex commercial matter across several jurisdictions, with a very long unbroken token ${"x".repeat(i % 7 === 0 ? 80 : 5)}`,
    sourceKind,
    sourceRef:
      sourceKind === "web" ? (i % 2 === 0 ? LONG_URL : "http://insecure.example.com/page") : sourceKind === "manual" ? null : "jordan-example-resume-with-a-very-long-file-name-2026.pdf",
    status: STATUSES[i % STATUSES.length],
    edited: i % 4 === 0,
  };
});

const LONG_BULLET = "Led discovery on a $120M bad faith matter across ninetyninecharacterunbrokentokenxxxxxxxxxxxxxxxx";
const BULLETS = [
  { factId: "f0", text: "Tried 4 insurance coverage cases to verdict" },
  { factId: "f1", text: LONG_BULLET },
];
const SAMPLE_BODY = DEFAULT_SETTINGS.templates.pitch
  .replace("[location]", "Greater Phoenix Metropolitan Area")
  .replace("[role type]", "senior employment and labor litigation associate")
  .replace("[specific background]", "insurance coverage litigation experience")
  .replace("[bullet]", BULLETS[0].text)
  .replace("[bullet]", BULLETS[1].text);
const SAMPLE = {
  subject: "Senior Employment and Labor Litigation Associate with Class Action and Appellate Experience?",
  body: `${SAMPLE_BODY}\n\n${DEFAULT_SETTINGS.templates.optOut}`,
  bullets: BULLETS,
  warnings: ["Only 2 bullets passed the checks. Regenerate to try again."],
};
const SAVED = [
  { position: 1, factId: "f0", text: BULLETS[0].text },
  { position: 2, factId: "f1", text: LONG_BULLET },
  { position: 3, factId: "f2", text: "Drafted dispositive motions for national carriers" },
];

type Props = { searchParams: Promise<{ view?: string; consent?: string; pitch?: string }> };

export default async function Page({ searchParams }: Props) {
  if (process.env.NODE_ENV === "production") notFound();
  const { view, consent, pitch = "preview" } = await searchParams;
  const canEdit = view !== "readonly";
  const latest =
    consent === "none"
      ? null
      : { id: "c1", givenOn: "2026-11-20", method: "signed_form" as const, recordedByName: "Sample Recruiter With A Long Name", hasProof: true };

  return (
    <AppShell>
      <div className="flex min-w-0 flex-col gap-6">
        <PageTitle>MPC profile sections</PageTitle>
        <Section title="Facts">
          <FactList mpcId="a" canEdit={canEdit} facts={facts} />
        </Section>
        <Section title="Sample pitch">
          <SamplePitch
            mpcId="a"
            canEdit={canEdit}
            isDraft={pitch === "draft"}
            pitchReady={pitch !== "empty"}
            reason={pitch === "empty" ? "Only 2 strong facts. Confirm a note or run Find more." : null}
            saved={pitch === "saved" ? SAVED : []}
            initialPitch={pitch === "preview" || pitch === "saved" ? SAMPLE : null}
          />
        </Section>
        <Section title="Restrictions">
          <RestrictionsEditor
            mpcId="a"
            canEdit={canEdit}
            restrictions={[
              { kind: "never_say", value: NINETY },
              { kind: "excluded_company", value: "Acme LLP" },
            ]}
          />
        </Section>
        <Section title="Credentials">
          <CredentialsEditor
            mpcId="a"
            canEdit={canEdit}
            credentials={[{ kind: "Bar admission", region: "Arizona", verified: true }]}
          />
        </Section>
        <Section title="Consent">
          <ConsentCard mpcId="a" canEdit={canEdit} latest={latest} />
        </Section>
      </div>
    </AppShell>
  );
}
