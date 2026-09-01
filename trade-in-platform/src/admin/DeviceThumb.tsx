import { useEffect, useState } from "react";
import { deviceImgSrc } from "./api";

interface Props {
  imageUrl?: string | null;
  deviceId?: string | null;
  name?: string | null;
  className?: string;
}

/**
 * Device thumbnail with an honest fallback.
 *
 * When a device's photo is missing we show its initial, not another handset.
 * Admin used to fall back to `iphone-15.png` for everything, which made a
 * broken Pixel look like an iPhone in the catalog and on offer detail — the
 * same class of bug as the shared-image mis-mapping in the catalog itself.
 */
export function DeviceThumb({ imageUrl, deviceId, name, className }: Props) {
  const src = deviceImgSrc(imageUrl, deviceId);
  const [failed, setFailed] = useState(false);

  // A different device may render into this slot (list virtualisation, or the
  // selected-device panel switching rows), so clear the failure with the src.
  useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    return (
      <span className={`admin-device-thumb-fallback${className ? ` ${className}` : ""}`} aria-hidden="true">
        {(name || deviceId || "?").trim().slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      className={className}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
