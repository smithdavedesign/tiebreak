// OpenNext's Cloudflare settings (used only by `npm run cf:build`; Vercel never reads this file).
// tiebreak has no ISR or revalidation: its prerendered pages (privacy, terms, the guides and tools) are
// served from the Worker's static assets, which needs no KV or R2 bucket and stays on the free plan.
import { defineCloudflareConfig } from '@opennextjs/cloudflare'
import staticAssets from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache'

// The static-assets cache is read-only and logs an error on every write Next attempts (one per request
// to a prerendered page). Nothing is lost by skipping them: the pages are rebuilt on every deploy.
const readOnlyAssetsCache: typeof staticAssets = Object.assign(Object.create(staticAssets), {
  async set() {},
  async delete() {},
})

export default defineCloudflareConfig({
  incrementalCache: readOnlyAssetsCache,
  enableCacheInterception: true,
})
