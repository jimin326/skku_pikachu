const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');

module.exports = merge(common, {
  mode: 'development',
  devtool: 'inline-source-map',
  devServer: {
    static: './dist',
    client: {
      // Errors keep their overlay; warnings do not. The build always emits
      // "won't be precached" / asset-size warnings for the pixi bundle and
      // the pyodide wasm + stdlib, and webpack-dev-server's default overlay
      // covers the whole page with an iframe that swallows every click --
      // so "게임 시작" is unclickable and the game looks stuck on the
      // loading screen even though the assets finished loading.
      overlay: { errors: true, warnings: false },
    },
  },
});
