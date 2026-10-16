// Скачивает все картинки fundoor.pro, на которые ссылается лендинг, и встраивает их в HTML как data:URI.
// Запуск (за прокси добавьте NODE_USE_ENV_PROXY=1): node embeds/inline-images.mjs [вход.html] [выход.html]
import { readFile, writeFile } from "node:fs/promises";

const [input = "embeds/fundoor-landing.html", output = "embeds/fundoor-landing.inline.html"] = process.argv.slice(2);
const ORIGIN = "https://fundoor.pro";
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml", ico: "image/x-icon" };

let html = await readFile(input, "utf8");

// Иконки бирж собираются в скрипте из slug + расширения — вытаскиваем их из exIconExt.
const extBlock = html.match(/const exIconExt = \{([\s\S]*?)\};/)[1];
const iconUrls = [...extBlock.matchAll(/(\w+):\s*"(\w+)"/g)].map(([, slug, ext]) => `${ORIGIN}/exchange-icons/${slug}.${ext}`);
const literalUrls = [...html.matchAll(/https:\/\/fundoor\.pro\/(?:screenshots|emoji)\/[\w.-]+\.\w+/g)].map((m) => m[0]);
const urls = [...new Set([...literalUrls, ...iconUrls])];

const dataUris = {};
let failed = 0;
for (const url of urls) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = url.split(".").pop().toLowerCase();
    const mime = res.headers.get("content-type")?.split(";")[0] || MIME[ext] || "application/octet-stream";
    dataUris[url] = `data:${mime};base64,${buf.toString("base64")}`;
    console.log(`ok   ${(buf.length / 1024).toFixed(0).padStart(5)} KB  ${url}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL ${e.message}  ${url}`);
  }
}

// Прямые ссылки в разметке и скрипте.
for (const url of literalUrls) if (dataUris[url]) html = html.split(url).join(dataUris[url]);

// Иконки бирж: подменяем функцию exIcon на словарь slug → data:URI.
const iconMap = Object.fromEntries(
  Object.entries(dataUris)
    .filter(([u]) => u.includes("/exchange-icons/"))
    .map(([u, d]) => [u.split("/").pop().replace(/\.\w+$/, ""), d]),
);
html = html.replace(
  /const exIcon = \(slug\) => [^\n]+\n/,
  `const EX_ICONS = ${JSON.stringify(iconMap)};\n  const exIcon = (slug) => EX_ICONS[slug] || \`\${ORIGIN}/exchange-icons/\${encodeURIComponent(slug)}.\${exIconExt[slug] || "png"}\`;\n`,
);

await writeFile(output, html);
console.log(`\n${urls.length - failed}/${urls.length} картинок встроено → ${output} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)`);
