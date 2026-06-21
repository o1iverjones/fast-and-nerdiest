const axios = require('axios');
const cheerio = require('cheerio');

const WIKI_BASE = () => process.env.WIKIPEDIA_BASE_URL || 'https://en.wikipedia.org';
const HEADERS = {
  'User-Agent': 'FastAndNerdiest/1.0 (educational game)',
  'Accept-Encoding': 'gzip',
};

const DISABLED_NAMESPACES = [
  'File:', 'Image:', 'Category:', 'Help:', 'Wikipedia:', 'Talk:',
  'Special:', 'User:', 'Portal:', 'Template:', 'MediaWiki:', 'Module:',
  'Draft:', 'TimedText:', 'User talk:', 'Template talk:', 'Wikipedia talk:'
];

// TTL caches
const ARTICLE_TTL = 30 * 60 * 1000;
const LINKS_TTL   = 10 * 60 * 1000;
const articleCache = new Map();
const linksCache   = new Map();

function cacheGet(map, key, ttl) {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > ttl) { map.delete(key); return null; }
  return entry;
}

// Retry with backoff on 429
async function wikiGet(url, options = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await axios.get(url, { headers: HEADERS, ...options });
    } catch (err) {
      const status = err.response?.status;
      if (status === 429 && attempt < retries) {
        const retryAfter = parseInt(err.response.headers['retry-after'] || '0', 10);
        const wait = retryAfter > 0 ? retryAfter * 1000 : 1000 * Math.pow(2, attempt);
        console.warn(`[wiki] 429 on attempt ${attempt}, waiting ${wait}ms…`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }
}

function processArticleHtml(html) {
  const $ = cheerio.load(html);

  $('.mw-editsection, .mw-editsection-bracket').remove();
  $('.navbox, .vertical-navbox, .navbox-inner, .navbox-subgroup').remove();
  $('.mw-category, #catlinks, .catlinks').remove();
  $('.sistersitebox, .portal, .noprint').remove();
  $('script, style').remove();

  $('a[href^="/wiki/"]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href') || '';
    const rawTitle = href.slice(6).split('#')[0];
    const decodedTitle = decodeURIComponent(rawTitle).replace(/_/g, ' ');

    if (DISABLED_NAMESPACES.some(ns => decodedTitle.startsWith(ns))) {
      $el.removeAttr('href').addClass('wiki-disabled');
    } else {
      $el.attr('href', '#')
        .attr('data-wiki-link', decodedTitle)
        .addClass('wiki-link');
    }
  });

  $('a:not([data-wiki-link]):not(.wiki-disabled)').each((_, el) => {
    $(el).removeAttr('href').addClass('wiki-disabled');
  });

  return $.html('body > *') || $.html();
}

async function fetchArticle(title) {
  const cacheKey = title.toLowerCase();
  const cached = cacheGet(articleCache, cacheKey, ARTICLE_TTL);
  if (cached) return { html: cached.html, title: cached.title };

  const url = `${WIKI_BASE()}/w/api.php`;
  const response = await wikiGet(url, {
    params: {
      action: 'parse',
      page: title,
      prop: 'text',
      disablelimitreport: true,
      disableeditsection: true,
      format: 'json',
    },
  });

  const data = response.data;
  if (data.error) {
    const err = new Error(data.error.info || 'Article not found');
    err.code = data.error.code;
    throw err;
  }

  const rawHtml = data.parse.text['*'];
  const canonicalTitle = data.parse.title;
  const processedHtml = processArticleHtml(rawHtml);

  articleCache.set(cacheKey, { html: processedHtml, title: canonicalTitle, ts: Date.now() });
  return { html: processedHtml, title: canonicalTitle };
}

// An article is treated as a "stub" if it has fewer than this many outbound
// links to other articles. Such articles are dead ends — you can't navigate
// away from them — so they're unusable as a start or target. Tune as needed.
const MIN_OUTBOUND_LINKS = 5;
const RANDOM_BATCH = 10;

async function fetchRandomBatch(count) {
  const url = `${WIKI_BASE()}/w/api.php`;
  const response = await wikiGet(url, {
    params: { action: 'query', list: 'random', rnnamespace: 0, rnlimit: count, format: 'json' },
  });
  return (response.data.query?.random || []).map(r => r.title);
}

async function isStub(title) {
  const links = await getArticleLinks(title);
  return links.length < MIN_OUTBOUND_LINKS;
}

// Pick a random mainspace article. By default, stubs (articles with no
// meaningful connections to other articles) are rejected and another pick is
// tried, since the game requires navigating between linked articles.
async function fetchRandomArticle({ excludeStubs = true, maxAttempts = 20 } = {}) {
  if (!excludeStubs) {
    const [title] = await fetchRandomBatch(1);
    return { title };
  }

  let candidates = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (candidates.length === 0) candidates = await fetchRandomBatch(RANDOM_BATCH);
    const title = candidates.shift();
    if (!title) continue;
    if (!(await isStub(title))) return { title };
    console.warn(`[wiki] skipping stub article "${title}"`);
  }
  throw new Error('Could not find a non-stub random article after several attempts.');
}

async function getArticleLinks(title) {
  const cacheKey = title.toLowerCase();
  const cached = cacheGet(linksCache, cacheKey, LINKS_TTL);
  if (cached) return cached.links;

  const url = `${WIKI_BASE()}/w/api.php`;
  const response = await wikiGet(url, {
    params: {
      action: 'query',
      titles: title,
      prop: 'links',
      pllimit: 500,
      plnamespace: 0,
      format: 'json',
    },
  });

  const pages = response.data.query?.pages || {};
  const pageId = Object.keys(pages)[0];
  const links = pageId === '-1' ? [] : (pages[pageId].links || []).map(l => l.title);

  // Don't cache empty results — they may be transient API failures rather than
  // genuinely link-free articles, and caching them would freeze the bot permanently.
  if (links.length > 0) {
    linksCache.set(cacheKey, { links, ts: Date.now() });
  }
  return links;
}

module.exports = { fetchArticle, fetchRandomArticle, getArticleLinks };
