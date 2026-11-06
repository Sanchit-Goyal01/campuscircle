"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { Field } from "../field";

export default function SignUpPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const { data, error } = await getBrowserClient().auth.signUp({
        email: String(form.get("email")).trim(),
        password: String(form.get("password")),
        options: { data: { full_name: String(form.get("full_name")).trim() } },
      });
      if (error) {
        const unregistered =
          /college_not_registered/i.test(error.message ?? "") || error.status === 500;
        setError(
          unregistered
            ? "Your college is not registered yet."
            : error.status === 422 || error.status === 400
              ? "Could not create the account. Check your details and try again."
              : "Something went wrong. Please try again.",
        );
        return;
      }
      if (!data.session) {
        setNotice("Check your email to confirm your account, then sign in.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">Create your account</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Full name" name="full_name" autoComplete="name" required />
        <Field label="College email" name="email" type="email" autoComplete="email" required />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-green-700">
            {notice}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-foreground px-4 py-2 font-medium text-background disabled:opacity-50"
        >
          {pending ? "Creating account..." : "Create account"}
        </button>
      </form>
      <p className="text-sm">
        Already have an account?{" "}
        <Link href="/sign-in" className="underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
