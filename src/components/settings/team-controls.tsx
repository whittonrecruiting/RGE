"use client";

import { useRef, useState, useTransition } from "react";
import { inviteMember, removeMember, setMemberRole, type TeamResult } from "@/lib/team/actions";

type AssignableRole = "admin" | "recruiter";

const fieldClass =
  "min-h-11 rounded border border-line bg-surface px-3 text-sm text-text focus:border-gold focus:outline-none";
const buttonClass =
  "min-h-11 rounded border border-gold px-4 text-xs font-semibold uppercase tracking-[0.14em] text-gold hover:bg-hover disabled:opacity-50";

function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1 text-sm text-deny">
      {message}
    </p>
  );
}

export function InviteForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const email = String(data.get("email") ?? "");
    const role = String(data.get("role") ?? "recruiter") as AssignableRole;
    setError(null);
    setSent(null);
    start(async () => {
      const result: TeamResult = await inviteMember(email, role);
      if (result.ok) {
        setSent(`Invitation sent to ${email.trim()}.`);
        formRef.current?.reset();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="rounded border border-line bg-card p-4">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-text">Invite a teammate</h2>
      <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end">
        <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
          Work email
          <input name="email" type="email" required autoComplete="off" className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Role
          <select name="role" defaultValue="recruiter" className={fieldClass}>
            <option value="recruiter">Recruiter</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Sending" : "Send invite"}
        </button>
      </div>
      <ErrorText message={error} />
      {sent && (
        <p role="status" className="mt-1 text-sm text-ok">
          {sent}
        </p>
      )}
    </form>
  );
}

export function MemberActions({
  membershipId,
  name,
  role,
  canSetRole,
  canRemove,
}: {
  membershipId: string;
  name: string;
  role: "owner" | AssignableRole;
  canSetRole: boolean;
  canRemove: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onRoleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as AssignableRole;
    setError(null);
    start(async () => {
      const result = await setMemberRole(membershipId, next);
      if (!result.ok) {
        setError(result.error);
        e.target.value = role; // put the select back to what is saved
      }
    });
  }

  function onRemove() {
    if (!window.confirm(`Remove ${name} from the team? Their MPCs move to the Owner.`)) return;
    setError(null);
    start(async () => {
      const result = await removeMember(membershipId);
      if (!result.ok) setError(result.error);
    });
  }

  if (!canSetRole && !canRemove) return null;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {canSetRole && (
          <select
            aria-label={`Role for ${name}`}
            defaultValue={role === "owner" ? "admin" : role}
            onChange={onRoleChange}
            disabled={pending}
            className={fieldClass}
          >
            <option value="recruiter">Recruiter</option>
            <option value="admin">Admin</option>
          </select>
        )}
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            disabled={pending}
            className="min-h-11 rounded border border-line px-4 text-xs font-semibold uppercase tracking-[0.14em] text-deny hover:bg-hover disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>
      <ErrorText message={error} />
    </div>
  );
}
