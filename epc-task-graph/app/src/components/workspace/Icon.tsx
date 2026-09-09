import type { CSSProperties } from "react";
export type IconName =
  | "overview"
  | "graph"
  | "table"
  | "gantt"
  | "search"
  | "plus"
  | "arrow"
  | "check"
  | "alert"
  | "clock"
  | "settings"
  | "filter"
  | "close"
  | "chevron"
  | "download"
  | "folder"
  | "spark"
  | "help";
const paths: Record<IconName, string> = {
  overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  graph: "M3 9h5v6H3z M16 2h5v6h-5z M16 16h5v6h-5z M8 12h4V5h4 M12 12v7h4",
  table: "M3 4h18v16H3z M3 10h18 M9 4v16 M3 15h18",
  gantt: "M4 3v18h17 M8 6h7 M11 11h8 M15 16h6",
  search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  plus: "M12 5v14 M5 12h14",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  check: "M5 12l4 4L19 6",
  alert: "M12 3L2 21h20L12 3z M12 9v5 M12 17v1",
  clock: "M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  settings: "M4 7h16 M4 17h16 M9 4v6 M15 14v6",
  filter: "M3 5h18 M6 12h12 M9 19h6",
  close: "M6 6l12 12 M18 6L6 18",
  chevron: "M9 5l7 7-7 7",
  download: "M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5",
  folder: "M3 6h7l2 3h9v11H3z",
  spark: "M12 3l3 6 6 3-6 3-3 6-3-6-6-3 6-3z",
  help: "M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3 M12 17v.2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
};
export function Icon({
  name,
  size = 18,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
