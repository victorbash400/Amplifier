"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import styles from "../sign-in/sign-in.module.css";

type PasswordFieldProps = {
  autoComplete: "current-password" | "new-password";
  onChange: (value: string) => void;
  value: string;
};

export function PasswordField({ autoComplete, onChange, value }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return <label>Password<span className={styles.passwordField}><input autoComplete={autoComplete} onChange={(event) => onChange(event.target.value)} type={visible ? "text" : "password"} value={value} /><button aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible} onClick={() => setVisible((current) => !current)} type="button">{visible ? <EyeOff size={15} /> : <Eye size={15} />}</button></span></label>;
}
