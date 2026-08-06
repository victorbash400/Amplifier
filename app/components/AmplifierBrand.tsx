import Image from "next/image";
import styles from "./AmplifierBrand.module.css";

export function AmplifierBrand() {
  return <p className={styles.brand}><Image alt="" height={18} src="/amplifier-speaker-loud-svgrepo-com.svg" width={18} /><span>Amplifier</span></p>;
}
