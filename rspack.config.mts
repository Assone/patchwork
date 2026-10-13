/// <reference types="node" />

import { defineConfig } from "@rspack/cli";
import { resolve } from "node:path";
import { RsdoctorRspackPlugin } from "@rsdoctor/rspack-plugin";

console.log(resolve(import.meta.dirname, "dist"));

export default defineConfig({
  entry: {
    extension: {
      import: "./src/extension.ts",
      library: {
        type: "commonjs2",
      },
    },
    webview: {
      import: "./src/webview/main.tsx",
    },
  },
  output: {
    clean: true,
    path: resolve(import.meta.dirname, "dist"),
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
      {
        test: /\.(?:js|mjs|jsx|ts|tsx)$/,
        use: {
          loader: "builtin:swc-loader",
          options: {
            detectSyntax: "auto",
          },
        },
      },
    ],
  },
  plugins: [
    process.env.RSDOCTOR &&
      new RsdoctorRspackPlugin({
        // plugin options
      }),
  ].filter(Boolean),
  devtool: "nosources-source-map",
  infrastructureLogging: {
    level: "log",
  },
});
