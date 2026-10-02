/**
 * Which repairs a given device can actually have.
 *
 * Every device was offered the same twelve problems. A customer bringing in a
 * PlayStation 5 was asked whether its screen was cracked, whether its battery
 * drained fast, and whether its rear camera worked — a PS5 has none of those.
 * The quote endpoint accepted the answer and replied that the shop would price
 * it by hand, so the shop received enquiries about repairs that cannot exist.
 *
 * It also made the coverage figures lie. Consoles showed 9% screen-price
 * coverage, which read as missing data and was really a question that should
 * never have been asked: three of the thirty-one consoles in the catalogue
 * have a screen at all.
 *
 * The lists below say what each kind of device physically has. They are
 * deliberately generous — a repair that is merely rare still belongs, because
 * refusing a real repair costs a customer, while offering an impossible one
 * only costs a confusing minute. They exclude only what cannot be there.
 */

export type ProblemId =
  | "screen"
  | "battery"
  | "charging_port"
  | "back_glass"
  | "rear_camera"
  | "front_camera"
  | "speaker"
  | "microphone"
  | "buttons"
  | "water_damage"
  | "software"
  | "other";

/** Always offered: nothing about a device rules these out. */
const UNIVERSAL: ProblemId[] = ["water_damage", "software", "other"];

const BY_CATEGORY: Record<string, ProblemId[]> = {
  smartphone: [
    "screen", "battery", "charging_port", "back_glass", "rear_camera",
    "front_camera", "speaker", "microphone", "buttons", ...UNIVERSAL,
  ],
  tablet: [
    "screen", "battery", "charging_port", "back_glass", "rear_camera",
    "front_camera", "speaker", "microphone", "buttons", ...UNIVERSAL,
  ],
  // No back glass and no rear camera; the webcam above the screen is the
  // front camera, and a keyboard failure is reported as buttons.
  laptop: [
    "screen", "battery", "charging_port", "front_camera",
    "speaker", "microphone", "buttons", ...UNIVERSAL,
  ],
  // A watch has a back — the sensor glass — and a speaker and microphone,
  // but no camera on any model this shop buys.
  smartwatch: [
    "screen", "battery", "charging_port", "back_glass",
    "speaker", "microphone", "buttons", ...UNIVERSAL,
  ],
  // Headsets have inside-out tracking cameras, but a customer reporting one
  // is reporting tracking, which is software or "other" here.
  vr: [
    "screen", "battery", "charging_port",
    "speaker", "microphone", "buttons", ...UNIVERSAL,
  ],
  // Desktops and Mac minis: mains powered, no screen, no battery, no camera.
  computer: ["charging_port", "speaker", "buttons", ...UNIVERSAL],
  // A display has a panel, its buttons and often speakers. Nothing else.
  monitor: ["screen", "speaker", "buttons", ...UNIVERSAL],
};

/** Home consoles: mains powered, nothing to look at and nothing to hold. */
const CONSOLE_HOME: ProblemId[] = ["charging_port", "speaker", "buttons", ...UNIVERSAL];

/** Handhelds are small computers with a screen and a battery. */
const CONSOLE_HANDHELD: ProblemId[] = [
  "screen", "battery", "charging_port",
  "speaker", "microphone", "buttons", ...UNIVERSAL,
];

/*
 * "gaming-console" holds both a PlayStation and a Steam Deck, and they have
 * almost nothing in common physically. Category alone cannot separate them,
 * so the handhelds are named. The list is short and stable — a handheld that
 * is missing here is offered the home-console set, which is a narrower
 * question than the one being asked today, not a wider one.
 */
const HANDHELD_PATTERNS = [
  "steam-deck", "switch", "3ds", "nintendo-ds", "dsi", "psp", "ps-vita", "vita",
  "legion-go", "rog-ally", "ally", "claw", "playdate", "game-boy", "gameboy",
  "odin", "retroid", "analogue-pocket", "ayaneo", "gpd-win",
];

function isHandheld(deviceId: string, deviceName?: string): boolean {
  const hay = `${deviceId} ${deviceName ?? ""}`.toLowerCase();
  return HANDHELD_PATTERNS.some((p) => hay.includes(p));
}

/**
 * The problems that can apply to one device. An unknown category gets every
 * problem, because guessing narrower would hide a repair the shop can do.
 */
export function applicableProblems(
  categoryId: string | null | undefined,
  deviceId: string,
  deviceName?: string,
): Set<ProblemId> {
  const cat = String(categoryId ?? "").trim();
  if (cat === "gaming-console") {
    return new Set(isHandheld(deviceId, deviceName) ? CONSOLE_HANDHELD : CONSOLE_HOME);
  }
  const list = BY_CATEGORY[cat];
  if (!list) {
    return new Set([
      "screen", "battery", "charging_port", "back_glass", "rear_camera",
      "front_camera", "speaker", "microphone", "buttons", ...UNIVERSAL,
    ] as ProblemId[]);
  }
  return new Set(list);
}

/** Whether one problem can apply to one device. */
export function problemApplies(
  categoryId: string | null | undefined,
  deviceId: string,
  deviceName: string | undefined,
  problem: string,
): boolean {
  return applicableProblems(categoryId, deviceId, deviceName).has(problem as ProblemId);
}
