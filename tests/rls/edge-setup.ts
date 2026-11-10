import { spawn, type ChildProcess } from "node:child_process";
import { execSync } from "node:child_process";

function apiUrl(): string {
  if (process.env.SUPABASE_URL) return process.env.SUPABASE_URL;
  const out = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return out.match(/^API_URL="?(.*?)"?$/m)![1];
}

/** Unauthenticated probe: 401 means the function is up (JWT verification refused us). */
async function probe(url: string): Promise<number> {
  try {
    const res = await fetch(`${url}/functions/v1/embed`, { method: "POST", body: "{}" });
    return res.status;
  } catch {
    return 0;
  }
}

/**
 * Makes sure the `embed` Edge Function is served for the rls tests. If it is
 * already served, nothing is started and nothing is killed; otherwise this
 * starts `supabase functions serve` and stops only that process afterwards.
 */
export default async function setup(): Promise<(() => void) | void> {
  const url = apiUrl();
  if ((await probe(url)) === 401) return;

  const child: ChildProcess = spawn("npx", ["supabase", "functions", "serve"], {
    detached: true,
    stdio: "ignore",
  });
  const stop = () => {
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
  };
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if ((await probe(url)) === 401) return stop;
    await new Promise((r) => setTimeout(r, 1000));
  }
  stop();
  throw new Error("`supabase functions serve` did not make /functions/v1/embed reachable within 120s");
}
