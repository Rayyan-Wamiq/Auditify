/**
 * Next.js configuration.
 *
 * The FastAPI backend has been ported into App Router route handlers under
 * `app/api/**`, so `/api/*` is served by this app by default (no rewrite, no
 * second deployment, nothing to pay for beyond the Next.js hosting itself).
 *
 * Setting `NEXT_PUBLIC_API_BASE_URL` re-enables proxying to an external API -
 * e.g. the legacy FastAPI service or a staging backend - without touching any
 * UI code. `beforeFiles` is used deliberately so the external API takes
 * precedence over the local route handlers exactly like the old rewrite did.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,

  webpack(config) {
    // `db/schema.sql` is imported as a raw string by lib/server/db.ts. Using
    // asset/source inlines it in the bundle, so the schema bootstrap needs no
    // runtime filesystem access on serverless hosts.
    config.module.rules.push({ test: /\.sql$/, type: "asset/source" });
    return config;
  },

  async rewrites() {
    const externalApi = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/+$/, "");
    if (!externalApi) {
      return { beforeFiles: [], afterFiles: [], fallback: [] };
    }
    return {
      beforeFiles: [
        { source: "/api/:path*", destination: `${externalApi}/api/:path*` },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

module.exports = nextConfig;

