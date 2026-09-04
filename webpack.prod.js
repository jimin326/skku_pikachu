const { merge } = require('webpack-merge');
const WorkboxPlugin = require('workbox-webpack-plugin');
const common = require('./webpack.common.js');

module.exports = merge(common, {
  mode: 'production',
  devtool: 'source-map',
  // Service worker generation lives in the prod config only. In dev,
  // webpack-dev-server rebuilds on every source save, and Workbox's own docs
  // (GH #1790) warn that GenerateSW under --watch produces an inaccurate
  // precache manifest -- and worse, the installed SW then serves stale HTML
  // from cache while dev-server tries to live-reload, which snowballs into an
  // infinite refresh loop. The HTML's registration script is guarded by a
  // localhost check so the fetch of a missing sw.js never happens in dev.
  plugins: [
    new WorkboxPlugin.GenerateSW({
      swDest: 'sw.js',
      cleanupOutdatedCaches: true,
      skipWaiting: false,
    }),
  ],
});
