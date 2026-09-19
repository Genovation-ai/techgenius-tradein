import { useEffect, useMemo, useState } from "react";
import { newestFirst, orderBrands } from "../lib/deviceOrder";
import {
  brands as staticBrands,
  categories as staticCategories,
  filterDevices,
  type Brand,
  type DeviceCategory,
  type DeviceModel,
} from "../data/catalog";
import {
  brandNameFromId,
  checkApiHealth,
  fetchBrands,
  fetchDevices,
  mapApiDevice,
  type ApiBrand,
} from "../lib/tradeInApi";

export function useCatalog(category: DeviceCategory | null, brandFilter: Brand | "All", query: string) {
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [brands, setBrands] = useState<ApiBrand[]>([]);
  const [devices, setDevices] = useState<DeviceModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    checkApiHealth().then((ok) => {
      if (!cancelled) setApiOnline(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!category || apiOnline === false) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const brandRows = await fetchBrands(category);
        if (cancelled) return;
        setBrands(brandRows);

        const brandId =
          brandFilter === "All"
            ? null
            : brandRows.find((b) => b.name === brandFilter)?.id ?? null;

        const rows = await fetchDevices({
          categoryId: category,
          brandId,
          q: query.trim() || undefined,
        });
        if (cancelled) return;
        setDevices(rows.map((r) => mapApiDevice(r, brandRows)));
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load catalog");
          setApiOnline(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [category, brandFilter, query, apiOnline]);

  const fallbackDevices = useMemo(() => {
    if (!category) return [];
    return filterDevices({
      category,
      brand: brandFilter === "All" ? null : brandFilter,
      query,
    });
  }, [category, brandFilter, query]);

  const availableBrands = useMemo(() => {
    const names =
      apiOnline && brands.length
        ? brands.map((b) => b.name).filter(Boolean)
        : staticBrands.filter((b) => b !== "Other");
    return orderBrands(names);
  }, [apiOnline, brands]);

  // Newest at the top, whichever source the list came from. The API returns
  // rows in id order, which put an iPhone 11 above an iPhone 15.
  const orderedDevices = useMemo(
    () => newestFirst(apiOnline === false ? fallbackDevices : devices),
    [apiOnline, fallbackDevices, devices],
  );

  return {
    apiOnline,
    categories: staticCategories,
    brands: availableBrands,
    brandRows: brands,
    devices: orderedDevices,
    loading: apiOnline !== false && loading,
    error,
    brandNameFromId,
  };
}
