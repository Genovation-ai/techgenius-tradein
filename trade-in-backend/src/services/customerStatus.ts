/**
 * What a customer is told about where their trade-in has got to.
 *
 * The workflow_stages table holds the labels the shop uses at the counter —
 * "Active Leads", "General Hold", "Payout Processing". Those are the right
 * words for the staff running the board and the wrong ones for the person
 * waiting on their money: the public tracker was handing back the raw database
 * value ("active_lead") and the email portal was handing back the CRM label,
 * so a customer checking on their phone was told they were a lead.
 *
 * Each stage therefore gets a second, customer-facing pair: what has happened,
 * and what happens next. The second half is the one that stops the phone call —
 * "arrived at the shop" without "we check it today" just moves the question.
 */

export interface CustomerStatus {
  /** Shown as the headline state. */
  label: string;
  /** One sentence on what happens next, in the shop's voice. */
  note: string;
}

/** The ordinary path a trade-in walks, in order, for the progress display. */
export const CUSTOMER_JOURNEY = [
  "active_lead",
  "in_transit",
  "delivered",
  "being_inspected",
  "payout_processing",
  "completed",
] as const;

const STATUSES: Record<string, CustomerStatus> = {
  active_lead: {
    label: "Offer accepted",
    note: "Send your device in or drop it by the shop. We'll let you know the moment it lands.",
  },
  in_transit: {
    label: "On its way to us",
    note: "We'll confirm as soon as it arrives.",
  },
  delivered: {
    label: "Arrived at the shop",
    note: "It's in the queue to be checked — usually the same day.",
  },
  being_inspected: {
    label: "Being checked",
    note: "We're confirming the condition you described. If it all matches, payment follows straight after.",
  },
  general_hold: {
    label: "On hold",
    note: "We need something from you before we can carry on — we'll be in touch, or call the shop and quote your Offer ID.",
  },
  payout_processing: {
    label: "Payment on the way",
    note: "Your payout is approved and being sent.",
  },
  revised_offer: {
    label: "New price to review",
    note: "The device differed from the description, so there's a revised offer waiting for you to accept or decline. Nothing happens until you decide.",
  },
  completed: {
    label: "Paid",
    note: "This one's done. Thanks for trading with us.",
  },
  returned: {
    label: "Returned to you",
    note: "The device is on its way back. Nothing is owed either way.",
  },
};

/**
 * Never throws and never returns the raw id. An unknown status — a stage the
 * shop added itself — degrades to a neutral, true sentence rather than leaking
 * a database value onto a customer's screen.
 */
export function customerStatus(status: string): CustomerStatus {
  return (
    STATUSES[status] ?? {
      label: "In progress",
      note: "Your trade-in is being worked on. Call the shop with your Offer ID if you need a detail.",
    }
  );
}

/**
 * Position on the ordinary path, or null for the exception states — a held,
 * revised or returned offer is not "40% of the way through" and showing it as
 * such would be a lie in a progress bar.
 */
export function journeyIndex(status: string): number | null {
  const i = (CUSTOMER_JOURNEY as readonly string[]).indexOf(status);
  return i === -1 ? null : i;
}
