/// <reference types="node" />

import { defineConfig } from "@rspack/cli";
import { resolve } from "node:path";
import { RsdoctorRspackPlugin } from "@rsdoctor/rspack-plugin";
import { tanstackRouter } from "@tanstack/router-plugin/rspack";

const isDoctor = process.env.RSDOCTOR === "true";

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
    extensions: [".tsx", ".ts", "..."],
  },
  module: {
    rules: [
      {
        test: /\.(?:js|mjs|jsx|ts|tsx)$/,
        exclude: [/node_modules/],
        loader: "builtin:swc-loader",
        options: {
          detectSyntax: "auto",
          jsc: {
            transform: {
              react: {
                runtime: "automatic",
              },
              reactCompiler: true,
            },
          },
        },
      },
      {
        test: /\.css$/,
        use: ["postcss-loader"],
        type: "css",
      },
      {
        test: /\.html$/,
        type: "asset/source",
      },
    ],
  },
  plugins: [
    isDoctor && new RsdoctorRspackPlugin(),
    tanstackRouter({
      target: "react",
      routesDirectory: "./src/webview/routes",
      generatedRouteTree: "./src/webview/routeTree.gen.ts",
    }),
  ],
  devtool: "nosources-source-map",
  infrastructureLogging: {
    level: "log",
  },
});
