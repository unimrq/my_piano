const paths = {
  piano: "M4 4h16v16H4ZM8 4v9h3V4M13 4v9h3V4M8 13v7M12 13v7M16 13v7",
  daily: "M8 2v4M16 2v4M3 10h18M3 5h18v16H3Zm5 10 3 3 5-5",
  check: "m5 12 4 4L19 6",
  back: "m14 6-6 6 6 6",
  play: "m9 5 11 7-11 7Z",
  pause: "M9 5v14M15 5v14",
  restart: "M4 10a8 8 0 1 1 1 7M4 4v6h6",
  repeat:
    "m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4M21 13v3a2 2 0 0 1-2 2H3",
  expand: "M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5",
  collapse: "M3 8h5V3M21 8h-5V3M8 21v-5H3M16 21v-5h5",
  settings:
    "M12 3v3M12 18v3M3 12h3M18 12h3m-15.4-6.4 2.1 2.1m8.6 8.6 2.1 2.1m-12.8 0 2.1-2.1m8.6-8.6 2.1-2.1M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0",
  close: "m6 6 12 12M6 18 18 6",
  grid: "M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z",
  heart:
    "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 7v5l3 2",
  metronome: "m7 21 3-18h4l3 18ZM12 16l6-9M6 21h12",
  import: "M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4",
  search: "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0m-1.5 4.5L21 21",
  plus: "M12 5v14M5 12h14",
  info: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 11v6M12 7v.1",
  chevron: "m8 10 4 4 4-4",
};
export type IconName = keyof typeof paths;
export default function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="ui-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
