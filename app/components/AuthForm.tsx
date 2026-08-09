"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { demoAccount } from "../lib/demoAccount";
import styles from "../sign-in/sign-in.module.css";

type Mode = "signin" | "create";

export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);
    try {
      if (mode === "create") {
        const response = await fetch("/api/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, name }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not create account");
      }
      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) throw new Error("Email or password is incorrect");
      router.push("/");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  }

  function useDemo() {
    setMode("signin");
    setEmail(demoAccount.email);
    setPassword(demoAccount.password);
    setName("");
    setError(undefined);
  }

  return <><form className={styles.form} onSubmit={submit}>{mode === "create" && <label>Name<input autoComplete="name" onChange={(event) => setName(event.target.value)} value={name} /></label>}<label>Email<input autoComplete="username" onChange={(event) => setEmail(event.target.value)} type="email" value={email} /></label><label>Password<input autoComplete={mode === "signin" ? "current-password" : "new-password"} onChange={(event) => setPassword(event.target.value)} type="password" value={password} /></label>{error && <p className={styles.error} role="alert">{error}</p>}<button disabled={!email || !password || (mode === "create" && !name) || submitting} type="submit">{submitting ? "Working" : mode === "signin" ? "Sign in" : "Create account"}</button></form><p className={styles.switchPrompt}>{mode === "signin" ? "New to Amplifier?" : "Already have an account?"}<button onClick={() => { setMode(mode === "signin" ? "create" : "signin"); setError(undefined); }} type="button">{mode === "signin" ? "Create account" : "Sign in"}</button></p>{mode === "signin" && <button className={styles.demo} onClick={useDemo} type="button">Use demo account</button>}</>;
}
