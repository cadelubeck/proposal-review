import React from 'react'

const paths = {
  civic: <><path d="M3 9h18M5 9V20m4-11V20m6-11V20m4-11V20M2 20h20M12 3 2 8h20L12 3Z" /></>,
  file: <><path d="M6 2h8l5 5v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" /><path d="M14 2v6h5M8 13h8M8 17h6" /></>,
  scales: <><path d="M12 3v18M5 7h14M4 7 1 13h6L4 7Zm16 0-3 6h6l-3-6ZM7 21h10" /></>,
  diagram: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="m7 16 4-4 3 2 3-5M7 7h3" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  work: <><rect x="3" y="7" width="18" height="14" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" /></>,
  book: <><path d="M12 6c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v15" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
  chevron: <><path d="m6 9 6 6 6-6" /></>,
  arrow: <><path d="m15 18-6-6 6-6" /></>,
  logout: <><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5M16 16l4-4-4-4m4 4H9" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3m-9 0 1 14h10l1-14M10 11v6m4-6v6" /></>,
  check: <><path d="m4 12 5 5L20 6" /></>,
  alert: <><path d="M12 3 2 21h20L12 3Zm0 7v4m0 4h.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10h.01" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  external: <><path d="M13 5h6v6m0-6-9 9" /><path d="M19 14v5H5V5h5" /></>,
  x: <><path d="M5 5 19 19M19 5 5 19" /></>
}

export default function Icon({ name, size = 18, ...props }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{paths[name] || paths.file}</svg>
}
