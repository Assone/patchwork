/// <reference types="node" />

import { defineConfig } from "@rspack/cli";
import { resolve } from "node:path";

console.log(resolve(import.meta.dirname, "dist"));

export default defineConfig({
  entry: {
    main: "./src/extension.ts",
  },
  output: {
    clean: true,
    path: resolve(import.meta.dirname, "dist"),
    filename: "extension.js",
    library: {
      type: "commonjs2",
    },
  },
  externals: {
    vscode: "commonjs vscode",
  },
  module: {
    rules: [
      {
        test: /\.(?:js|mjs|ts)$/,
        exclude: [/node_modules/],
        loader: "builtin:swc-loader",
        options: {
          detectSyntax: "auto",
        },
      },
    ],
  },
  devtool: "nosources-source-map",
  infrastructureLogging: {
    level: "log",
  },
});
