import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getServerClient } from "@/lib/supabase/server";

const OTP_TYPES: readonly string[] = ["signup", "email"];

/** Returns null when the link carries nothing to confirm. */
async function confirm(params: URLSearchParams): Promise<boolean | null> {
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  if (!code && !(tokenHash && type)) return null;
  try {
    const { auth } = await getServerClient();
    if (code) return !(await auth.exchangeCodeForSession(code)).error;
    if (!OTP_TYPES.includes(type!)) return false;
    const otp = { token_hash: tokenHash!, type: type as EmailOtpType };
    return !(await auth.verifyOtp(otp)).error;
  } catch (e) {
    console.error("Email confirmation failed", e);
    return false;
  }
}

export async function GET(request: NextRequest) {
  const confirmed = await confirm(request.nextUrl.searchParams);
  // Fixed targets only. A failed exchange usually means the email is already
  // confirmed and the link was opened on another device, so offer sign-in.
  const target = confirmed === null ? "/sign-in" : confirmed ? "/" : "/sign-in?confirmed=1";
  return NextResponse.redirect(new URL(target, request.url));
}
