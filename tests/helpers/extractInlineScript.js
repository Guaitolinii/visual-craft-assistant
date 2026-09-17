import { readFileSync } from "node:fs";

export function extractInlineScriptById(htmlFilePath, scriptId) {
  const html = readFileSync(htmlFilePath, "utf8");
  const pattern = new RegExp(
    `<script id="${scriptId}">([\\s\\S]*?)</script>`
  );
  const match = html.match(pattern);
  if (!match) {
    throw new Error(
      `No <script id="${scriptId}"> found in ${htmlFilePath}`
    );
  }
  return match[1];
}
