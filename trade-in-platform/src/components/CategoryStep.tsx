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
        <p className="flow-kicker">Category</p>
        <h1>What are you selling?</h1>
        <p className="flow-lead">
          Choose a category to see matching devices we buy.
        </p>
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
              <img src={assetUrl(categoryImages[c.id])} alt="" width={160} height={192} decoding="async" />
            </span>
            <span className="device-card-name">{c.label}</span>
            <span className="device-card-price">{c.blurb}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
