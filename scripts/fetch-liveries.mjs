import * as cheerio from "cheerio";
import { writeFile } from "node:fs/promises";

const LIVERY_PAGE = "https://bustimes.org/map";
const OUTPUT = new URL("../public/liveries.css", import.meta.url);

const html = await fetch(LIVERY_PAGE).then((r) => {
  if (!r.ok) throw new Error(`Failed to fetch ${LIVERY_PAGE}: ${r.status}`);
  return r.text();
});

const $ = cheerio.load(html);
const href = $('link[rel="stylesheet"][href*="liveries."]').attr("href");

if (!href) {
  console.error("Could not find livery stylesheet link on the page.");
  process.exit(1);
}

const cssUrl = new URL(href, LIVERY_PAGE).href;
const css = await fetch(cssUrl).then((r) => {
  if (!r.ok) throw new Error(`Failed to fetch ${cssUrl}: ${r.status}`);
  return r.text();
});

await writeFile(OUTPUT, css, "utf-8");
console.log(`Cached ${cssUrl} → ${OUTPUT.pathname} (${css.length} bytes)`);
