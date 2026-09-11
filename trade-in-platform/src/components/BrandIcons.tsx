/** Minimal brand marks — geometric, no generic “AI sparkle” look. */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base(props: IconProps) {
  const { size = 20, ...rest } = props;
  return { width: size, height: size, viewBox: "0 0 24 24", fill: "none", ...rest };
}

/** Green square with TG cut — used in headers */
export function TgMark({ size = 22, ...rest }: IconProps) {
  return (
    <svg {...base({ size, ...rest })} aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="4" fill="currentColor" />
      <path
        d="M7.2 8.2h9.6M12 8.2v7.6"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="square"
      />
    </svg>
  );
}

export function IconBack({ size = 18, ...rest }: IconProps) {
  return (
    <svg {...base({ size, ...rest })} aria-hidden>
      <path
        d="M14.5 5.5 8 12l6.5 6.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconTruck({ size = 18, ...rest }: IconProps) {
  return (
    <svg {...base({ size, ...rest })} aria-hidden>
      <path
        d="M3 7.5h11.5V16H3V7.5Zm11.5 3H18l2.5 3V16h-6V10.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="17.5" r="1.4" fill="currentColor" />
      <circle cx="16.5" cy="17.5" r="1.4" fill="currentColor" />
    </svg>
  );
}

export function IconShield({ size = 18, ...rest }: IconProps) {
  return (
    <svg {...base({ size, ...rest })} aria-hidden>
      <path
        d="M12 3.5 19 6.5v5.2c0 4.2-2.9 7.4-7 8.8-4.1-1.4-7-4.6-7-8.8V6.5L12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M9.5 12.1 11.2 13.8 14.8 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconBolt({ size = 18, ...rest }: IconProps) {
  return (
    <svg {...base({ size, ...rest })} aria-hidden>
      <path
        d="M13 3.5 6.5 13h5l-1 7.5L17.5 11h-5l.5-7.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconCheck({ size = 20, ...rest }: IconProps) {
  return (
    <svg {...base({ size, ...rest })} aria-hidden>
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.2 12.2 10.8 14.7 15.8 9.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconBox({ size = 18, ...rest }: IconProps) {
  return (
    <svg {...base({ size, ...rest })} aria-hidden>
      <path
        d="M4 8.2 12 4l8 4.2v7.6L12 20l-8-4.2V8.2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M12 12v8M4 8.2l8 3.8 8-3.8" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function IconCopy({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base({ size, ...rest })} aria-hidden>
      <rect x="8" y="8" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6 14V6.5A1.5 1.5 0 0 1 7.5 5H14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/* Admin nav marks */
export function NavDashboard(p: IconProps) {
  return (
    <svg {...base({ size: 18, ...p })} aria-hidden>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13.5" y="3.5" width="7" height="4.5" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13.5" y="10.5" width="7" height="10" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3.5" y="13" width="7" height="7.5" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function NavOffers(p: IconProps) {
  return (
    <svg {...base({ size: 18, ...p })} aria-hidden>
      <path d="M5 6h14M5 12h14M5 18h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function NavShip(p: IconProps) {
  return (
    <svg {...base({ size: 18, ...p })} aria-hidden>
      <path d="M5 16V8l7-3 7 3v8l-7 3-7-3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 5v14M5 8l7 3 7-3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function NavInventory(p: IconProps) {
  return (
    <svg {...base({ size: 18, ...p })} aria-hidden>
      <path d="M4 8h16v11H4V8Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 8V6.5A4 4 0 0 1 16 6.5V8" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function NavCatalog(p: IconProps) {
  return (
    <svg {...base({ size: 18, ...p })} aria-hidden>
      <rect x="4" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <rect x="4" y="13" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13" y="13" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function NavPricing(p: IconProps) {
  return (
    <svg {...base({ size: 18, ...p })} aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7.5v9M9.5 9.5c.6-1 1.5-1.5 2.5-1.5 1.4 0 2.5.8 2.5 2s-1.1 2-2.5 2h-1c-1.4 0-2.5.8-2.5 2s1.1 2 2.5 2c1 0 1.9-.5 2.5-1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function NavCustomers(p: IconProps) {
  return (
    <svg {...base({ size: 18, ...p })} aria-hidden>
      <circle cx="12" cy="9" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5.5 19c1.2-3 3.4-4.5 6.5-4.5s5.3 1.5 6.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function NavReports(p: IconProps) {
  return (
    <svg {...base({ size: 18, ...p })} aria-hidden>
      <path d="M5 19V10M10 19V5M15 19v-6M20 19V8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function NavSettings(p: IconProps) {
  return (
    <svg {...base({ size: 18, ...p })} aria-hidden>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M5.8 5.8l1.6 1.6M16.6 16.6l1.6 1.6M18.2 5.8l-1.6 1.6M7.4 16.6l-1.6 1.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function NavTeam(p: IconProps) {
  return (
    <svg {...base({ size: 18, ...p })} aria-hidden>
      <circle cx="9" cy="9" r="2.4" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16" cy="10" r="2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M4.5 17.5c.6-2.2 2.3-3.5 4.5-3.5s3.9 1.3 4.5 3.5M13.2 17.5c.3-1.4 1.2-2.4 2.8-2.4 1.4 0 2.3.8 2.7 2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function NavInvoice(p: IconProps) {
  return (
    <svg {...base({ size: 18, ...p })} aria-hidden>
      <path d="M7 3.5h10v17l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2V3.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9.5 7.5h5M9.5 10.5h5M9.5 13.5h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function NavPayout(p: IconProps) {
  return (
    <svg {...base({ size: 18, ...p })} aria-hidden>
      <rect x="3.5" y="6" width="17" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 10h17" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="14" r="1.4" fill="currentColor" />
    </svg>
  );
}

export function NavBulk(p: IconProps) {
  return (
    <svg {...base({ size: 18, ...p })} aria-hidden>
      <path d="M5 7h14M5 12h14M5 17h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function NavSearch(p: IconProps) {
  return (
    <svg {...base({ size: 18, ...p })} aria-hidden>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16 16.5 20 20.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function NavBell(p: IconProps) {
  return (
    <svg {...base({ size: 18, ...p })} aria-hidden>
      <path
        d="M6.5 16.5h11M7.5 16.5V10a4.5 4.5 0 1 1 9 0v6.5M10.5 16.5a1.5 1.5 0 0 0 3 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function NavMenu(p: IconProps) {
  return (
    <svg {...base({ size: 18, ...p })} aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function NavClose(p: IconProps) {
  return (
    <svg {...base({ size: 18, ...p })} aria-hidden>
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function NavCollapse(p: IconProps) {
  return (
    <svg {...base({ size: 18, ...p })} aria-hidden>
      <path d="M14 6 8 12l6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function NavExpand(p: IconProps) {
  return (
    <svg {...base({ size: 18, ...p })} aria-hidden>
      <path d="M10 6l6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
