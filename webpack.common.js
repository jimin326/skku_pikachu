const path = require('path');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: {
    main: './src/resources/js/main.js',
    ko: './src/ko/ko.js',
    dark_color_scheme: './src/resources/js/utils/dark_color_scheme.js',
    is_embedded_in_other_website:
      './src/resources/js/utils/is_embedded_in_other_website.js',
  },
  output: {
    filename: '[name].bundle.js',
    path: path.resolve(__dirname, 'dist'),
  },
  optimization: {
    runtimeChunk: { name: 'runtime' }, // this is for code-sharing between "main.js" and "ko.js"
    splitChunks: {
      chunks: 'all',
    },
  },
  module: {
    rules: [
      // Bot source files under src/code-here/ ship as raw text, NOT as
      // parsed modules -- their contents are handed to a Worker as a
      // string and evaluated there (see botWorker.js / botWorkerPython.js).
      // asset/source overrides webpack's default JS handling for anything
      // that lands in this directory, so a participant can drop in a plain
      // top-level `function decide(...)` file without ESM boilerplate. The
      // registry (src/resources/js/bot/botRegistry.js) picks these up via
      // require.context. See ADR-0020.
      {
        test: /\.(js|py)$/,
        include: path.resolve(__dirname, 'src/code-here'),
        type: 'asset/source',
      },
    ],
  },
  plugins: [
    new CleanWebpackPlugin(),
    new CopyPlugin({
      patterns: [
        {
          context: 'src/',
          from: 'resources/assets/**/*.+(json|png|mp3|wav)',
        },
        { from: 'src/en/manifest.json', to: 'en/manifest.json' },
        { from: 'src/ko/manifest.json', to: 'ko/manifest.json' },
        { from: 'src/zh/manifest.json', to: 'zh/manifest.json' },
        { from: 'src/resources/style.css', to: 'resources/style.css' },
        { from: 'src/index.html', to: 'index.html' },
        // Pyodide runtime (D-014, ADR-0014): copied as-is into dist/pyodide/
        // so botWorkerPython.js can loadPyodide() via a relative URL. Not
        // bundled through webpack -- Pyodide loads its own wasm/zip files at
        // runtime using indexURL, and webpack transforming those breaks it.
        // Skip TypeScript defs, source maps, HTML consoles and README to
        // keep dist/ lean; everything Pyodide's runtime actually loads (mjs,
        // wasm, stdlib zip, package repo) is included.
        {
          // The directory goes in `context` and the glob stays a bare '*' on
          // purpose. Building the pattern as an absolute path + '/*' instead
          // produces mixed separators on Windows ("C:\...\pyodide/*"), and the
          // globber reads those backslashes as escape characters, so the
          // pattern matches nothing and the whole build fails.
          context: path.resolve(__dirname, 'node_modules/pyodide'),
          from: '*',
          to: 'pyodide/[name][ext]',
          globOptions: {
            // Skip TypeScript defs, source maps, HTML consoles, README, and
            // package.json to keep dist/ lean. Everything Pyodide's runtime
            // actually loads (mjs, wasm, stdlib zip, pyodide-lock.json for
            // package repo) is included.
            ignore: [
              '**/*.md',
              '**/console*.html',
              '**/*.d.ts',
              '**/*.map',
              '**/package.json',
            ],
          },
        },
      ],
    }),
    new HtmlWebpackPlugin({
      template: 'src/en/index.html',
      filename: 'en/index.html',
      chunks: [
        'runtime',
        'main',
        'dark_color_scheme',
        'is_embedded_in_other_website',
      ],
      chunksSortMode: 'manual',
      minify: {
        collapseWhitespace: true,
        removeComments: true,
      },
    }),
    new HtmlWebpackPlugin({
      template: 'src/ko/index.html',
      filename: 'ko/index.html',
      chunks: [
        'runtime',
        'ko',
        'main',
        'dark_color_scheme',
        'is_embedded_in_other_website',
      ],
      chunksSortMode: 'manual',
      minify: {
        collapseWhitespace: true,
        removeComments: true,
      },
    }),
    new HtmlWebpackPlugin({
      template: 'src/zh/index.html',
      filename: 'zh/index.html',
      chunks: [
        'runtime',
        'main',
        'dark_color_scheme',
        'is_embedded_in_other_website',
      ],
      chunksSortMode: 'manual',
      minify: {
        collapseWhitespace: true,
        removeComments: true,
      },
    }),
    new HtmlWebpackPlugin({
      template: 'src/en/update-history/index.html',
      filename: 'en/update-history/index.html',
      chunks: ['dark_color_scheme'],
      chunksSortMode: 'manual',
      minify: {
        collapseWhitespace: true,
        removeComments: true,
      },
    }),
    new HtmlWebpackPlugin({
      template: 'src/ko/update-history/index.html',
      filename: 'ko/update-history/index.html',
      chunks: ['dark_color_scheme'],
      chunksSortMode: 'manual',
      minify: {
        collapseWhitespace: true,
        removeComments: true,
      },
    }),
    new HtmlWebpackPlugin({
      template: 'src/zh/update-history/index.html',
      filename: 'zh/update-history/index.html',
      chunks: ['dark_color_scheme'],
      chunksSortMode: 'manual',
      minify: {
        collapseWhitespace: true,
        removeComments: true,
      },
    }),
  ],
};
