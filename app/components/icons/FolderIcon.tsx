export type FolderColor = "walnut" | "clay" | "ochre" | "olive";
type FolderIconSize = "button" | "project" | "topbar";

export const folderColors: FolderColor[] = ["olive", "clay", "ochre", "walnut"];

const colors: Record<FolderColor, { face: string; tab: string; shade: string }> = {
  walnut: { face: "#76533e", tab: "#573b2c", shade: "#452f24" },
  clay: { face: "#ad7052", tab: "#8b5942", shade: "#764936" },
  ochre: { face: "#d3943d", tab: "#ac7630", shade: "#925f25" },
  olive: { face: "#a99a3d", tab: "#7a702d", shade: "#655d27" },
};

const sizes: Record<FolderIconSize, { height: number; width: number }> = {
  button: { height: 16, width: 22 },
  project: { height: 60, width: 82 },
  topbar: { height: 30, width: 42 },
};

export function FolderIcon({ color = "olive", size = "button" }: { color?: FolderColor; size?: FolderIconSize }) {
  const dimensions = sizes[size];
  const palette = colors[color];

  return (
    <svg aria-hidden="true" fill="none" height={dimensions.height} viewBox="0 0 144 104" width={dimensions.width}>
      <path d="M16 20C16 13.92 20.92 9 27 9H55.86C60.28 9 64.26 11.65 65.98 15.72L68.1 20.74C69.41 23.85 72.46 25.88 75.84 25.88H124C130.08 25.88 135 30.8 135 36.88V83C135 89.08 130.08 94 124 94H27C20.92 94 16 89.08 16 83V20Z" fill={palette.tab} />
      {size === "project" && <g><path d="M43 31L83 23L92 66L52 74L43 31Z" fill="#f7f6f1" stroke="#d6d0c5" strokeWidth="1.4" /><path d="M60 25H105V70H60V25Z" fill="#fbfaf5" stroke="#d8d1c5" strokeWidth="1.4" /><path d="M81 30L121 39L111 80L71 71L81 30Z" fill="#f5f3ec" stroke="#d7d0c4" strokeWidth="1.4" /></g>}
      <path d="M16 36C16 29.92 20.92 25 27 25H123C129.08 25 134 29.92 134 36V83C134 89.08 129.08 94 123 94H27C20.92 94 16 89.08 16 83V36Z" fill={palette.face} />
      <path d="M26 84.5C54.78 88.04 94.12 87.8 124 82.5C122.92 89 119.08 94 111.26 94H27C20.92 94 16 89.08 16 83V76.4C18.22 80.28 21.55 83.09 26 84.5Z" fill={palette.shade} opacity=".24" />
    </svg>
  );
}
