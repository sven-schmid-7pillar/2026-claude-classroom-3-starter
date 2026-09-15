import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DeviceApproval } from "@/components/device-approval";
import { SignOutButton } from "@/components/sign-out-button";
import { AuthCard } from "@/components/ui/auth-card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { PageHeader } from "@/components/ui/page-header";
import { auth } from "@/lib/auth";
import { withNext } from "@/lib/next-path";

/**
 * The approval page `ai-tutor login` prints, as `/device?user_code=…`.
 * Rendering it with a code runs Better Auth's device verification as the
 * signed-in user, which binds the pending code to this session — the
 * precondition for approving or denying it — and reports whether it is still
 * undecided. Without a code, or with a bad one, it asks for the code instead.
 */
export default async function DevicePage({
  searchParams,
}: PageProps<"/device">) {
  const { user_code } = await searchParams;
  const userCode = typeof user_code === "string" ? user_code.trim() : "";
  const requestHeaders = await headers();

  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) {
    const here = userCode
      ? `/device?${new URLSearchParams({ user_code: userCode })}`
      : "/device";
    redirect(withNext("/login", here));
  }

  const check = userCode ? await verify(userCode, requestHeaders) : null;

  return (
    <>
      <PageHeader title="Bartholomew" subtitle={session.user.name}>
        <SignOutButton />
      </PageHeader>
      {check && "clientId" in check ? (
        <DeviceApproval
          userCode={userCode}
          clientId={check.clientId}
          email={session.user.email}
        />
      ) : (
        <AuthCard
          title="Log in from a terminal"
          action="/device"
          method="get"
          footer="Run ai-tutor login in a terminal to get a code."
        >
          <FormError message={check?.problem} />
          <Field
            id="user_code"
            label="Code"
            defaultValue={userCode}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
          />
          <Button type="submit">Continue</Button>
        </AuthCard>
      )}
    </>
  );
}

async function verify(
  userCode: string,
  requestHeaders: Headers,
): Promise<{ clientId: string } | { problem: string }> {
  let result: Awaited<ReturnType<typeof auth.api.deviceVerify>>;
  try {
    result = await auth.api.deviceVerify({
      query: { user_code: userCode },
      headers: requestHeaders,
    });
  } catch (error) {
    if (error instanceof APIError) {
      return {
        problem:
          "That code is not valid or has expired. Run ai-tutor login again for a new one.",
      };
    }
    throw error;
  }

  if (result.status !== "pending") {
    return {
      problem:
        "That code has already been approved or denied. Run ai-tutor login again for a new one.",
    };
  }
  // Better Auth reveals the client only to the session the code is bound to.
  if (!result.client_id) {
    return {
      problem:
        "Another account opened that code first. Log in as that account to approve it.",
    };
  }
  return { clientId: result.client_id };
}
