// Iconos SVG propios (trazo redondeado, heredan currentColor)
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

export const IconChevronLeft = (p) => (<svg {...base} {...p}><path d="M15 5l-7 7 7 7" /></svg>);
export const IconChevronRight = (p) => (<svg {...base} {...p}><path d="M9 5l7 7-7 7" /></svg>);
export const IconCheck = (p) => (<svg {...base} {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>);
export const IconClose = (p) => (<svg {...base} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>);
export const IconPlus = (p) => (<svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>);
export const IconRefresh = (p) => (<svg {...base} {...p}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>);
export const IconUsers = (p) => (
  <svg {...base} {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
    <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.4c1.9.8 3 2.8 3 5.6" />
  </svg>
);
export const IconDoor = (p) => (
  <svg {...base} {...p}>
    <path d="M14 4H6v16h8" />
    <path d="M11 12h10M17.5 8.5L21 12l-3.5 3.5" />
  </svg>
);
export const IconSend = (p) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...p}>
    <path fill="currentColor" d="M.17 3.7C-.22 2.65.08 1.47.92.71 1.76-.04 2.95-.21 3.97.28l18.09 8.45c.97.45 1.66 1.28 1.94 2.27H4.05L.23 3.84l-.06-.13Zm3.9 9.3L.3 20.18l-.05.12c-.39 1.06-.1 2.24.75 2.99.52.47 1.18.71 1.84.71.41 0 .82-.09 1.2-.28L22.06 15.3c.97-.46 1.67-1.29 1.94-2.28H4.06Z" />
  </svg>
);
export const IconCrown = (p) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...p}>
    <path fill="currentColor" d="M22.77 4.57a2 2 0 0 0-2.18.43L18 7.59 13.41 3a2 2 0 0 0-2.82 0L6 7.59 3.41 5A2 2 0 0 0 0 6.41V17a5 5 0 0 0 5 5h14a5 5 0 0 0 5-5V6.41a2 2 0 0 0-1.23-1.84Z" />
  </svg>
);
export const IconRobot = (p) => (
  <svg {...base} {...p}>
    <rect x="4" y="8" width="16" height="12" rx="3" />
    <path d="M12 4v4M9 13h.01M15 13h.01M9.5 17h5" />
    <circle cx="12" cy="3.5" r="1" />
  </svg>
);
export const IconWifiOff = (p) => (
  <svg {...base} {...p}>
    <path d="M3 3l18 18" />
    <path d="M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4.2-2.4M19 12.5a10 10 0 0 0-2.3-1.6M2 8.8a15 15 0 0 1 4.3-2.6M22 8.8a15 15 0 0 0-11-3.7" />
    <path d="M12 20h.01" />
  </svg>
);
export const IconVolume = (p) => (
  <svg {...base} {...p}>
    <path d="M4 9.5v5h4l5 4.5v-14L8 9.5H4z" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
  </svg>
);
export const IconVolumeLow = (p) => (
  <svg {...base} {...p}>
    <path d="M4 9.5v5h4l5 4.5v-14L8 9.5H4z" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7" />
  </svg>
);
export const IconMusic = (p) => (
  <svg {...base} {...p}>
    <path d="M9 18V5.5l11-2V16" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="17.5" cy="16" r="2.5" />
  </svg>
);
export const IconStar = (p) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...p}>
    <path fill="currentColor" d="M12 2.2l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" />
  </svg>
);
export const IconEye = (p) => (
  <svg {...base} {...p}>
    <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
export const IconVolumeOff = (p) => (
  <svg {...base} {...p}>
    <path d="M4 9.5v5h4l5 4.5v-14L8 9.5H4z" />
    <path d="M17 9.5l5 5M22 9.5l-5 5" />
  </svg>
);
export const IconHelp = (p) => (
  <svg {...base} {...p}>
    <path d="M9 9.2a3 3 0 1 1 4.2 2.8c-.8.4-1.2 1-1.2 1.8v.7" />
    <path d="M12 18h.01" />
  </svg>
);
export const IconPlay = (p) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...p}>
    <path fill="currentColor" d="M7 4.6v14.8a1.4 1.4 0 0 0 2.1 1.2l11.6-7.4a1.4 1.4 0 0 0 0-2.4L9.1 3.4A1.4 1.4 0 0 0 7 4.6z" />
  </svg>
);
export const IconWarning = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3.5L2.5 20h19L12 3.5z" />
    <path d="M12 10v4.5M12 17.2h.01" />
  </svg>
);
export const IconSparkle = (p) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...p}>
    <path fill="currentColor" d="M12 1.5l2.4 7.1 7.1 2.4-7.1 2.4-2.4 7.1-2.4-7.1-7.1-2.4 7.1-2.4z" />
  </svg>
);
