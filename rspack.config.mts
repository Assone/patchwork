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
  externals: [
    {
      vscode: "commonjs vscode",
    },
    ({ request }, callback) => {
      if (request?.startsWith("node:")) {
        callback(null, `node-commonjs ${request}`);
        return;
      }

      callback();
    },
  ],
  resolve: {
    extensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", "..."],
  },
  module: {
    rules: [
      {
        test: /\.(?:js|mjs|jsx|ts|tsx)$/,
        exclude: [/node_modules/],
        loader: "builtin:swc-loader",
        options: {
          detectSyntax: "auto",
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
