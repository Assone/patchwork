/// <reference types="node" />

import { defineConfig } from "@rspack/cli";
import { resolve } from "node:path";
import { RsdoctorRspackPlugin } from "@rsdoctor/rspack-plugin";
import { tanstackRouter } from "@tanstack/router-plugin/rspack";
import { merge } from "rspack-merge";

const isDoctor = process.env.RSDOCTOR === "true";

const base = defineConfig({
  plugins: [isDoctor && new RsdoctorRspackPlugin()],
  output: {
    path: resolve(import.meta.dirname, "dist"),
  },
  resolve: {
    extensions: [".tsx", ".ts", "..."],
  },
  devtool: "nosources-source-map",
  infrastructureLogging: {
    level: "log",
  },
});

export default defineConfig([
  merge(base, {
    name: "extension",
    target: "node",
    entry: {
      extension: {
        import: "./src/extension.ts",
        library: {
          type: "commonjs2",
        },
      },
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
    module: {
      rules: [
        {
          test: /\.(?:ts)$/,
          exclude: [/node_modules/],
          loader: "builtin:swc-loader",
        },
        {
          test: /\.html$/,
          type: "asset/source",
        },
      ],
    },
    output: {
      clean: true,
    },
  }),
  merge(base, {
    name: "webview",
    dependencies: ["extension"],
    target: "web",
    plugins: [
      tanstackRouter({
        target: "react",
        routesDirectory: "./src/webview/routes",
        generatedRouteTree: "./src/webview/routeTree.gen.ts",
      }),
    ],
    entry: {
      webview: {
        import: "./src/webview/main.tsx",
      },
    },
    module: {
      rules: [
        {
          test: /\.(?:ts|tsx)$/,
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
      ],
    },
  }),
]);
