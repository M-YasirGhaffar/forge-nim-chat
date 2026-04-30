import "server-only";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { getAdminAuth } from "./admin";

const projectId =
  process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "";

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);

const APPCHECK_JWKS = createRemoteJWKSet(
  new URL("https://firebaseappcheck.googleapis.com/v1/jwks")
);

export interface VerifiedUser {
  uid: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  picture?: string;
}

export async function verifyIdToken(token: string): Promise<VerifiedUser> {
  // Prefer Admin SDK when available — it handles revocation checks and key rotation.
  try {
    const decoded = await getAdminAuth().verifyIdToken(token, true);
    return {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified,
      name: decoded.name,
      picture: decoded.picture,
    };
  } catch (adminErr) {
    // Fall back to jose-based verification for environments where Admin SDK is unavailable.
    if (!projectId) throw adminErr;
    const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });
    return {
      uid: payload.sub as string,
      email: payload.email as string | undefined,
      emailVerified: payload.email_verified as boolean | undefined,
      name: payload.name as string | undefined,
      picture: payload.picture as string | undefined,
    };
  }
}

export async function verifyAppCheckToken(token: string): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, APPCHECK_JWKS, {
      issuer: `https://firebaseappcheck.googleapis.com/${projectId}`,
      audience: [`projects/${projectId}`],
    });
    return Boolean(payload.sub);
  } catch {
    return false;
  }
}

export function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth) return null;
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m ? m[1] : null;
}
