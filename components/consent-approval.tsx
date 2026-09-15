"use client";

import { type FormEvent, useState } from "react";
import { AuthCard } from "@/components/ui/auth-card";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { authClient } from "@/lib/auth-client";

type Decision = "allow" | "deny";

/** What each scope lib/auth-config.ts offers lets an application do. */
const SCOPE_TEXT: Record<string, string> = {
  todos: "Read your to-do list, add items and mark them done",
  offline_access: "Keep that access without asking you again",
};

/**
 * Allow or deny an MCP client's request. The consent call carries the signed
 * authorization request from this page's URL (the OAuth provider's client
 * plugin adds it), and Better Auth answers either decision with the client's
 * callback URL, which its client then navigates to — so success has no screen.
 */
export function ConsentApproval({
  clientId,
  clientName,
  scopes,
  email,
}: {
  clientId: string;
  clientName: string;
  scopes: string[];
  email: string;
}) {
  const [pending, setPending] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: Decision) {
    setError(null);
    setPending(decision);
    const { error: consentError } = await authClient.oauth2.consent({
      accept: decision === "allow",
    });
    if (consentError) {
      setError(
        consentError.message ||
          "That request can no longer be answered. Connect from the application again.",
      );
      setPending(null);
    }
  }

  return (
    <AuthCard
      title="Allow access"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void decide("allow");
      }}
      footer="Only allow an application you are connecting yourself."
    >
      <p className="text-base text-ink">
        <span className="font-semibold">{clientName}</span> asks for your to-do
        list as {email}.
      </p>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-ink-soft">
          It will be able to
        </span>
        <ul className="flex flex-col gap-1 text-base text-ink">
          {scopes.map((scope) => (
            <li key={scope}>{SCOPE_TEXT[scope] ?? scope}</li>
          ))}
        </ul>
      </div>
      <p className="break-all text-sm text-ink-soft">
        Identified as {clientId}
      </p>
      <FormError message={error} />
      <div className="flex gap-3">
        <Button type="submit" disabled={pending !== null}>
          {pending === "allow" ? "Allowing…" : "Allow"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending !== null}
          onClick={() => void decide("deny")}
        >
          {pending === "deny" ? "Denying…" : "Deny"}
        </Button>
      </div>
    </AuthCard>
  );
}
