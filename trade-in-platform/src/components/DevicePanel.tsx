import type { ConditionGrade, DeviceModel } from "../data/catalog";
import { gradeLabels } from "../data/catalog";
import { specLabel } from "../lib/tradeInTypes";
import "./DevicePanel.css";

/**
 * What the customer has chosen so far, kept in view while they answer the
 * rest.
 *
 * Everything after picking a model is a question about a device the customer
 * can no longer see — storage, carrier, condition — and the only reminder was
 * a 44px thumbnail in a strip above the question. The shop compared that with
 * a storefront that keeps the handset large and beside the form the whole way
 * through, and asked for the same.
 *
 * The line under the name grows as answers come in — "iPhone 15 Pro", then
 * "· 256GB", then "· Good" — so the panel is also the record of what has been
 * said, which is what makes it safe for the questions themselves to be asked
 * one at a time and then disappear.
 */

interface Props {
  device: DeviceModel;
  imageSrc: string | null;
  storage?: string | null;
  memory?: string | null;
  carrier?: string | null;
  color?: string | null;
  grade?: ConditionGrade | null;
  /** Shown only once a condition is chosen — the price for THAT condition. */
  price?: number | null;
  priceLoading?: boolean;
}

export function DevicePanel({
  device,
  imageSrc,
  storage,
  memory,
  carrier,
  color,
  grade,
  price,
  priceLoading,
}: Props) {
  const parts = [
    storage ? specLabel(storage, device.category) : null,
    memory ? specLabel(memory, device.category) : null,
    carrier || null,
    color || null,
    grade ? gradeLabels[grade] : null,
  ].filter(Boolean) as string[];

  return (
    <aside className="device-panel" aria-label="Your device so far">
      <div className="device-panel-card">
        <p className="device-panel-name">{device.name}</p>
        {parts.length ? <p className="device-panel-spec">{parts.join(" · ")}</p> : null}

        <div className="device-panel-media">
          {imageSrc ? (
            <img src={imageSrc} alt="" width={180} height={240} decoding="async" />
          ) : (
            <span className="device-panel-fallback" aria-hidden="true">
              {device.name.slice(0, 1)}
            </span>
          )}
        </div>

        {/* A price only exists once a condition does: what a device is worth
            is a statement about its condition, and showing one before that is
            answered would be answering it for them. */}
        {grade ? (
          <div className="device-panel-payout">
            <p className="device-panel-payout-label">You&rsquo;ll get paid</p>
            {priceLoading && price == null ? (
              <p className="device-panel-payout-wait">working it out…</p>
            ) : price != null ? (
              <p className="device-panel-payout-value">${price.toLocaleString()}</p>
            ) : (
              <p className="device-panel-payout-wait">we&rsquo;ll confirm this one by hand</p>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
