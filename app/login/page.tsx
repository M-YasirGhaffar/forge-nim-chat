import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/firebase/session";
import LoginClient from "./login-client";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getSessionUser().catch(() => null);
  if (user) redirect("/chat");
  return <LoginClient />;
}
