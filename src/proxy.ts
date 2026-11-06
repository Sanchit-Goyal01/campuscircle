import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const AUTH_PATHS = ["/sign-in", "/sign-up"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet, headers) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) {
            response.cookies.set(name, value, options);
          }
          for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
        },
      },
    },
  );

  // Verified call; also refreshes the session cookie when needed.
  const { data } = await supabase.auth.getUser();
  const signedIn = !!data.user;
  const path = request.nextUrl.pathname;
  const isAuthPath = AUTH_PATHS.includes(path);

  const redirectTo = (to: string) => {
    const redirect = NextResponse.redirect(new URL(to, request.url));
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    for (const key of ["cache-control", "expires", "pragma"]) {
      const v = response.headers.get(key);
      if (v) redirect.headers.set(key, v);
    }
    return redirect;
  };

  if (!signedIn && !isAuthPath) return redirectTo("/sign-in");
  if (signedIn && isAuthPath) return redirectTo("/");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
