import { categories, type DeviceCategory } from "../data/catalog";
import { categoryImages } from "../data/deviceImages";
import { assetUrl } from "../lib/tradeInApi";
import "./ChoiceGrid.css";

interface Props {
  onSelect: (category: DeviceCategory) => void;
}

export function CategoryStep({ onSelect }: Props) {
  return (
    <section className="flow-panel">
      <header className="flow-header">
        {/* The heading is the whole instruction. The sentence under it
            restated the heading and cost a line above the fold. */}
        <h1>What are you selling?</h1>
      </header>
      <div className="device-grid device-grid--cats">
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className="device-card"
            onClick={() => onSelect(c.id)}
          >
            <span className="device-card-media">
              <img
                src={assetUrl(categoryImages[c.id])}
                alt=""
                width={160}
                height={192}
                decoding="async"
                ref={(el) => {
                  // Cached images never fire onLoad; without this they would
                  // stay at the fade's starting opacity of zero.
                  if (el?.complete) el.classList.add("is-loaded");
                }}
                onLoad={(e) => e.currentTarget.classList.add("is-loaded")}
              />
            </span>
            <span className="device-card-name">{c.label}</span>
            <span className="device-card-price">{c.blurb}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
