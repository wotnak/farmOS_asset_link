const path = require('path');

module.exports = {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'assetlink.js',
    library: {
      type: "commonjs-module",
    }
  },
  externalsType: 'commonjs-module',
  externals: {
    'vue': 'vue',
    'vue-router': 'vue-router',
    'quasar': 'quasar',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/'),
    },
  },
};