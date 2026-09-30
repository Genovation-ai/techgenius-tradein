/**
 * Brand marks for the model picker.
 *
 * A row of words is a form; a row of marks is a storefront, and the shop
 * compared ours against one that uses marks. Drawn inline rather than fetched
 * so the widget stays one file on someone else's page and a slow CDN cannot
 * leave a row of empty boxes where the brands should be.
 *
 * Anything without a mark falls back to its name set as a wordmark, which is
 * honest and looks deliberate — better than a generic placeholder glyph that
 * says nothing about which brand it is.
 */
import type { JSX } from "react";

interface Props {
  brand: string;
  className?: string;
}

const box = { viewBox: "0 0 24 24", "aria-hidden": true as const, focusable: "false" as const };

const MARKS: Record<string, () => JSX.Element> = {
  apple: () => (
    <svg {...box} fill="currentColor">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  ),
  google: () => (
    <svg {...box}>
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.8z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.88-3.01c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.09A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.29 14.28a7.2 7.2 0 0 1 0-4.56V6.63H1.28a12 12 0 0 0 0 10.74l4.01-3.09z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.63l4.01 3.09C6.23 6.88 8.88 4.77 12 4.77z" />
    </svg>
  ),
  samsung: () => (
    <svg viewBox="0 0 96 24" aria-hidden focusable="false">
      <ellipse cx="48" cy="12" rx="47" ry="11.4" fill="#1428A0" />
      <text
        x="48"
        y="16.3"
        textAnchor="middle"
        fill="#fff"
        fontSize="11"
        fontWeight="700"
        letterSpacing="1.1"
        fontFamily="Helvetica, Arial, sans-serif"
      >
        SAMSUNG
      </text>
    </svg>
  ),
  microsoft: () => (
    <svg {...box}>
      <path fill="#F25022" d="M2 2h9.2v9.2H2z" />
      <path fill="#7FBA00" d="M12.8 2H22v9.2h-9.2z" />
      <path fill="#00A4EF" d="M2 12.8h9.2V22H2z" />
      <path fill="#FFB900" d="M12.8 12.8H22V22h-9.2z" />
    </svg>
  ),
  motorola: () => (
    <svg {...box} fill="none">
      <circle cx="12" cy="12" r="10.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.8 16.2 8.9 7.8l3.1 4.7 3.1-4.7 3.1 8.4h-2.3l-1.4-4-2.5 3.8-2.5-3.8-1.4 4z" fill="currentColor" />
    </svg>
  ),
  oneplus: () => (
    <svg {...box} fill="none">
      <rect x="2" y="2" width="20" height="20" rx="4.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7.1 9.1h2V16M13.2 12.6h4.4M15.4 10.4v4.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  lg: () => (
    <svg {...box} fill="none">
      <circle cx="12" cy="12" r="10.4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8.4 7.6v6.1h3.2M16.3 10.2a2.8 2.8 0 1 0 .2 3.6h-1.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  sony: () => (
    <svg viewBox="0 0 80 24" aria-hidden focusable="false">
      <text x="40" y="17" textAnchor="middle" fill="currentColor" fontSize="15" fontWeight="700" letterSpacing="2.4" fontFamily="Helvetica, Arial, sans-serif">
        SONY
      </text>
    </svg>
  ),
  nintendo: () => (
    <svg viewBox="0 0 96 24" aria-hidden focusable="false">
      <rect x="1" y="3" width="94" height="18" rx="9" fill="#E60012" />
      <text x="48" y="16.4" textAnchor="middle" fill="#fff" fontSize="10.5" fontWeight="700" letterSpacing="0.6" fontFamily="Helvetica, Arial, sans-serif">
        Nintendo
      </text>
    </svg>
  ),
  huawei: () => (
    <svg {...box} fill="none">
      <path d="M12 2.4c-2.6 3.1-3.8 6.6-3.6 10.3.1 2.6.9 5.2 2.3 7.6-3.1-2-5.3-4.5-6.5-7.4-.9-2.2-1-4-.9-5 1.9.9 3.4 2.4 4.6 4.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 2.4c2.6 3.1 3.8 6.6 3.6 10.3-.1 2.6-.9 5.2-2.3 7.6 3.1-2 5.3-4.5 6.5-7.4.9-2.2 1-4 .9-5-1.9.9-3.4 2.4-4.6 4.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  meta: () => (
    <svg {...box} fill="none">
      <path d="M3 15.2c0-3.9 1.9-7.4 4.3-7.4 1.4 0 2.5 1 3.6 2.7L12 12.6l1.1-2.1c1.1-1.7 2.2-2.7 3.6-2.7 2.4 0 4.3 3.5 4.3 7.4 0 2.2-1 3.6-2.7 3.6-1.6 0-2.6-1-4-3.4L12 13.2l-2.3 2.2c-1.4 2.4-2.4 3.4-4 3.4C4 18.8 3 17.4 3 15.2z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  ),
  nothing: () => (
    <svg viewBox="0 0 96 24" aria-hidden focusable="false">
      <text x="48" y="16.6" textAnchor="middle" fill="currentColor" fontSize="11" fontWeight="500" letterSpacing="3" fontFamily="Helvetica, Arial, sans-serif">
        NOTHING
      </text>
    </svg>
  ),
};

/** Name set as a wordmark, for a brand with no drawn mark. */
function Wordmark({ name }: { name: string }) {
  const text = name.toUpperCase();
  // Long names need a wider box or the letters squash together.
  const w = Math.max(56, text.length * 9.5);
  return (
    <svg viewBox={`0 0 ${w} 24`} aria-hidden focusable="false">
      <text
        x={w / 2}
        y="16.4"
        textAnchor="middle"
        fill="currentColor"
        fontSize="11.5"
        fontWeight="700"
        letterSpacing="1.4"
        fontFamily="Helvetica, Arial, sans-serif"
      >
        {text}
      </text>
    </svg>
  );
}

/** Normalise "Apple", "apple-smartphone", "OnePlus" to a registry key. */
export function brandKey(brand: string): string {
  return brand
    .toLowerCase()
    .replace(/-(smartphone|tablet|laptop|smartwatch|gaming-console|computer|monitor|vr|series)$/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function hasBrandMark(brand: string): boolean {
  return brandKey(brand) in MARKS;
}

export function BrandLogo({ brand, className }: Props) {
  const Mark = MARKS[brandKey(brand)];
  return (
    <span className={className}>{Mark ? <Mark /> : <Wordmark name={brand} />}</span>
  );
}
