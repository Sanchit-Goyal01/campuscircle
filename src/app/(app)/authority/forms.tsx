"use client";

import { useActionState, useState, useTransition } from "react";
import { CATEGORIES, SEVERITIES } from "@/modules/issues/schema";
import { decideInsight, findPatterns, runDeadlineCheck, transitionIssue, triageIssue, updateSla, type ActionState } from "./actions";

const input = "w-full border border-zinc-800 px-2 py-1 text-sm";
const button = "border border-zinc-800 px-3 py-1 text-sm";

export function TransitionButtons({ issueId, options }: { issueId: string; options: { to: string; label: string }[] }) {
  const [state, setState] = useState<ActionState>({});
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm">
        Note (optional)
        <input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} className={input} />
      </label>
      <div className="flex flex-wrap gap-3">
        {options.map((o) => (
          <button
            key={o.to}
            type="button"
            disabled={pending}
            className={button}
            onClick={() =>
              start(async () => {
                const r = await transitionIssue(issueId, o.to, note);
                setState(r);
                if (r.ok) setNote("");
              })
            }
          >
            Mark {o.label}
          </button>
        ))}
      </div>
      {state.error && (
        <p role="alert" className="text-sm">
          {state.error}
        </p>
      )}
    </div>
  );
}

export function TriageForm({
  issueId,
  title,
  departments,
}: {
  issueId: string;
  title: string;
  departments: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(triageIssue, {});
  const id = `triage-${issueId}`;
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-2">
      <input type="hidden" name="issue_id" value={issueId} />
      <label htmlFor={`${id}-dept`} className="flex flex-col gap-1 text-sm">
        Department
        <select id={`${id}-dept`} name="department_id" required defaultValue="" className={input}>
          <option value="" disabled>
            Choose
          </option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${id}-cat`} className="flex flex-col gap-1 text-sm">
        Category
        <select id={`${id}-cat`} name="category" required defaultValue="" className={input}>
          <option value="" disabled>
            Choose
          </option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${id}-sev`} className="flex flex-col gap-1 text-sm">
        Severity
        <select id={`${id}-sev`} name="severity" required defaultValue="" className={input}>
          <option value="" disabled>
            Choose
          </option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${id}-title`} className="flex flex-col gap-1 text-sm">
        Title
        <input id={`${id}-title`} name="title" required maxLength={200} defaultValue={title} className={input} />
      </label>
      <div className="sm:col-span-2">
        <button type="submit" disabled={pending} className={button}>
          Route issue
        </button>
      </div>
      {state.error && (
        <p role="alert" className="text-sm sm:col-span-2">
          {state.error}
        </p>
      )}
    </form>
  );
}

const SLA_LABELS = { critical: "Critical", high: "High", medium: "Medium", low: "Low" } as const;

export function SlaForm({ minutes }: { minutes: Record<keyof typeof SLA_LABELS, number> }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateSla, {});
  return (
    <form action={action} className="grid max-w-md gap-2 sm:grid-cols-2">
      {(Object.keys(SLA_LABELS) as (keyof typeof SLA_LABELS)[]).map((s) => (
        <label key={s} className="flex flex-col gap-1 text-sm">
          {SLA_LABELS[s]} (minutes)
          <input name={s} type="number" min={1} step={1} required defaultValue={minutes[s]} className={input} />
        </label>
      ))}
      <div className="sm:col-span-2">
        <button type="submit" disabled={pending} className={button}>
          Save deadlines
        </button>
      </div>
      {state.ok && state.message && (
        <p role="status" className="text-sm sm:col-span-2">
          {state.message}
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-sm sm:col-span-2">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function RunCheck() {
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <div>
        <button
          type="button"
          disabled={pending}
          className={button}
          onClick={() => start(async () => setState(await runDeadlineCheck()))}
        >
          Run deadline check now
        </button>
      </div>
      {state.message && (
        <p role="status" className="text-sm">
          {state.message}
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-sm">
          {state.error}
        </p>
      )}
    </div>
  );
}

export function FindPatterns() {
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <div>
        <button
          type="button"
          disabled={pending}
          className={button}
          onClick={() => start(async () => setState(await findPatterns()))}
        >
          {pending ? "Finding patterns..." : "Find patterns"}
        </button>
      </div>
      {state.message && (
        <p role="status" className="text-sm">
          {state.message}
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-sm">
          {state.error}
        </p>
      )}
    </div>
  );
}

export function InsightButtons({ insightId }: { insightId: string }) {
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const decide = (status: "accepted" | "dismissed") => start(async () => setState(await decideInsight(insightId, status)));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-3">
        <button type="button" disabled={pending} className={button} onClick={() => decide("accepted")}>
          Accept
        </button>
        <button type="button" disabled={pending} className={button} onClick={() => decide("dismissed")}>
          Dismiss
        </button>
      </div>
      {state.error && (
        <p role="alert" className="text-sm">
          {state.error}
        </p>
      )}
    </div>
  );
}
