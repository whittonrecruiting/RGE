import type { MpcDetail } from "@/lib/mpc/queries";

const WORK_MODE = { onsite: "On site", hybrid: "Hybrid", remote: "Remote", any: "Any" } as const;
const EMPLOYER = { inhouse: "In house", firm: "Firm", either: "Either" } as const;

const dollars = (n: number | null) => (n === null ? "Not set" : `$${n.toLocaleString("en-US")}`);
const list = (items: string[]) => (items.length ? items.join(", ") : "None");

export function ProfileReadOnly({ mpc }: { mpc: MpcDetail }) {
  const rows: [string, string][] = [
    ["Headline role", mpc.headlineRole ?? "Not set"],
    ["Location", mpc.location ?? "Not set"],
    ["Seniority", mpc.seniority || "Not set"],
    ["Years of experience", mpc.yearsExperience === null ? "Not set" : String(mpc.yearsExperience)],
    ["Overlap priority", String(mpc.overlapPriority)],
    ["Work mode", WORK_MODE[mpc.workMode]],
    ["Employer type", EMPLOYER[mpc.employerType]],
    ["Specialty tags", list(mpc.specialtyTags)],
    ["Target cities", list(mpc.targetCities)],
    ["Pay floor", `${dollars(mpc.payFloor)}${mpc.payFloor !== null && mpc.payFloorStrict ? " (firm)" : ""}`],
    ["Pay target", dollars(mpc.payTarget)],
  ];
  return (
    <dl className="grid gap-4 md:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted">{label}</dt>
          <dd className="mt-1 text-sm text-text [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
