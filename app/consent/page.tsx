import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ConsentApproval } from "@/components/consent-approval";
import { SignOutButton } from "@/components/sign-out-button";
import { AuthCard } from "@/components/ui/auth-card";
import { PageHeader } from "@/components/ui/page-header";
import { auth } from "@/lib/auth";
import { oauthQuery, withNext } from "@/lib/next-path";

/**
 * Where Better Auth sends a signed-in user when an MCP client such as Claude
 * Code asks for their to-do list: `/consent?client_id=…&scope=…` plus the
 * signed authorization request, which components/consent-approval.tsx sends
 * back with the decision. The client's name comes from its metadata document.
 */
export default async function ConsentPage({
  searchParams,
}: PageProps<"/consent">) {
  const params = await searchParams;
  const query = oauthQuery(params);
  const requestHeaders = await headers();

  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) {
    redirect(withNext("/login", `/consent${query}`));
  }

  const clientId = typeof params.client_id === "string" ? params.client_id : "";
  const client =
    query && clientId ? await publicClient(clientId, requestHeaders) : null;
  const scopes =
    typeof params.scope === "string"
      ? params.scope.split(" ").filter(Boolean)
      : [];

  return (
    <>
      <PageHeader title="Bartholomew" subtitle={session.user.name}>
        <SignOutButton />
      </PageHeader>
      {client ? (
        <ConsentApproval
          clientId={clientId}
          clientName={client.client_name || clientId}
          scopes={scopes}
          email={session.user.email}
        />
      ) : (
        <AuthCard
          title="Nothing to allow"
          footer="Connect from the application again to start over."
        >
          <p className="text-base text-ink">
            There is no pending request from an application for your to-do list.
          </p>
        </AuthCard>
      )}
    </>
  );
}

async function publicClient(clientId: string, requestHeaders: Headers) {
  try {
    return await auth.api.getOAuthClientPublic({
      query: { client_id: clientId },
      headers: requestHeaders,
    });
  } catch (error) {
    if (error instanceof APIError) {
      return null;
    }
    throw error;
  }
}
