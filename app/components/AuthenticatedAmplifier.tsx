"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { AmplifierShell } from "./AmplifierShell";

export function AuthenticatedAmplifier() {
  const router = useRouter();
  const { data: session, status } = useSession();
  useEffect(() => { if (status === "unauthenticated") router.replace("/sign-in"); }, [router, status]);
  if (status !== "authenticated" || !session.user) return null;
  return <AmplifierShell userName={session.user.name || session.user.email || "Account"} />;
}
