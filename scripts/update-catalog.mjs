import { readFile, mkdir, writeFile } from 'node:fs/promises';
const target = 'public/samsung-catalog.json';
const seeds = ['https://www.samsung.com/ca/business/smartphones/galaxy-s/galaxy-s25-sm-s931wzsexac/', 'https://www.samsung.com/us/common/sitemap/', 'https://www.samsung.com/uk/info/sitemap/', 'https://www.samsung.com/ae/business/smartphones/', 'https://www.samsung.com/in/info/sitemap/', 'https://www.samsung.com/ae/info/sitemap/'];
let previous;
try { previous = JSON.parse(await readFile(target, 'utf8')); } catch { previous = { products: [], pending: seeds }; }
const products = new Map(previous.products.map(product => [product.id, product]));
const refresh = [...previous.products].sort((a,b) => a.lastChecked.localeCompare(b.lastChecked)).slice(0,20).map(p => p.sourceUrl);
const queue = [...new Set([...seeds, ...refresh, ...(previous.pending || [])])];
const visited = new Set(), errors = [], failed = [];
const official = url => { try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === 'www.samsung.com'; } catch { return false; } };
const relevant = url => !/%7B|%7D|\{|\}|galaxy-book|galaxybooks/i.test(url) && /smartphones|galaxy|tablets|watches|buds|mobile-accessories|chargers|cases|sitemap/.test(url);
const now = new Date().toISOString();
const checkedUrls = previous.checkedUrls || {};
async function fetchPage(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'IMEI-Lens-Catalog/1.0' } }); if (!response.ok) throw new Error(`HTTP ${response.status}`); return await response.text(); }
    catch (error) { if (attempt === 2) throw error; await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); }
  }
}
function visitJson(value, url) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach(item => visitJson(item, url)); return; }
  if ([value['@type']].flat().includes('Product') && typeof value.name === 'string') {
    const code = typeof value.sku === 'string' ? value.sku : typeof value.mpn === 'string' ? value.mpn : '';
    if (code) {
      const region = new URL(url).pathname.split('/')[1];
      const id = `${region}:${code.toUpperCase()}`;
      const image = Array.isArray(value.image) ? value.image[0] : value.image;
      products.set(id, { id, name: value.name, modelCode: code.toUpperCase(), region, imageUrl: typeof image === 'string' ? image : image?.url || null,
        specifications: Array.isArray(value.additionalProperty) ? value.additionalProperty.filter(p => typeof p.name === 'string' && ['string','number'].includes(typeof p.value)).map(p => ({ name:p.name, value:String(p.value) })) : [],
        releaseDate: value.releaseDate || null, compatibility: null, sourceUrl: url, lastChecked: now });
    }
  }
  Object.values(value).forEach(item => { if (typeof item === 'object') visitJson(item, url); });
}
while (queue.length && visited.size < Number(process.env.CATALOG_PAGE_LIMIT || 80)) {
  const url = queue.shift(); if (visited.has(url) || !official(url) || !relevant(url)) continue;
  visited.add(url);
  try {
    const html = await fetchPage(url);
    checkedUrls[url] = now;
    const code = html.match(/<input[^>]*id="modelCode"[^>]*value="([A-Z0-9-]+)"/i)?.[1];
    const title = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)?.[1];
    if (code && title?.includes(code)) {
      const name = title.split('|').map(x => x.trim()).find(x => !/^Business$/i.test(x) && !x.includes(code) && !/^Samsung\b/i.test(x));
      const image = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i)?.[1];
      if (name) visitJson({ '@type':'Product', name, sku:code, image: image && !/logo|clientlib-common/i.test(image) ? image : undefined }, url);
    }
    for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try { visitJson(JSON.parse(match[1]), url); } catch { /* malformed structured data is not trusted */ }
    }
    for (const match of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
      try { const next = new URL(match[1].replace(/&amp;/g, '&'), url); next.search = ''; next.hash = ''; const href = next.href; const stale = !checkedUrls[href] || Date.parse(now) - Date.parse(checkedUrls[href]) > 7 * 86400000; if (stale && official(href) && relevant(href) && !visited.has(href) && !queue.includes(href)) queue.push(href); } catch {}
    }
  } catch (error) { errors.push({ url, error: String(error.message) }); failed.push(url); }
}
const result = { updatedAt: now, coverage: { complete: false, pagesChecked: visited.size, productVariants: products.size, sources: seeds, errors }, products: [...products.values()], checkedUrls, pending: [...new Set([...queue, ...failed])].filter(url => official(url) && relevant(url)).slice(0, 5000) };
await mkdir('public', { recursive:true });
if (products.size) await writeFile(target, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ products: products.size, pagesChecked: visited.size, failures: errors.length }));
if (!products.size || errors.length === visited.size) process.exitCode = 1;
