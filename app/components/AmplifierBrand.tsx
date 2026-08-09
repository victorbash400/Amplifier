import Image from "next/image";
import styles from "./AmplifierBrand.module.css";

export function AmplifierBrand({ size = "header" }: { size?: "header" | "hero" }) {
  return <p className={styles.brand} data-size={size}><Image alt="" height={size === "hero" ? 36 : 18} src="/amplifier-speaker-loud-svgrepo-com.svg" width={size === "hero" ? 36 : 18} /><span>Amplifier</span></p>;
}
