/**
 * The colours a model was actually sold in.
 *
 * Every device used to offer the same twelve — Black, White, Silver, Grey,
 * Gold, Blue, Green, Red, Purple, Pink, Yellow, Other — which is not what a
 * person holding a Cosmic Orange iPhone 17 Pro sees when they look at it, and
 * a list that long on every step is most of why the step felt like a form.
 *
 * These are the manufacturers' own launch palettes, by family, most specific
 * pattern first so "iPhone 16 Pro" takes the Pro palette and not the base one.
 * The catalogue's upstream carries no colour data, so this is curated rather
 * than synced; a model with no entry falls back to a short neutral set rather
 * than to nothing, and "Other" is always there for the finish nobody listed.
 *
 * The colour is never priced on. It is how the shop matches the parcel on the
 * bench to the offer on the screen.
 */

type Entry = { match: RegExp; colors: string[] };

const OTHER = "Other";

// Apple
const IPHONE: Entry[] = [
  { match: /iphone\s*17\s*pro/, colors: ["Silver", "Cosmic Orange", "Deep Blue"] },
  { match: /iphone\s*air/, colors: ["Space Black", "Cloud White", "Light Gold", "Sky Blue"] },
  { match: /iphone\s*17\b/, colors: ["Black", "White", "Mist Blue", "Sage", "Lavender"] },
  { match: /iphone\s*16\s*pro/, colors: ["Black Titanium", "White Titanium", "Natural Titanium", "Desert Titanium"] },
  { match: /iphone\s*16e/, colors: ["Black", "White"] },
  { match: /iphone\s*16\b/, colors: ["Black", "White", "Pink", "Teal", "Ultramarine"] },
  { match: /iphone\s*15\s*pro/, colors: ["Black Titanium", "White Titanium", "Blue Titanium", "Natural Titanium"] },
  { match: /iphone\s*15\b/, colors: ["Black", "Blue", "Green", "Yellow", "Pink"] },
  { match: /iphone\s*14\s*pro/, colors: ["Space Black", "Silver", "Gold", "Deep Purple"] },
  { match: /iphone\s*14\b/, colors: ["Midnight", "Starlight", "Blue", "Purple", "Yellow", "Red"] },
  { match: /iphone\s*13\s*pro/, colors: ["Graphite", "Gold", "Silver", "Sierra Blue", "Alpine Green"] },
  { match: /iphone\s*13\b/, colors: ["Midnight", "Starlight", "Pink", "Blue", "Green", "Red"] },
  { match: /iphone\s*12\s*pro/, colors: ["Graphite", "Silver", "Gold", "Pacific Blue"] },
  { match: /iphone\s*12\b/, colors: ["Black", "White", "Blue", "Green", "Red", "Purple"] },
  { match: /iphone\s*11\s*pro/, colors: ["Space Grey", "Silver", "Gold", "Midnight Green"] },
  { match: /iphone\s*11\b/, colors: ["Black", "White", "Green", "Yellow", "Purple", "Red"] },
  { match: /iphone\s*se/, colors: ["Midnight", "Starlight", "Red", "Black", "White"] },
  { match: /iphone\s*xs/, colors: ["Space Grey", "Silver", "Gold"] },
  { match: /iphone\s*xr/, colors: ["Black", "White", "Blue", "Yellow", "Coral", "Red"] },
  { match: /iphone\s*x\b/, colors: ["Space Grey", "Silver"] },
];

const IPAD: Entry[] = [
  { match: /ipad\s*pro/, colors: ["Space Black", "Silver", "Space Grey"] },
  { match: /ipad\s*air/, colors: ["Space Grey", "Starlight", "Blue", "Purple", "Pink"] },
  { match: /ipad\s*mini/, colors: ["Space Grey", "Starlight", "Purple", "Pink", "Blue"] },
  { match: /ipad/, colors: ["Space Grey", "Silver", "Blue", "Pink", "Yellow"] },
];

const MAC: Entry[] = [
  { match: /macbook\s*air/, colors: ["Midnight", "Starlight", "Space Grey", "Silver", "Sky Blue"] },
  { match: /macbook\s*pro/, colors: ["Space Black", "Silver", "Space Grey"] },
  { match: /imac/, colors: ["Silver", "Blue", "Green", "Pink", "Orange", "Purple", "Yellow"] },
  { match: /mac\s*(mini|studio)/, colors: ["Silver"] },
];

const WATCH: Entry[] = [
  { match: /watch\s*ultra/, colors: ["Natural Titanium", "Black Titanium"] },
  { match: /apple\s*watch|watch\s*series/, colors: ["Midnight", "Starlight", "Silver", "Jet Black", "Rose Gold", "Product Red"] },
];

// Samsung
const GALAXY: Entry[] = [
  { match: /galaxy\s*s26\s*ultra/, colors: ["Titanium Black", "Titanium Silver", "Titanium Blue"] },
  { match: /galaxy\s*s26/, colors: ["Black", "White", "Blue", "Mint"] },
  { match: /galaxy\s*s25\s*ultra/, colors: ["Titanium Silverblue", "Titanium Black", "Titanium Gray", "Titanium Whitesilver"] },
  { match: /galaxy\s*s25\s*edge/, colors: ["Titanium Silver", "Titanium Jetblack", "Titanium Icyblue"] },
  { match: /galaxy\s*s25/, colors: ["Navy", "Icyblue", "Mint", "Silver Shadow"] },
  { match: /galaxy\s*s24\s*ultra/, colors: ["Titanium Black", "Titanium Gray", "Titanium Violet", "Titanium Yellow"] },
  { match: /galaxy\s*s24\s*fe/, colors: ["Blue", "Graphite", "Gray", "Mint", "Yellow"] },
  { match: /galaxy\s*s24/, colors: ["Onyx Black", "Marble Gray", "Cobalt Violet", "Amber Yellow"] },
  { match: /galaxy\s*s23\s*ultra/, colors: ["Phantom Black", "Cream", "Green", "Lavender"] },
  { match: /galaxy\s*s23/, colors: ["Phantom Black", "Cream", "Green", "Lavender"] },
  { match: /galaxy\s*s22\s*ultra/, colors: ["Phantom Black", "Phantom White", "Green", "Burgundy"] },
  { match: /galaxy\s*s22/, colors: ["Phantom Black", "Phantom White", "Green", "Pink Gold"] },
  { match: /galaxy\s*s21\s*ultra/, colors: ["Phantom Black", "Phantom Silver"] },
  { match: /galaxy\s*s21/, colors: ["Phantom Gray", "Phantom White", "Phantom Violet", "Phantom Pink"] },
  { match: /galaxy\s*s20\s*ultra/, colors: ["Cosmic Gray", "Cosmic Black"] },
  { match: /galaxy\s*s20\s*fe/, colors: ["Cloud Navy", "Cloud Lavender", "Cloud Mint", "Cloud White", "Cloud Red"] },
  { match: /galaxy\s*s20/, colors: ["Cosmic Gray", "Cloud Blue", "Cloud Pink", "Cloud White"] },
  { match: /galaxy\s*s10e/, colors: ["Prism Black", "Prism White", "Prism Blue", "Canary Yellow"] },
  { match: /galaxy\s*s10/, colors: ["Prism Black", "Prism White", "Prism Blue", "Prism Green"] },
  { match: /galaxy\s*z?\s*fold\s*7/, colors: ["Blue Shadow", "Silver Shadow", "Jetblack"] },
  { match: /galaxy\s*z?\s*fold\s*6/, colors: ["Silver Shadow", "Pink", "Navy"] },
  { match: /galaxy\s*z?\s*fold/, colors: ["Phantom Black", "Icy Blue", "Cream"] },
  { match: /galaxy\s*z?\s*flip\s*7/, colors: ["Blue Shadow", "Jetblack", "Coralred"] },
  { match: /galaxy\s*z?\s*flip\s*6/, colors: ["Silver Shadow", "Yellow", "Blue", "Mint"] },
  { match: /galaxy\s*z?\s*flip/, colors: ["Graphite", "Cream", "Lavender", "Mint"] },
  { match: /galaxy\s*a5\d/, colors: ["Awesome Navy", "Awesome Iceblue", "Awesome Lilac", "Awesome Lemon"] },
  { match: /galaxy\s*a3\d/, colors: ["Awesome Black", "Awesome White", "Awesome Lavender", "Awesome Iceblue"] },
  { match: /galaxy\s*a1\d/, colors: ["Black", "Light Blue", "Light Green", "Silver"] },
  { match: /galaxy\s*a/, colors: ["Black", "White", "Blue", "Violet"] },
  { match: /galaxy\s*note/, colors: ["Mystic Black", "Mystic Bronze", "Mystic White", "Aura Glow"] },
  { match: /galaxy\s*tab/, colors: ["Graphite", "Silver", "Beige", "Navy"] },
  { match: /galaxy\s*watch/, colors: ["Black", "Silver", "Cream", "Green"] },
];

// Google
const PIXEL: Entry[] = [
  { match: /pixel\s*10\s*pro/, colors: ["Obsidian", "Porcelain", "Moonstone", "Jade"] },
  { match: /pixel\s*10/, colors: ["Obsidian", "Frost", "Lemongrass", "Indigo"] },
  { match: /pixel\s*9a/, colors: ["Obsidian", "Porcelain", "Iris", "Peony"] },
  { match: /pixel\s*9\s*pro/, colors: ["Obsidian", "Porcelain", "Hazel", "Rose Quartz"] },
  { match: /pixel\s*9/, colors: ["Obsidian", "Porcelain", "Wintergreen", "Peony"] },
  { match: /pixel\s*8a/, colors: ["Obsidian", "Porcelain", "Bay", "Aloe"] },
  { match: /pixel\s*8\s*pro/, colors: ["Obsidian", "Porcelain", "Bay"] },
  { match: /pixel\s*8/, colors: ["Obsidian", "Hazel", "Rose"] },
  { match: /pixel\s*7a/, colors: ["Charcoal", "Snow", "Sea", "Coral"] },
  { match: /pixel\s*7\s*pro/, colors: ["Obsidian", "Snow", "Hazel"] },
  { match: /pixel\s*7/, colors: ["Obsidian", "Snow", "Lemongrass"] },
  { match: /pixel\s*6a/, colors: ["Charcoal", "Chalk", "Sage"] },
  { match: /pixel\s*6\s*pro/, colors: ["Stormy Black", "Cloudy White", "Sorta Sunny"] },
  { match: /pixel\s*6/, colors: ["Stormy Black", "Sorta Seafoam", "Kinda Coral"] },
  { match: /pixel\s*5/, colors: ["Just Black", "Sorta Sage"] },
  { match: /pixel\s*4a/, colors: ["Just Black", "Barely Blue"] },
  { match: /pixel\s*4/, colors: ["Just Black", "Clearly White", "Oh So Orange"] },
  { match: /pixel\s*3a/, colors: ["Just Black", "Clearly White", "Purple-ish"] },
  { match: /pixel\s*3/, colors: ["Just Black", "Clearly White", "Not Pink"] },
  { match: /pixel\s*2/, colors: ["Just Black", "Clearly White", "Kinda Blue"] },
  { match: /pixel/, colors: ["Quite Black", "Very Silver", "Really Blue"] },
];

const ALL: Entry[] = [...IPHONE, ...IPAD, ...MAC, ...WATCH, ...GALAXY, ...PIXEL];

/** For a model nothing above knows: short and neutral, never the twelve. */
export const FALLBACK_COLORS = ["Black", "White", "Silver", "Blue", "Green"];

export function colorsFor(deviceName: string | null | undefined): string[] {
  const n = (deviceName || "").toLowerCase();
  const hit = ALL.find((e) => e.match.test(n));
  const base = hit ? hit.colors : FALLBACK_COLORS;
  return [...base, OTHER];
}
