import { useCallback, useEffect, useRef, useState } from "react";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  applyStoreCreditBoost,
  isGradeLockedToDefective,
  valuationFromGrade,
  type Carrier,
  type ConditionGrade,
  type DeviceCategory,
  type DeviceModel,
  type Brand,
} from "../data/catalog";
import { useCatalog } from "../hooks/useCatalog";
import { useWidgetTemplate } from "../hooks/useWidgetTemplate";
import { pushTwentyOutbox, saveOffer, type SavedOffer } from "../lib/offers";
import { getSnapshotPricingMeta } from "../lib/pricingBackend";
import { assetUrl, deviceImageUrl, fetchQuote, recordLead, submitOffer, uploadOfferMedia } from "../lib/tradeInApi";
import { mapOfferToTwenty } from "../lib/twenty";
import { emitWidgetEvent } from "../lib/widgetEvents";
import { scrollFlowIntoView } from "../lib/flowScroll";
import {
  joinDetails,
  specLabel,
  emptyValuation,
  initialTradeInState,
  stepOrder,
  type AiScanResult,
  type MediaFile,
  type QuotedDevice,
  type TradeInState,
} from "../lib/tradeInTypes";
import { TradeInProgress } from "./TradeInProgress";
import { CategoryStep } from "./CategoryStep";
import { DevicePickStep } from "./DevicePickStep";
import { DetailsStep } from "./DetailsStep";
import { MediaAiStep } from "./MediaAiStep";
import { GradeStep } from "./GradeStep";
import { OfferStep } from "./OfferStep";
import { CheckoutStep } from "./CheckoutStep";
import { DoneStep } from "./DoneStep";
import { deviceImage } from "../data/deviceImages";
import "./TradeInFlow.css";
// Template skins keyed on data-template — imported here so both the app entry
// and the Shopify/Framer embed bundle always ship them with the widget.
import "../templates.css";

/** The conditions offered, in the order the card list shows them. */
const ALL_GRADES: ConditionGrade[] = ["flawless", "good", "average", "fair", "defective"];




function resolveStickyImage(device: DeviceModel & { imageUrl?: string | null }) {
  return deviceImageUrl(device) || assetUrl(deviceImage(device.id, device));
}

function resetDeviceFields(prev: TradeInState): TradeInState {
  prev.media.forEach((m) => URL.revokeObjectURL(m.previewUrl));
  return {
    ...prev,
    step: "category",
    category: null,
    brand: null,
    brandFilter: "All",
    device: null,
    storage: null,
    memory: null,
    carrier: null,
    color: null,
    owned: false,
    modelQuery: "",
    valuation: emptyValuation,
    media: [],
    mediaSkipped: false,
    aiResult: null,
    grade: null,
    offer: null,
  };
}

/** Embeddable trade-in — connected to Tech Genius backend */
export function TradeInFlow() {
  const reduceMotion = useReducedMotion();
  const [state, setState] = useState<TradeInState>(initialTradeInState);
  /* Whether the brand filter is still the one we picked, rather than one the
     customer chose. Lets the first brand become the opening view once brands
     have loaded, without ever overriding a tap. */
  const brandAuto = useRef(true);
  const [quotedPrice, setQuotedPrice] = useState<number | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  // The server decides whether a promo code counts; the widget only reports it.
  const [promoApplied, setPromoApplied] = useState(false);

  const catalog = useCatalog(state.category, state.brandFilter, state.modelQuery);

  /* Open on one brand rather than on everything. "All brands" listed a
     Motorola beside a Galaxy beside an iPhone with nothing in common, and a
     customer's own phone was somewhere in the hundred and forty. The brands
     arrive ordered with Apple first, so the opening view is Apple's models,
     newest at the top — the screen most people are looking for. A customer
     who taps a different brand, or "All brands", is never overridden. */
  useEffect(() => {
    if (state.step !== "device" || !brandAuto.current) return;
    if (state.brandFilter !== "All" || catalog.brands.length === 0) return;
    brandAuto.current = false;
    setState((s) => ({ ...s, brandFilter: catalog.brands[0] as Brand }));
  }, [state.step, state.brandFilter, catalog.brands]);
  const template = useWidgetTemplate();

  // One "started" event per mount, so the host page can measure how many people
  // who saw /sell actually engaged with the widget.
  useEffect(() => {
    emitWidgetEvent("techgenius:flow_started");
  }, []);

  /**
   * Put the customer at the top of each new step.
   *
   * Every step renders into the same scroll container, and the browser keeps
   * the scroll offset across the swap. The model list is long — 23,000px on a
   * phone — so someone who scrolled down to find their device and tapped it
   * landed near the bottom of the much shorter step that replaced it, looking
   * at the continue button with the specifications off-screen above. Testers
   * read that as the page jumping to the bottom.
   *
   * Scrolls the widget's own top into view rather than the window's, because
   * the widget is embedded in the shop's page and the header above it is theirs,
   * not ours. Skipped on first mount so landing on /sell does not yank the host
   * page down to the widget.
   */
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    scrollFlowIntoView(rootRef.current);
  }, [state.step]);

  const patch = (p: Partial<TradeInState>) => setState((s) => ({ ...s, ...p }));

  const goBack = () => {
    const idx = stepOrder.indexOf(state.step);
    if (idx <= 0) return;
    patch({ step: stepOrder[idx - 1] });
  };

  // Only ever show the customer the server's number.
  //
  // localOfferValue is a client-side estimate built from
  // fallbackSourcePointsForQuote, which invents "market points" by multiplying
  // the base price and stamps them capturedAt: now — real-looking data that no
  // competitor ever quoted. Falling back to it meant a failed API call quietly
  // produced an invented cash offer. If the server cannot price it, we say so.
  const offerValue = quotedPrice;

  const refreshQuote = useCallback(async () => {
    if (!state.device || !state.storage || !state.grade) {
      setQuotedPrice(null);
      return;
    }
    if (catalog.apiOnline === false) {
      setQuotedPrice(null);
      return;
    }
    setQuoteLoading(true);
    try {
      const res = await fetchQuote({
        device_id: state.device.id,
        storage: state.storage,
        memory: state.memory,
        condition_grade: state.grade,
        carrier: state.carrier,
        battery_health: state.valuation.batteryHealth,
        promo_code: state.contact.promoCode,
      });
      setQuotedPrice(res.quoted_price);
      setPromoApplied(Boolean(res.promo_applied));
      emitWidgetEvent("techgenius:offer_shown", {
        deviceId: state.device.id,
        deviceName: state.device.name,
        storage: state.storage,
        grade: state.grade,
        value: res.quoted_price,
      });
    } catch {
      setQuotedPrice(null);
      setPromoApplied(false);
      emitWidgetEvent("techgenius:quote_failed", {
        deviceId: state.device?.id,
        deviceName: state.device?.name,
      });
    } finally {
      setQuoteLoading(false);
    }
  }, [
    state.device,
    state.storage,
    // Without this the offer would not refresh when a laptop's memory tier
    // changes, leaving the customer looking at the price for a different config.
    state.memory,
    state.grade,
    state.carrier,
    state.valuation.batteryHealth,
    state.contact.promoCode,
    catalog.apiOnline,
  ]);

  useEffect(() => {
    if (state.step === "offer" || state.step === "grade") {
      void refreshQuote();
    }
  }, [state.step, refreshQuote]);

  /**
   * A price against every condition, before one is chosen.
   *
   * The condition step asked the customer to commit to a description of their
   * device and then click through to find out what it was worth — so deciding
   * between "good" and "average" meant picking one, reading the number, going
   * back, and picking the other. GoRecell puts the figures beside the choices,
   * and the shop asked for the same, because the number is what people are
   * choosing on.
   *
   * These are the server's own quotes, one request per grade, not the
   * catalogue's price matrix interpolated locally. The rule that the customer
   * only ever sees a number the server produced is what keeps the price on the
   * condition card and the price on the offer step the same number.
   */
  const [gradePrices, setGradePrices] = useState<Partial<Record<ConditionGrade, number | null>>>({});
  const [gradePricesLoading, setGradePricesLoading] = useState(false);

  const quoteKey = [
    state.device?.id,
    state.storage,
    state.memory,
    state.carrier,
    state.valuation.batteryHealth,
    state.contact.promoCode,
  ].join("|");

  useEffect(() => {
    if (state.step !== "grade" || !state.device || !state.storage || catalog.apiOnline === false) return;
    let cancelled = false;
    const device = state.device;
    const storage = state.storage;
    setGradePricesLoading(true);
    void (async () => {
      const results = await Promise.all(
        ALL_GRADES.map(async (g) => {
          try {
            const res = await fetchQuote({
              device_id: device.id,
              storage,
              memory: state.memory,
              condition_grade: g,
              carrier: state.carrier,
              battery_health: state.valuation.batteryHealth,
              promo_code: state.contact.promoCode,
            });
            return [g, res.quoted_price] as const;
          } catch {
            // One grade failing is not a reason to hide the other four; that
            // card simply shows no number.
            return [g, null] as const;
          }
        }),
      );
      if (cancelled) return;
      setGradePrices(Object.fromEntries(results) as Partial<Record<ConditionGrade, number | null>>);
      setGradePricesLoading(false);
    })();
    return () => {
      cancelled = true;
      setGradePricesLoading(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step, quoteKey, catalog.apiOnline]);

  const cartDisplayTotal = state.cart.reduce((s, d) => s + d.offer, 0);

  // Record the shopper as a follow-up lead once we have a priced device and a
  // way to contact them. Debounced because it fires on every keystroke in the
  // checkout fields, and it upserts server-side so this stays one lead.
  useEffect(() => {
    const { email, phone, firstName, lastName, method, payout } = state.contact;
    if (!email && !phone) return;
    const devices = state.cart.length
      ? state.cart
      : state.device && offerValue !== null && state.grade
        ? [{ deviceId: state.device.id, deviceName: state.device.name, storage: state.storage ?? "", grade: state.grade, offer: offerValue }]
        : [];
    if (!devices.length) return;

    const timer = window.setTimeout(() => {
      void recordLead({
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        offer_type: method,
        payout_method: payout,
        furthest_step: state.step,
        quoted_total: devices.reduce((s, d) => s + (d.offer ?? 0), 0),
        items: devices.map((d) => ({
          device_id: d.deviceId,
          device_name: d.deviceName,
          storage: d.storage,
          condition_grade: d.grade,
          quoted_price: d.offer,
        })),
      });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [
    state.contact,
    state.cart,
    state.device,
    state.storage,
    state.grade,
    state.step,
    offerValue,
  ]);

  const buildQuoted = (offer: number): QuotedDevice => ({
    id: crypto.randomUUID(),
    deviceId: state.device!.id,
    category: state.category!,
    brand: state.device!.brand,
    deviceName: state.device!.name,
    storage: state.storage!,
    memory: state.memory,
    carrier: state.carrier!,
    color: state.color,
    grade: state.grade!,
    offer,
    batteryHealth: state.valuation.batteryHealth,
  });

  const completeAi = (aiResult: AiScanResult) => {
    const locked = isGradeLockedToDefective(state.valuation);
    const grade = locked ? "defective" : aiResult.suggestedGrade;
    patch({
      aiResult: locked ? { ...aiResult, suggestedGrade: "defective" } : aiResult,
      grade,
      step: "grade",
    });
  };

  const goToOffer = async () => {
    if (!state.device || !state.storage || !state.grade) return;
    await refreshQuote();
    patch({ offer: offerValue, step: "offer" });
  };

  /**
   * Bank this device and pick another for the SAME offer.
   *
   * The backend has always accepted up to 50 items, `cart` is an array and
   * CheckoutStep already had copy for "3 devices · $X total" — but nothing in
   * the UI could ever add a second device, so that copy was unreachable and a
   * customer with three phones had to submit three separate offers. GoRecell
   * puts this next to the offer for the same reason.
   */
  const acceptAndAddAnother = () => {
    if (offerValue === null || !state.device) return;
    const quoted = buildQuoted(offerValue);
    emitWidgetEvent("techgenius:device_added", {
      deviceId: quoted.deviceId,
      deviceName: quoted.deviceName,
      value: offerValue,
      itemCount: state.cart.length + 1,
    });
    setQuotedPrice(null);
    setPromoApplied(false);
    setState((s) => resetDeviceFields({ ...s, cart: [...s.cart, quoted] }));
  };

  const acceptOffer = () => {
    if (offerValue === null || !state.device) return;
    const quoted = buildQuoted(offerValue);
    emitWidgetEvent("techgenius:offer_accepted", {
      deviceId: quoted.deviceId,
      deviceName: quoted.deviceName,
      value: offerValue,
      itemCount: state.cart.length + 1,
    });
    patch({ cart: [...state.cart, quoted], offer: offerValue, step: "checkout" });
  };

  const cartBaseTotal = state.cart.reduce((s, d) => s + d.offer, 0);
  const checkoutTotal = applyStoreCreditBoost(cartBaseTotal, state.contact.payout);

  const submitCheckout = async () => {
    if (!state.device || !state.grade || offerValue === null) return;
    if (!state.cart.length) return;

    const meta = getSnapshotPricingMeta({ modelId: state.device.id, grade: state.grade });
    const contact = {
      first_name: state.contact.firstName,
      last_name: state.contact.lastName,
      email: state.contact.email,
      phone: state.contact.phone,
    };

    if (catalog.apiOnline === false) {
      window.alert("Trade-in service is offline. Please try again in a moment — we cannot save offers without the server.");
      return;
    }

    let id: string;
    try {
      const res = await submitOffer({
        contact,
        offer_type: state.contact.method,
        payout_method: state.contact.payout,
        promo_code: state.contact.promoCode || undefined,
        ai_scan: state.aiResult
          ? {
              suggested_grade: state.aiResult.suggestedGrade,
              confirmed_grade: state.grade,
              screen_score: state.aiResult.screenScore,
              body_score: state.aiResult.bodyScore,
              confidence: state.aiResult.confidence,
              issues: state.aiResult.issues || [],
              angles_covered: state.aiResult.anglesCovered || [],
              notes: state.aiResult.notes.slice(0, 20),
              vision: state.aiResult.vision
                ? {
                    method: state.aiResult.vision.method,
                    frames: state.aiResult.vision.framesAnalyzed,
                    crack_density: state.aiResult.vision.crackDensity,
                    scratch_index: state.aiResult.vision.scratchIndex,
                  }
                : null,
            }
          : undefined,
        items: state.cart.map((d) => ({
          device_id: d.deviceId,
          device_name: d.deviceName,
          storage: d.storage,
          memory: d.memory ?? null,
          carrier: d.carrier,
          color: d.color ?? null,
          condition_grade: d.grade,
          quoted_price: d.offer,
          battery_health: d.batteryHealth,
        })),
      });
      id = res.id;

      // Persist angle photos as intake evidence (best-effort)
      const evidence = state.media.filter((m) => m.file && m.kind === "image").slice(0, 6);
      if (evidence.length) {
        try {
          const files = await Promise.all(
            evidence.map(async (m) => {
              const buf = await m.file!.arrayBuffer();
              const bytes = new Uint8Array(buf);
              let binary = "";
              for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
              return {
                filename: m.name || `${m.angle || "photo"}.jpg`,
                mime_type: m.file!.type || "image/jpeg",
                content_base64: btoa(binary),
                angle: m.angle,
              };
            }),
          );
          await uploadOfferMedia(id, files);
        } catch {
          // Offer is saved; photos can be re-captured at the counter
        }
      }
    } catch (e) {
      window.alert(
        e instanceof Error
          ? e.message
          : "Could not save your offer. Please check your connection and try again.",
      );
      return;
    }

    const offerRecord: SavedOffer = {
      id,
      createdAt: new Date().toISOString(),
      status: "reserved",
      devices: state.cart,
      total: checkoutTotal,
      contact: {
        firstName: state.contact.firstName,
        lastName: state.contact.lastName,
        email: state.contact.email,
        phone: state.contact.phone,
        payout: state.contact.payout,
        method: state.contact.method,
        storeId: state.contact.storeId,
      },
      pricing: {
        sourceCount: meta.sourceCount,
        sourceVersion: meta.sourceVersion,
      },
    };
    saveOffer(offerRecord);
    pushTwentyOutbox(mapOfferToTwenty(offerRecord));
    emitWidgetEvent("techgenius:offer_submitted", {
      offerId: id,
      value: checkoutTotal,
      itemCount: state.cart.length,
    });
    patch({ offerId: id, step: "done" });
  };

  const addAnother = () => {
    setQuotedPrice(null);
    setState((s) => resetDeviceFields({ ...s, offerId: null }));
  };

  const restart = () => {
    state.media.forEach((m) => URL.revokeObjectURL(m.previewUrl));
    setQuotedPrice(null);
    setState(initialTradeInState);
  };

  const showSticky =
    state.device &&
    state.step !== "category" &&
    state.step !== "device" &&
    state.step !== "done";

  return (
    <div className="trade-in-embed" data-tech-genius-trade-in data-template={template} ref={rootRef}>
      <TradeInProgress
        step={state.step}
        onBack={state.step !== "category" && state.step !== "done" ? goBack : undefined}
      />

      {state.cart.length > 0 && state.step !== "done" ? (
        <p className="cart-chip">
          Cart: {state.cart.length} device{state.cart.length === 1 ? "" : "s"} · $
          {cartDisplayTotal.toLocaleString()} CAD
        </p>
      ) : null}

      {showSticky && state.device ? (
        <div className="sticky-device">
          {resolveStickyImage(state.device as DeviceModel & { imageUrl?: string | null }) ? (
            <img
              src={resolveStickyImage(state.device as DeviceModel & { imageUrl?: string | null })}
              alt=""
              width={44}
              height={52}
            />
          ) : (
            <span className="sticky-device-fallback" aria-hidden="true">
              {state.device.name.slice(0, 1)}
            </span>
          )}
          <div>
            <strong>{state.device.name}</strong>
            <span>
              {joinDetails(
                specLabel(state.storage ?? "", state.device.category),
                state.memory ? specLabel(state.memory, state.device.category) : "",
              ) || (state.storage ? "" : "Storage TBD")}
              {state.carrier ? ` · ${state.carrier}` : ""}
            </span>
          </div>
        </div>
      ) : null}

      {/* Steps cross-fade instead of snapping. mode="wait" lets the outgoing
          step finish before the next mounts, so the panel never shows two
          headings at once, and the key is the step id so React treats each as
          a fresh element. Reduced motion gets the swap with no movement. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={state.step}
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
      {state.step === "category" && (
        <CategoryStep
          onSelect={(category: DeviceCategory) => {
            brandAuto.current = true;
            patch({
              category,
              brand: null,
              brandFilter: "All",
              device: null,
              modelQuery: "",
              step: "device",
            });
          }}
        />
      )}

      {state.step === "device" && state.category && (
        <DevicePickStep
          category={state.category}
          brandFilter={state.brandFilter}
          query={state.modelQuery}
          devices={catalog.devices}
          brands={catalog.brands}
          loading={catalog.loading}
          error={catalog.error}
          apiOnline={catalog.apiOnline}
          onBrandFilter={(brandFilter) => {
            // A tap is a choice; from here on the filter is the customer's.
            brandAuto.current = false;
            patch({ brandFilter });
          }}
          onQuery={(modelQuery) => patch({ modelQuery })}
          onSelect={(device: DeviceModel) => {
            emitWidgetEvent("techgenius:device_selected", {
              deviceId: device.id,
              deviceName: device.name,
            });
            patch({
              device,
              brand: device.brand,
              storage: null,
              memory: null,
              carrier: null,
              color: null,
              owned: false,
              step: "details",
            });
          }}
        />
      )}

      {state.step === "details" && state.device && (
        <DetailsStep
          device={state.device}
          storage={state.storage}
          memory={state.memory}
          onMemory={(memory: string) => patch({ memory })}
          carrier={state.carrier}
          color={state.color}
          onStorage={(storage) => patch({ storage })}
          onCarrier={(carrier: Carrier) => patch({ carrier })}
          onColor={(color) => patch({ color })}
          onContinue={() => patch({ step: "media-ai" })}
        />
      )}

      {state.step === "media-ai" && (
        <MediaAiStep
          valuation={state.valuation}
          media={state.media}
          onMediaChange={(media: MediaFile[]) => patch({ media, mediaSkipped: false })}
          onSkip={() => {
            state.media.forEach((m) => URL.revokeObjectURL(m.previewUrl));
            patch({ media: [], mediaSkipped: true });
          }}
          onComplete={completeAi}
        />
      )}

      {state.step === "grade" && (
        <GradeStep
          aiResult={state.aiResult}
          grade={state.grade}
          valuation={state.valuation}
          owned={state.owned}
          prices={gradePrices}
          pricesLoading={gradePricesLoading}
          onOwned={(owned) =>
            patch({
              owned,
              valuation: state.grade
                ? valuationFromGrade(state.grade, owned)
                : {
                    ...state.valuation,
                    cleanImei: owned ? true : null,
                    activationLockFree: owned ? true : null,
                  },
            })
          }
          onSelect={(grade: ConditionGrade) =>
            // The condition cards are the only place condition is stated now, so
            // the answers the rest of the system reads are derived from the card.
            patch({ grade, valuation: valuationFromGrade(grade, state.owned) })
          }
          onContinue={() => void goToOffer()}
        />
      )}

      {state.step === "offer" && offerValue === null && !quoteLoading ? (
        <section className="flow-panel">
          <header className="flow-header">
            <h1>We couldn&rsquo;t price this one right now</h1>
            <p className="flow-lead">
              Your offer is calculated on our server, so we won&rsquo;t show you a number we
              can&rsquo;t honour. This is usually a brief connection problem.
            </p>
          </header>
          <button type="button" className="btn btn-primary flow-cta" onClick={() => void refreshQuote()}>
            Try again
          </button>
          <p className="field-hint">
            Still not working? Call us on {"+1 (289) 455-5556"} and we&rsquo;ll quote it by hand.
          </p>
        </section>
      ) : null}

      {state.step === "offer" &&
        state.device &&
        state.storage &&
        state.grade &&
        offerValue !== null && (
          <OfferStep
            device={state.device}
            storage={state.storage}
            memory={state.memory}
            grade={state.grade}
            offer={offerValue}
            batteryHealth={state.valuation.batteryHealth}
            promoCode={state.contact.promoCode}
            promoApplied={promoApplied}
            quoteLoading={quoteLoading}
            onPromo={(promoCode) =>
              patch({ contact: { ...state.contact, promoCode } })
            }
            onContinue={acceptOffer}
            onAddAnother={acceptAndAddAnother}
          />
        )}

      {state.step === "offer" && quoteLoading ? (
        <p className="field-hint">Calculating Tech Genius offer…</p>
      ) : null}

      {state.step === "checkout" && (
        <CheckoutStep
          contact={state.contact}
          cartCount={state.cart.length}
          cartTotal={checkoutTotal}
          onChange={(c) => {
            const next = { ...state.contact, ...c };
            if (next.method === "mail-in" && next.payout === "cash") {
              next.payout = "etransfer";
            }
            patch({ contact: next });
          }}
          onSubmit={() => void submitCheckout()}
        />
      )}

      {state.step === "done" && state.offerId && (
        <DoneStep
          offerId={state.offerId}
          devices={state.cart}
          total={checkoutTotal}
          method={state.contact.method}
          onAddAnother={addAnother}
          onRestart={restart}
        />
      )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
