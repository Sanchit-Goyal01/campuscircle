import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { agentToday } from "@/lib/today";
import { markItemMissed, setItemDone } from "./actions";
import { ItemActions } from "./item-actions";

type Item = { id: string; due_on: string; task: string; done: boolean };
type Plan = { id: string; title: string; study_plan_items: Item[] };

async function Plans() {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message

  const { data } = await me.db
    .from("study_plans")
    .select("id, title, study_plan_items(id, due_on, task, done)")
    .order("created_at", { ascending: false });
  const plans = (data ?? []) as unknown as Plan[];
  const today = agentToday();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <h1 className="font-slab text-3xl font-bold">Study plans</h1>
      {plans.length === 0 && <p>No study plans yet. Ask the assistant to draft one and approve it.</p>}
      {plans.map((plan) => {
        const items = [...plan.study_plan_items].sort((x, y) => x.due_on.localeCompare(y.due_on) || x.task.localeCompare(y.task));
        return (
          <section key={plan.id} aria-label={plan.title} className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold">{plan.title}</h2>
            <ul className="flex flex-col gap-3">
              {items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-3">
                  <span className={item.done ? "line-through" : undefined}>
                    {item.task}, due <time dateTime={item.due_on}>{item.due_on}</time>
                  </span>
                  {item.done && <strong>Done</strong>}
                  {!item.done && item.due_on < today && <strong>Overdue</strong>}
                  <ItemActions
                    task={item.task}
                    done={item.done}
                    canMiss={item.due_on <= today}
                    toggle={setItemDone.bind(null, item.id)}
                    miss={markItemMissed.bind(null, item.id)}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export default function PlansPage() {
  return (
    <Suspense fallback={<p className="text-sm">Loading study plans...</p>}>
      <Plans />
    </Suspense>
  );
}
