import Image from "next/image";
import { AuthForm } from "../components/AuthForm";
import styles from "./sign-in.module.css";

export default function SignInPage() {
  return <main className={styles.page}><section className={styles.card}><p className={styles.icon}><Image alt="Amplifier" height={30} src="/amplifier-speaker-loud-svgrepo-com.svg" width={30} /></p><h1>Sign in to continue</h1><p>Open your private workspace and continue creating.</p><AuthForm /></section></main>;
}
