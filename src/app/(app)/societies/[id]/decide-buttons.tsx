"use client";

import { useState, useTransition } from "react";
import { decideJoin } from "../actions";

const button = "border border-zinc-800 px-3 py-1 text-sm";

export function DecideButtons({ societyId, studentId }: { societyId: string; studentId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const decide = (accept: boolean) =>
    start(async () => {
      const r = await decideJoin(societyId, studentId, accept);
      setError(r.error ?? null);
    });
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={pending} className={button} onClick={() => decide(true)}>
        Accept
      </button>
      <button type="button" disabled={pending} className={button} onClick={() => decide(false)}>
        Decline
      </button>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
