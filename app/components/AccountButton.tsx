"use client";

import { LogOut, UserRound } from "lucide-react";
import { signOut } from "next-auth/react";
import styles from "./AccountButton.module.css";

export function AccountButton({ name }: { name: string }) {
  return <details className={styles.account}><summary aria-label={`Open account menu for ${name}`} title={name}><UserRound size={18} /></summary><section className={styles.menu}><p><span>Signed in as</span><strong>{name}</strong></p><button onClick={() => signOut({ redirectTo: "/sign-in" })} type="button"><LogOut size={13} />Sign out</button></section></details>;
}
