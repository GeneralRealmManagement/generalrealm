/**
 * build.js — Static blog generator for Cloudflare Pages (Pages CMS version)
 * Reads markdown posts from content/posts/, generates /blog pages.
 *
 * Repo layout:
 *   /                       ← existing static site (index.html, style.css, assets/…)
 *   /content/posts/*.md     ← blog posts (managed via Pages CMS)
 *   /templates/blog-list.html
 *   /templates/blog-post.html
 *   /.pages.yml             ← Pages CMS config
 *   build.js, package.json
 *
 * Cloudflare Pages → build command: npm install && node build.js
 *                    output dir: dist
 * No environment variables needed. Requires Node 18+.
 */

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const SITE_URL = 'https://generalrealm.com';
const PLACEHOLDER_IMG = '/assets/blog-placeholder.jpg';
const POSTS_DIR = path.join(__dirname, 'content/posts');
const OUT = path.join(__dirname, 'dist');

/* ── Minimal frontmatter parser (flat key: value pairs) ───────── */
function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: raw };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    data[kv[1]] = val;
  }
  return { data, body: m[2] };
}

const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const fmtDate = d => new Date(d).toLocaleDateString('en-US',
  { year: 'numeric', month: 'long', day: 'numeric' });
const stripTags = h => h.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const render = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');

function loadPosts() {
  if (!fs.existsSync(POSTS_DIR)) return [];
  return fs.readdirSync(POSTS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(file => {
      const raw = fs.readFileSync(path.join(POSTS_DIR, file), 'utf8');
      const { data, body } = parseFrontmatter(raw);
      return { file, data, body };
    })
    .filter(p => p.data.draft !== true)
    .sort((a, b) => new Date(b.data.date || 0) - new Date(a.data.date || 0));
}

function postVars(post) {
  const d = post.data;
  const title = d.title || path.basename(post.file, '.md');
  const slug = slugify(d.slug || path.basename(post.file, '.md'));
  const contentHtml = marked.parse(post.body || '');
  const plain = stripTags(contentHtml);
  return {
    title,
    seoTitle: d.seo_title || `${title} - EighthBrain`,
    seoDesc: d.description || plain.slice(0, 160),
    slug,
    url: `/blog/${slug}/`,
    date: d.date ? fmtDate(d.date) : '',
    author: d.author || 'Admin',
    image: d.image || PLACEHOLDER_IMG,
    excerpt: d.description || plain.slice(0, 160),
    content: contentHtml,
    canonical: `${SITE_URL}/blog/${slug}/`,
  };
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (['dist', 'node_modules', '.git', 'templates', 'content',
         'build.js', 'blog.html', 'package.json', 'package-lock.json'].includes(e.name)) continue;
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

function main() {
  const posts = loadPosts();
  console.log(`Found ${posts.length} published posts.`);

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
    const vars = postVars(post);
    const dir = path.join(OUT, 'blog', vars.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), render(postTpl, vars));
  }

  console.log(`Done: /blog + ${posts.length} post pages generated in dist/.`);
}

main();
