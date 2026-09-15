"use client";

import { formatUserCode } from "ai-tutor-todo-api";
import Link from "next/link";
import { type FormEvent, useState } from "react";
import { AuthCard } from "@/components/ui/auth-card";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { authClient } from "@/lib/auth-client";

type Decision = "approve" | "deny";

/**
 * Approve or deny one pending device code. app/device/page.tsx has already
 * bound the code to this session, which is what Better Auth checks before it
 * lets the session decide. The outcome stays local: once the terminal redeems
 * an approved code the server deletes it, so re-rendering would find nothing.
 */
export function DeviceApproval({
  userCode,
  clientId,
  email,
}: {
  userCode: string;
  clientId: string;
  email: string;
}) {
  const [pending, setPending] = useState<Decision | null>(null);
  const [decided, setDecided] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: Decision) {
    setError(null);
    setPending(decision);
    const { error: decisionError } =
      decision === "approve"
        ? await authClient.device.approve({ userCode })
        : await authClient.device.deny({ userCode });
    setPending(null);

    if (decisionError) {
      setError(
        decisionError.error_description ||
          "That code can no longer be decided. Run ai-tutor login again for a new one.",
      );
      return;
    }
    setDecided(decision);
  }

  if (decided) {
    return (
      <AuthCard
        title={decided === "approve" ? "Approved" : "Denied"}
        footer={
          <Link href="/" className="font-semibold text-accent hover:underline">
            Back to Bartholomew
          </Link>
        }
      >
        <p className="text-base text-ink">
          {decided === "approve"
            ? "The terminal finishes logging in on its own within a few seconds. You can close this page."
            : "The terminal stops waiting and stores nothing."}
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Approve this login"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void decide("approve");
      }}
      footer="Only approve a code you started yourself with ai-tutor login."
    >
      <p className="text-base text-ink">
        <span className="font-semibold">{clientId}</span> asks to keep your
        to-do list as {email}.
      </p>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-ink-soft">Code</span>
        <span className="text-xl font-semibold tabular-nums text-ink">
          {formatUserCode(userCode)}
        </span>
        <span className="text-sm text-ink-soft">
          It should match the code in your terminal.
        </span>
      </div>
      <FormError message={error} />
      <div className="flex gap-3">
        <Button type="submit" disabled={pending !== null}>
          {pending === "approve" ? "Approving…" : "Approve"}
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
