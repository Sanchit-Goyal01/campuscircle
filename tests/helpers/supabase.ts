import { execSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Env = { url: string; anon: string; service: string };
let cached: Env | undefined;

/** Local Supabase URL and keys (from env, else `supabase status`). Never print these. */
export function supabaseEnv(): Env {
  return env();
}

function env(): Env {
  if (cached) return cached;
  const e = process.env;
  if (e.SUPABASE_URL && e.SUPABASE_ANON_KEY && e.SUPABASE_SERVICE_ROLE_KEY) {
    cached = {
      url: e.SUPABASE_URL,
      anon: e.SUPABASE_ANON_KEY,
      service: e.SUPABASE_SERVICE_ROLE_KEY,
    };
    return cached;
  }
  const out = execSync("npx supabase status -o env", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const kv: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m) kv[m[1]] = m[2];
  }
  cached = {
    url: kv.API_URL,
    anon: kv.ANON_KEY,
    service: kv.SERVICE_ROLE_KEY,
  };
  return cached;
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

export function adminClient(): SupabaseClient {
  const { url, service } = env();
  return createClient(url, service, opts);
}

export function anonClient(): SupabaseClient {
  const { url, anon } = env();
  return createClient(url, anon, opts);
}

/** A client whose every request is refused by PostgREST, as with an expired session. */
export function invalidTokenClient(): SupabaseClient {
  const { url, anon } = env();
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: "Bearer not-a-valid-token" } },
  });
}

export async function createCollege(name: string, domain: string): Promise<string> {
  const { data, error } = await adminClient()
    .from("colleges")
    .insert({ name, email_domain: domain })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export const TEST_PASSWORD = "test-password-123!";

export async function createStudent(
  email: string,
): Promise<{ id: string; client: SupabaseClient }> {
  const client = anonClient();
  const { data, error } = await client.auth.signUp({
    email,
    password: TEST_PASSWORD,
    options: { data: { full_name: email.split("@")[0] } },
  });
  if (error) throw error;
  if (!data.user || !data.session) {
    throw new Error("signUp returned no session; is email confirmation enabled?");
  }
  return { id: data.user.id, client };
}
