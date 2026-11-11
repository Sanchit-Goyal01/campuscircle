"use client";

import { useState, useTransition } from "react";
import { leaveSociety, requestToJoin } from "../actions";

const button = "border border-zinc-800 px-3 py-1 text-sm";

export function JoinButtons({ societyId, status }: { societyId: string; status: "pending" | "approved" | "declined" | null }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => ReturnType<typeof requestToJoin>) =>
    start(async () => {
      const r = await fn();
      setError(r.error ?? null);
    });
  return (
    <div className="flex flex-wrap items-center gap-3">
      {status === "approved" && <p className="text-sm font-medium">You are a member</p>}
      {status === "pending" && <p className="text-sm font-medium">Request pending</p>}
      {status === "declined" && <p className="text-sm">Your request was declined.</p>}
      {(status === null || status === "declined") && (
        <button type="button" disabled={pending} className={button} onClick={() => run(() => requestToJoin(societyId))}>
          Request to join
        </button>
      )}
      {(status === "approved" || status === "pending") && (
        <button type="button" disabled={pending} className={button} onClick={() => run(() => leaveSociety(societyId))}>
          {status === "pending" ? "Withdraw request" : "Leave"}
        </button>
      )}
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
