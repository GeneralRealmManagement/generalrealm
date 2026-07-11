/**
 * build.js — Static blog generator for Cloudflare Pages
 * Fetches posts from WordPress REST API, generates /blog pages.
 * Supports Yoast SEO meta (falls back to post title/excerpt if not set).
 *
 * Repo layout:
 *   /                ← existing static site (index.html, style.css, assets/…)
 *   /templates/blog-list.html
 *   /templates/blog-post.html
 *   build.js
 *
 * Cloudflare Pages → build command: node build.js   output dir: dist
 * Env var: WP_API_URL = https://your-wp-server.com/wp-json/wp/v2
 * Requires Node 18+.
 */

const fs = require('fs');
const path = require('path');

const WP_API = process.env.WP_API_URL || 'https://YOUR-WP-SERVER.com/wp-json/wp/v2';
const SITE_URL = 'https://generalrealm.com';
const PLACEHOLDER_IMG = '/assets/blog-placeholder.jpg';
const OUT = path.join(__dirname, 'dist');

async function fetchAllPosts() {
  let posts = [], page = 1;
  while (true) {
    const res = await fetch(`${WP_API}/posts?per_page=100&page=${page}&_embed`);
    if (res.status === 400) break;
    if (!res.ok) throw new Error(`WP API error ${res.status}: ${await res.text()}`);
    posts = posts.concat(await res.json());
    const totalPages = parseInt(res.headers.get('x-wp-totalpages') || '1', 10);
    if (page >= totalPages) break;
    page++;
  }
  return posts;
}

const fmtDate = iso => new Date(iso).toLocaleDateString('en-US',
  { year: 'numeric', month: 'long', day: 'numeric' });
const featuredImage = p => p._embedded?.['wp:featuredmedia']?.[0]?.source_url || PLACEHOLDER_IMG;
const authorName = p => p._embedded?.author?.[0]?.name || 'Admin';
const stripTags = h => h.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const render = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');

function postVars(post) {
  const yoast = post.yoast_head_json || {};
  return {
    title: post.title.rendered,
    seoTitle: yoast.title || `${post.title.rendered} - EighthBrain`,
    seoDesc: yoast.description || stripTags(post.excerpt.rendered).slice(0, 160),
    slug: post.slug,
    url: `/blog/${post.slug}/`,
    date: fmtDate(post.date),
    author: authorName(post),
    image: yoast.og_image?.[0]?.url || featuredImage(post),
    excerpt: stripTags(post.excerpt.rendered).slice(0, 160),
    content: post.content.rendered,
    canonical: `${SITE_URL}/blog/${post.slug}/`,
  };
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (['dist', 'node_modules', '.git', 'templates', 'build.js', 'blog.html'].includes(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

function extractBlock(tpl, name) {
  const re = new RegExp(`<!--${name}-->([\\s\\S]*?)<!--/${name}-->`);
  const m = tpl.match(re);
  if (!m) throw new Error(`Template missing <!--${name}--> … <!--/${name}--> markers`);
  return m[1];
}

async function main() {
  console.log('Fetching posts from WordPress…');
  const posts = await fetchAllPosts();
  console.log(`Fetched ${posts.length} posts.`);

  copyDir(__dirname, OUT);

  const listTpl = fs.readFileSync(path.join(__dirname, 'templates/blog-list.html'), 'utf8');
  const postTpl = fs.readFileSync(path.join(__dirname, 'templates/blog-post.html'), 'utf8');

  const featuredTpl = extractBlock(listTpl, 'FEATURED');
  const cardTpl = extractBlock(listTpl, 'POST');

  const [featured, ...rest] = posts; // newest post = featured
  const featuredHtml = featured ? render(featuredTpl, postVars(featured)) : '';
  const cardsHtml = rest.map(p => render(cardTpl, postVars(p))).join('\n');

  const listHtml = listTpl
    .replace(/<!--FEATURED-->[\s\S]*?<!--\/FEATURED-->/, featuredHtml)
    .replace(/<!--POST-->[\s\S]*?<!--\/POST-->/, cardsHtml);

  fs.mkdirSync(path.join(OUT, 'blog'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'blog/index.html'), listHtml);

  for (const post of posts) {
    const dir = path.join(OUT, 'blog', post.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), render(postTpl, postVars(post)));
  }

  console.log(`Done: /blog + ${posts.length} post pages generated in dist/.`);
}

main().catch(err => { console.error(err); process.exit(1); });
