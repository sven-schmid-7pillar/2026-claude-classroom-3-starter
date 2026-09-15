"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, use, useState } from "react";
import { AuthCard } from "@/components/ui/auth-card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { authClient } from "@/lib/auth-client";
import { oauthQuery, safeNextPath, withNext } from "@/lib/next-path";

export default function SignUpPage({ searchParams }: PageProps<"/signup">) {
  const params = use(searchParams);
  // Carried over from /login, so a terminal login or an MCP client's
  // authorization survives creating an account.
  const next = safeNextPath(params.next);
  const oauth = oauthQuery(params);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    setPending(true);

    const { data, error: signUpError } = await authClient.signUp.email({
      name: String(form.get("name")),
      email: String(form.get("email")),
      password: String(form.get("password")),
    });

    if (signUpError) {
      setError(
        signUpError.message ??
          "Could not create the account. Try a different email address.",
      );
      setPending(false);
      return;
    }
    // As on /login: Better Auth resumed the authorization and is redirecting.
    if (data && "redirect" in data && data.redirect) {
      return;
    }

    router.replace(next);
    router.refresh();
  }

  return (
    <AuthCard
      title="Create your account"
      onSubmit={onSubmit}
      footer={
        <>
          Already have an account?{" "}
          <Link
            href={oauth ? `/login${oauth}` : withNext("/login", next)}
            className="font-semibold text-accent hover:underline"
          >
            Log in
          </Link>
        </>
      }
    >
      <Field id="name" label="Name" autoComplete="name" required />
      <Field
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
      />
      <Field
        id="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
      />
      <FormError message={error} />
      <Button type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Sign up"}
      </Button>
    </AuthCard>
  );
}
