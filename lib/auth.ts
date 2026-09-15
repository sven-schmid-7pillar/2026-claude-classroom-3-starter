import "server-only";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { bearer } from "better-auth/plugins";
import {
  authOptions,
  cliDeviceAuthorization,
  signedDeviceToken,
} from "@/lib/auth-config";
import { db } from "@/lib/db";

export const auth = betterAuth({
  ...authOptions(db),
  plugins: [
    // Lets /api/todos clients send the session token as `Authorization:
    // Bearer`. requireSignature rejects the raw token as stored in the session
    // table, so only the signed form from `set-auth-token` authenticates.
    bearer({ requireSignature: true }),
    // `ai-tutor login`, whose token signedDeviceToken signs for bearer above.
    cliDeviceAuthorization(),
    signedDeviceToken(),
    // nextCookies mirrors Set-Cookie into next/headers, so it must stay last.
    nextCookies(),
  ],
});
