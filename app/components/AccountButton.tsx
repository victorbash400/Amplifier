"use client";

import { LogOut, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState } from "react";
import styles from "./AccountButton.module.css";

export function AccountButton({ name }: { name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setError(undefined);
    setSigningOut(true);
    try {
      await signOut({ redirect: false, redirectTo: `${window.location.origin}/sign-in` });
      router.replace("/sign-in");
      router.refresh();
    } catch {
      setError("Could not sign out");
      setSigningOut(false);
    }
  }

  return <details className={styles.account}><summary aria-label={`Open account menu for ${name}`} title={name}><UserRound size={18} /></summary><section className={styles.menu}><p><span>Signed in as</span><strong>{name}</strong></p>{error && <p role="alert">{error}</p>}<button disabled={signingOut} onClick={handleSignOut} type="button"><LogOut size={13} />{signingOut ? "Signing out" : "Sign out"}</button></section></details>;
}
