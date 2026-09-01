/**
 * CLI: bootstrap a catalog device from a product name.
 *   npx tsx scripts/ensure_device_from_name.ts "iPhone 17 Pro Max"
 */
import { ensureDeviceFromName } from "../src/services/deviceBootstrap.js";

const name = process.argv.slice(2).join(" ").trim();
if (!name) {
  console.error('Usage: npx tsx scripts/ensure_device_from_name.ts "iPhone 17 Pro Max"');
  process.exit(1);
}

const result = await ensureDeviceFromName({ name, rebuildImage: true, seedPrices: true });
console.log(JSON.stringify(result, null, 2));
process.exit(result.device?.id ? 0 : 1);
