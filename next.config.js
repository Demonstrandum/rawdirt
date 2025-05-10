/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    AWS_REGION: process.env.AWS_REGION,
    AWS_ACCOUNT_ID: process.env.AWS_ACCOUNT_ID,
    AWS_BUCKET: process.env.AWS_BUCKET,
    BUCKET_NAME: process.env.AWS_BUCKET,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_ACCESS_POINT_NAME: process.env.AWS_ACCESS_POINT_NAME,
    AWS_ACCESS_POINT_ARN: process.env.AWS_ACCESS_POINT_ARN,
    AWS_ACCESS_POINT_ALIAS: process.env.AWS_ACCESS_POINT_ALIAS,
  },
  webpack(config, { isServer, dev }) {
    config.experiments = { ...config.experiments, asyncWebAssembly: true, layers: true };

    if (isServer) {
      config.output.library = { type: "commonjs2" };
    }

    // Apply a general rule for all .wasm files to be treated as assets.
    // This might allow libraw-wasm's JS to load its WASM part correctly,
    // and potentially its worker script without specific intervention if they are co-located by default.
    config.module.rules.push({
      test: /\.wasm$/i, // More general .wasm test
      type: "asset/resource",
      generator: {
        filename: "static/wasm/[name].[hash][ext]", // Standard naming for assets
      },
    });

    // We are NOT adding a specific rule for libraw-wasm/dist/worker.js yet.
    // Let Webpack handle it by default alongside the libraw-wasm JS module.

    // Attempt to ignore specific circular dependency warnings from libraw-wasm worker
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      /Circular dependency between chunks with runtime \(_app-pages-browser_node_modules_libraw-wasm_dist_worker_js, em-pthread, webpack\)/,
      /Circular dependency between chunks with runtime \(0, em-pthread, webpack-runtime\)/,
      // We can also add a regex for the Caching failed warning if desired, but it's less critical
      // /webpack\.cache\.PackFileCacheStrategy Caching failed for pack: Error: Unable to snapshot resolve dependencies/
    ];

    return config;
  },
  // No need for serverRuntimeConfig with AWS credentials anymore
};

module.exports = nextConfig;
