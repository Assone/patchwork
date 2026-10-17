import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import template from "../webview/index.html";

export const getHtmlForWebview = (context: vscode.ExtensionContext, webview: vscode.Webview) => {
  const nonce = randomBytes(16).toString("hex");
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "dist", "webview.js"),
  );
  const cssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "dist", "webview.css"),
  );

  return template
    .replaceAll("{{NONCE}}", nonce)
    .replaceAll("{{CSP_SOURCE}}", webview.cspSource)
    .replaceAll("{{SCRIPT_URI}}", scriptUri.toString())
    .replaceAll("{{CSS_URI}}", cssUri.toString());
};
