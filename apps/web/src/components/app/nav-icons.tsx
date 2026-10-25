const PATHS = {
  calendar: <path d="M5 4h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm-2 4.5h14M7 2.5v3m6-3v3" />,
  inbox: <path d="M3 12.5 5.2 5.4A2 2 0 0 1 7.1 4h7.8a2 2 0 0 1 1.9 1.4L19 12.5M3 12.5V16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3.5M3 12.5h4.2a1 1 0 0 1 .9.6 2.2 2.2 0 0 0 4 0 1 1 0 0 1 .9-.6H19" />,
  agent: <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4h6A1.5 1.5 0 0 1 12 5.5v4a1.5 1.5 0 0 1-1.5 1.5H7l-3 2.5V11A1.5 1.5 0 0 1 3 9.5v-4Zm11 2h1.5A1.5 1.5 0 0 1 17 9v4a1.5 1.5 0 0 1-1 1.4V17l-3-2h-3a1.5 1.5 0 0 1-1.4-1" />,
  analytics: <path d="M3 3v13a1 1 0 0 0 1 1h13M6.5 12.5l3-3.5 2.5 2.5 4-5" />,
  knowledge: <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H16v12H5.5A1.5 1.5 0 0 0 4 16.5v-12ZM4 16.5A1.5 1.5 0 0 0 5.5 18H16v-3M8 7h5M8 10h5" />,
  media: <path d="M5 4h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm-2 3h14M7.5 12.5l2-2 2 2 1.5-1.5 2 2" />,
  channels: <path d="M4 10a6 6 0 0 1 6-6m-3 6a3 3 0 0 1 3-3m3 3a3 3 0 0 1-3 3m6-3a6 6 0 0 1-6 6M10 10h.01" />,
  billing: <path d="M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm0-11v8m2-6.2c-.4-.5-1.1-.8-2-.8-1.1 0-2 .6-2 1.5s.8 1.2 2 1.5 2 .6 2 1.5-.9 1.5-2 1.5c-.9 0-1.6-.3-2-.8" />,
  settings: <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm6.2-1.2 1.3 1-1.5 2.6-1.6-.5a6 6 0 0 1-1.4.8l-.3 1.6h-3l-.3-1.6a6 6 0 0 1-1.4-.8l-1.6.5-1.5-2.6 1.3-1a6 6 0 0 1 0-1.6l-1.3-1L5 6.2l1.6.5a6 6 0 0 1 1.4-.8L8.3 4.3h3l.3 1.6a6 6 0 0 1 1.4.8l1.6-.5 1.5 2.6-1.3 1c.1.5.1 1 0 1.5Z" />,
  bell: <path d="M5 8a5 5 0 0 1 10 0c0 4 1.5 5 1.5 5h-13S5 12 5 8Zm3.5 7.5a1.6 1.6 0 0 0 3 0" />,
} as const;

export type NavIconName = keyof typeof PATHS;

export function NavIcon({ name, size = 22 }: { name: NavIconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
