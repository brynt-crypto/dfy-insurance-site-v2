import type { NextConfig } from "next";

/**
 * GitHub Pages serves a project site from a sub-path
 * (https://<user>.github.io/<repo>/), so the export needs a basePath. That
 * would also rewrite every local URL, which makes `npm run dev` awkward, so
 * the Pages settings are switched on only in CI via GITHUB_PAGES=true.
 * Local development is completely unaffected.
 */
const isPages = process.env.GITHUB_PAGES === "true";
const repo = "/dfy-insurance-site-v2";

const nextConfig: NextConfig = {
  // basePath rewrites next/link and next/image, but NOT raw src attributes on
  // <video> or <img>. Anything hand-written has to prefix this itself.
  env: { NEXT_PUBLIC_BASE_PATH: isPages ? repo : "" },
  ...(isPages && {
    output: "export",
    basePath: repo,
    assetPrefix: `${repo}/`,
    // Pages has no image optimisation server.
    images: { unoptimized: true },
    // Emit /path/index.html so deep links resolve without a server.
    trailingSlash: true,
  }),
};

export default nextConfig;
