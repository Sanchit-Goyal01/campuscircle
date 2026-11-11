import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createUserWithRole } from "../helpers/roles";
import { adminClient, createCollege, createStudent, supabaseEnv } from "../helpers/supabase";
import type { ToolContext } from "../../src/agent/types";
import { allTools } from "../../src/modules";

const run = Math.random().toString(36).slice(2, 8);
type S = { id: string; client: SupabaseClient };
let collegeA: string;
let collegeB: string;
let seller: S;
let buyer: S;
let other: S;
let studentB: S;
let demo: S;
let listingId: string;

const ctxFor = (s: S, collegeId: string): ToolContext => ({ db: s.client, userId: s.id, collegeId, role: "student" });
const tool = (name: string) => allTools.find((t) => t.name === name)!;
const MSG = "Is this still available? I can pick it up today.";
const jpeg = () => sharp({ create: { width: 8, height: 8, channels: 3, background: "#369" } }).jpeg().toBuffer();

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", supabaseEnv().url);
  collegeA = await createCollege(`Market A ${run}`, `ma-${run}.edu`);
  collegeB = await createCollege(`Market B ${run}`, `mb-${run}.edu`);
  seller = await createStudent(`sel-${run}@ma-${run}.edu`);
  buyer = await createStudent(`buy-${run}@ma-${run}.edu`);
  other = await createStudent(`oth-${run}@ma-${run}.edu`);
  studentB = await createStudent(`sb-${run}@mb-${run}.edu`);
  demo = await createStudent(`mk-${run}@demo-iot.edu`);
});
afterAll(() => vi.unstubAllEnvs());

describe("marketplace", { timeout: 60_000 }, () => {
  test("seller creates, edits and marks sold; another student cannot edit or delete", async () => {
    const ins = await seller.client
      .from("listings")
      .insert({ title: "Scientific calculator", description: "Casio fx-991", price_inr: 700, condition: "good" })
      .select("id, college_id, seller_id, status")
      .single();
    expect(ins.error).toBeNull();
    expect(ins.data).toMatchObject({ college_id: collegeA, seller_id: seller.id, status: "available" });
    listingId = ins.data!.id;

    const edit = await seller.client.from("listings").update({ price_inr: 650, description: "Casio fx-991ES" }).eq("id", listingId).select("price_inr");
    expect(edit.data?.[0].price_inr).toBe(650);

    const theirs = await other.client.from("listings").update({ price_inr: 1 }).eq("id", listingId).select("id");
    expect(theirs.data ?? []).toEqual([]);
    const del = await other.client.from("listings").delete().eq("id", listingId).select("id");
    expect(del.data ?? []).toEqual([]);
    // Ownership columns are not client-writable.
    expect((await seller.client.from("listings").update({ seller_id: other.id }).eq("id", listingId)).error?.code).toBe("42501");
    expect((await seller.client.from("listings").update({ college_id: collegeB }).eq("id", listingId)).error?.code).toBe("42501");
    // Cannot insert for someone else.
    expect((await other.client.from("listings").insert({ seller_id: seller.id, title: "Fake", price_inr: 1, condition: "new" })).error).not.toBeNull();
    // Price and title limits.
    expect((await seller.client.from("listings").insert({ title: "Ok title", price_inr: -1, condition: "new" })).error?.code).toBe("23514");
    expect((await seller.client.from("listings").insert({ title: "ab", price_inr: 1, condition: "new" })).error?.code).toBe("23514");

    const sold = await seller.client.from("listings").update({ status: "sold" }).eq("id", listingId).select("status");
    expect(sold.data?.[0].status).toBe("sold");
    await seller.client.from("listings").update({ status: "available" }).eq("id", listingId);
  });

  test("photo_path outside the seller folder is refused", async () => {
    const bad = (p: string) => seller.client.from("listings").insert({ title: "Photo item", price_inr: 5, condition: "fair", photo_path: p });
    expect((await bad(`${collegeA}/${other.id}/x.jpg`)).error?.code).toBe("23514");
    expect((await bad(`${collegeB}/${seller.id}/x.jpg`)).error?.code).toBe("23514");
    expect((await bad("x.jpg")).error?.code).toBe("23514");
    expect((await seller.client.from("listings").update({ photo_path: `${collegeA}/${other.id}/x.jpg` }).eq("id", listingId)).error?.code).toBe("23514");
    // One filename segment only: no slashes, no dot segments.
    for (const tail of ["../x.jpg", "a/b.jpg", "a/../b.jpg", "/x.jpg", "..", ".hidden.jpg", ""]) {
      expect((await bad(`${collegeA}/${seller.id}/${tail}`)).error?.code).toBe("23514");
    }
    // Storage: nobody uploads into another seller's folder or another college's.
    const body = await jpeg();
    const up = (s: S, path: string) => s.client.storage.from("listing-photos").upload(path, body, { contentType: "image/jpeg" });
    expect((await up(other, `${collegeA}/${seller.id}/${crypto.randomUUID()}.jpg`)).error).not.toBeNull();
    expect((await up(studentB, `${collegeA}/${studentB.id}/${crypto.randomUUID()}.jpg`)).error).not.toBeNull();
    const good = `${collegeA}/${seller.id}/${crypto.randomUUID()}.jpg`;
    expect((await up(seller, good)).error).toBeNull();
    expect((await seller.client.from("listings").update({ photo_path: good }).eq("id", listingId)).error).toBeNull();
    // Nobody overwrites an existing photo: not another student, and not the seller (no update policy).
    const over = (s: S) => s.client.storage.from("listing-photos").upload(good, body, { contentType: "image/jpeg", upsert: true });
    expect((await over(other)).error).not.toBeNull();
    expect((await over(seller)).error).not.toBeNull();
    // Same-college students see it; college B cannot.
    expect((await buyer.client.storage.from("listing-photos").createSignedUrl(good, 60)).error).toBeNull();
    expect((await studentB.client.storage.from("listing-photos").createSignedUrl(good, 60)).error).not.toBeNull();
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#369" } }).png().toBuffer();
    const notJpeg = await seller.client.storage.from("listing-photos").upload(`${collegeA}/${seller.id}/${crypto.randomUUID()}.png`, png, { contentType: "image/png" });
    expect(notJpeg.error).not.toBeNull();
  });

  test("contact_seller notifies the seller and refuses the seller themself", async () => {
    expect((await seller.client.rpc("contact_seller", { p_listing_id: listingId, p_message: MSG })).error?.code).toBe("42501");
    expect((await studentB.client.rpc("contact_seller", { p_listing_id: listingId, p_message: MSG })).error?.code).toBe("42501");
    expect((await buyer.client.rpc("contact_seller", { p_listing_id: listingId, p_message: "short" })).error?.code).toBe("23514");
    expect((await buyer.client.rpc("contact_seller", { p_listing_id: listingId, p_message: MSG })).error).toBeNull();
    const { data } = await adminClient().from("notifications").select("title, body, link").eq("user_id", seller.id).eq("kind", "listing_contact");
    expect(data).toHaveLength(1);
    expect(data![0].link).toBe(`/market/${listingId}`);
    expect(data![0].body).toContain(MSG);
    expect(data![0].body).toMatch(/^[^:]*buy-|^Market|:/);
    // The buyer cannot read the log table or write notifications directly.
    expect((await buyer.client.from("listing_contact_log").select("*")).error).not.toBeNull();
    // A sold item cannot be contacted about.
    await seller.client.from("listings").update({ status: "sold" }).eq("id", listingId);
    const sold = await buyer.client.rpc("contact_seller", { p_listing_id: listingId, p_message: MSG });
    expect(sold.error?.code).toBe("P0001");
    await seller.client.from("listings").update({ status: "available" }).eq("id", listingId);
  });

  test("eleventh contact in 24 hours is refused", async () => {
    // One contact is already logged for buyer; add nine more, the tenth succeeds, the eleventh fails.
    for (let i = 0; i < 9; i++) {
      const r = await buyer.client.rpc("contact_seller", { p_listing_id: listingId, p_message: MSG });
      expect(r.error).toBeNull();
    }
    const eleventh = await buyer.client.rpc("contact_seller", { p_listing_id: listingId, p_message: MSG });
    expect(eleventh.error?.code).toBe("P0001");
    expect(eleventh.error?.message).toBe("You have contacted sellers too many times today. Try again tomorrow.");
    const { count } = await adminClient().from("notifications").select("id", { count: "exact", head: true }).eq("user_id", seller.id).eq("kind", "listing_contact");
    expect(count).toBe(10);
  });

  test("college B cannot see college A listings or photos", async () => {
    const { data } = await studentB.client.from("listings").select("id");
    expect(data).toEqual([]);
    const out = (await tool("search_listings").run({ query: "calculator" }, ctxFor(studentB, collegeB))) as any[];
    expect(out).toEqual([]);
    const inA = (await tool("search_listings").run({ query: "calculator" }, ctxFor(buyer, collegeA))) as any[];
    expect(inA.map((l) => l.id)).toEqual([listingId]);
    const { data: sp } = await adminClient().from("profiles").select("full_name").eq("id", seller.id).single();
    expect(sp?.full_name).toBeTruthy();
    expect(inA[0].seller_name).toBe(sp!.full_name);
    expect(Object.keys(inA[0]).sort()).toEqual(["condition", "created_at", "id", "price_inr", "seller_name", "title"]);
  });

  test('search_listings finds the Korth listing for "DBMS textbook" or "database"', async () => {
    for (const query of ["DBMS textbook", "database", "korth"]) {
      const out = (await tool("search_listings").run({ query }, ctxFor(demo, "00000000-0000-0000-0000-00000000a001"))) as any[];
      expect(out.map((l) => l.title)).toContain("Database System Concepts (Korth), used");
    }
    const nasty = await tool("search_listings").run({ query: `"a & b : c | ! '` }, ctxFor(demo, "x"));
    expect(Array.isArray(nasty)).toBe(true);
    expect(tool("search_listings")).toMatchObject({ kind: "read", roles: ["student", "society_admin", "authority", "college_admin"] });
  });

  test("an authority cannot list or contact; an invalid status is refused", async () => {
    const auth = await createUserWithRole(`au-${run}@ma-${run}.edu`, "authority");
    expect((await auth.client.from("listings").insert({ title: "Staff item", price_inr: 5, condition: "new" })).error).not.toBeNull();
    expect((await auth.client.rpc("contact_seller", { p_listing_id: listingId, p_message: MSG })).error?.code).toBe("42501");
    expect((await seller.client.from("listings").update({ status: "reserved" }).eq("id", listingId)).error?.code).toBe("23514");
    const { data } = await adminClient().from("listings").select("id").eq("college_id", collegeA).eq("title", "Staff item");
    expect(data).toEqual([]);
  });

  test("seller deletes their listing", async () => {
    expect((await seller.client.from("listings").delete().eq("id", listingId).select("id")).data).toHaveLength(1);
  });
});
