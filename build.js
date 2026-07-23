/**
 * build.js — Static site generator for Cloudflare Pages (Pages CMS)
 *
 * Generates from markdown managed in Pages CMS:
 *   content/posts/*.md      → /blog/ + /blog/<slug>/       (templates/blog-list, blog-post)
 *   content/companies/*.md  → /portfolio + homepage peek   (templates/portfolio.html, home.html)
 *   content/team/*.md       → team page "meet the team"    (templates/team.html)
 *   content/roles/*.md      → team page "open roles"       (templates/team.html)
 *
 * Cloudflare Pages → build command: npm install && node build.js
 *                    output dir: dist
 * Requires Node 18+.
 */

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const SITE_URL = 'https://generalrealm.com';
const SITE_NAME = 'GeneralRealm';
const PLACEHOLDER_IMG = '/assets/blog-placeholder.jpg';
const OUT = path.join(__dirname, 'dist');
const TPL = path.join(__dirname, 'templates');

/* Files generated from templates — don't copy the static originals */
const SKIP_COPY = ['dist', 'node_modules', '.git', 'templates', 'content',
  'build.js', 'package.json', 'package-lock.json', 'blog.html',
  'index.html', 'portfolio.html', 'team.html'];

/* ── Labels & colours ─────────────────────────────────── */
const STAGE_LABEL = { 'pre-seed': 'Pre-Seed', 'seed': 'Seed', 'series-a': 'Series A' };
const STAGE_STYLE = {
  'pre-seed': 'background:rgba(128,232,255,0.12);color:#005070;border-color:rgba(128,232,255,0.3);',
  'seed':     'background:rgba(200,168,248,0.12);color:#5020a0;border-color:rgba(200,168,248,0.3);',
  'series-a': 'background:rgba(168,240,216,0.12);color:#007050;border-color:rgba(168,240,216,0.3);',
};
const SECTOR_LABEL = {
  'consumer': 'Consumer', 'ai': 'AI & ML', 'deep-tech': 'Deep Tech', 'climate': 'Climate',
  'fintech': 'Fintech', 'dev-tools': 'Dev Tools', 'health': 'Health',
};
/* pill palette used for team tags and role tags */
const PALETTE = [
  { style: 'background:rgba(200,168,248,0.12);color:#5020a0;border-color:rgba(200,168,248,0.3);', dot: 'var(--c1)', shadow: 'rgba(200,168,248,0.5)' },
  { style: 'background:rgba(247,168,204,0.12);color:#901050;border-color:rgba(247,168,204,0.3);', dot: 'var(--c2)', shadow: 'rgba(247,168,204,0.5)' },
  { style: 'background:rgba(128,232,255,0.12);color:#005070;border-color:rgba(128,232,255,0.3);', dot: 'var(--c3)', shadow: 'rgba(128,232,255,0.5)' },
  { style: 'background:rgba(247,216,108,0.12);color:#906000;border-color:rgba(247,216,108,0.3);', dot: 'var(--c4)', shadow: 'rgba(247,216,108,0.5)' },
  { style: 'background:rgba(168,240,216,0.12);color:#007050;border-color:rgba(168,240,216,0.3);', dot: 'var(--c5)', shadow: 'rgba(168,240,216,0.5)' },
];
/* same label always gets the same colour */
const paletteFor = s => PALETTE[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];

/* ── Helpers ──────────────────────────────────────────── */
function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: raw };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1).replace(/\\"/g, '"');
    }
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    data[kv[1]] = val;
  }
  return { data, body: m[2] };
}

const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const fmtDate = d => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
const stripTags = h => String(h).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => esc(s).replace(/"/g, '&quot;');
const render = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
const encImg = s => encodeURI(String(s)).replace(/\(/g, '%28').replace(/\)/g, '%29');

function loadCollection(dir) {
  const full = path.join(__dirname, 'content', dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full)
    .filter(f => f.endsWith('.md'))
    .map(file => {
      const { data, body } = parseFrontmatter(fs.readFileSync(path.join(full, file), 'utf8'));
      return { file, data, body: (body || '').trim() };
    })
    .filter(x => x.data.draft !== true)
    .sort((a, b) => (parseInt(a.data.order) || 999) - (parseInt(b.data.order) || 999)
      || String(a.file).localeCompare(String(b.file)));
}

function extractBlock(tpl, name) {
  const m = tpl.match(new RegExp(`<!--${name}-->([\\s\\S]*?)<!--/${name}-->`));
  if (!m) throw new Error(`Template missing <!--${name}--> … <!--/${name}--> markers`);
  return m[1];
}
function fillBlock(tpl, name, html) {
  return tpl.replace(new RegExp(`<!--${name}-->[\\s\\S]*?<!--/${name}-->`), () => html);
}
/** expand a marked repeat-block for each item */
function repeat(tpl, name, items, fn) {
  const block = extractBlock(tpl, name);
  return fillBlock(tpl, name, items.map((it, i) => render(block, fn(it, i))).join('\n'));
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_COPY.includes(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}
const writePage = (rel, html) => {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, html);
};
const tpl = f => fs.readFileSync(path.join(TPL, f), 'utf8');

/* ── BLOG ─────────────────────────────────────────────── */
function postVars(post) {
  const d = post.data;
  const title = d.title || path.basename(post.file, '.md');
  const slug = slugify(d.slug || path.basename(post.file, '.md').replace(/^\d{4}-\d{2}-\d{2}-/, ''));
  const contentHtml = marked.parse(post.body || '');
  const plain = stripTags(contentHtml);
  return {
    title: esc(title),
    seoTitle: esc(d.seo_title || `${title} - ${SITE_NAME}`),
    seoDesc: escAttr(d.description || plain.slice(0, 160)),
    slug,
    url: `/blog/${slug}/`,
    date: d.date ? fmtDate(d.date) : '',
    author: esc(d.author || 'Admin'),
    image: encImg(d.image || PLACEHOLDER_IMG),
    excerpt: esc(d.description || plain.slice(0, 160)),
    content: contentHtml,
    canonical: `${SITE_URL}/blog/${slug}/`,
  };
}

function buildBlog() {
  const posts = loadCollection('posts')
    .sort((a, b) => new Date(b.data.date || 0) - new Date(a.data.date || 0));
  const listTpl = tpl('blog-list.html');
  const postTpl = tpl('blog-post.html');

  const [featured, ...rest] = posts;
  let html = fillBlock(listTpl, 'FEATURED',
    featured ? render(extractBlock(listTpl, 'FEATURED'), postVars(featured)) : '');
  html = repeat(html, 'POST', rest, p => postVars(p));
  writePage('blog/index.html', html);

  for (const post of posts) {
    const v = postVars(post);
    writePage(`blog/${v.slug}/index.html`, render(postTpl, v));
  }
  return posts.length;
}

/* ── PORTFOLIO ────────────────────────────────────────── */
function companyVars(c, i) {
  const d = c.data;
  const stage = slugify(d.stage || 'seed');
  const sector = slugify(d.sector || 'consumer');
  const name = d.name || path.basename(c.file, '.md');
  const desc = stripTags(marked.parse(c.body || ''));
  return {
    name: escAttr(name),
    nameUpper: esc(String(name).toUpperCase()),
    tagline: escAttr(d.tagline || ''),
    desc: escAttr(desc),
    category: escAttr(d.category || SECTOR_LABEL[sector] || ''),
    sector,
    sectorLabel: esc(SECTOR_LABEL[sector] || sector),
    stage,
    stageLabel: esc(STAGE_LABEL[stage] || stage),
    stageStyle: STAGE_STYLE[stage] || STAGE_STYLE.seed,
    founders: escAttr(d.founders || ''),
    website: escAttr(d.website || '#'),
    num: String(i + 1).padStart(2, '0'),
    rd: `rd${(i % 9) + 1}`,
  };
}

function buildPortfolio(companies) {
  let html = tpl('portfolio.html');
  html = repeat(html, 'COMPANY', companies, companyVars);

  /* sector filter pills, generated from the sectors actually in use */
  const seen = [];
  for (const c of companies) {
    const s = slugify(c.data.sector || 'consumer');
    if (!seen.includes(s)) seen.push(s);
  }
  html = repeat(html, 'SECTORPILL', seen,
    s => ({ sector: s, sectorLabel: esc(SECTOR_LABEL[s] || s) }));

  writePage('portfolio.html', render(html, { count: companies.length }));
}

function buildHome(companies) {
  const featured = companies.filter(c => c.data.show_on_homepage === true);
  const list = featured.length ? featured : companies.slice(0, 12);
  let html = tpl('home.html');
  html = repeat(html, 'PEEK', list, companyVars);
  writePage('index.html', render(html, { count: list.length }));
  return list.length;
}

/* ── TEAM + ROLES ─────────────────────────────────────── */
function personVars(p) {
  const d = p.data;
  const name = d.name || path.basename(p.file, '.md');
  const initials = d.initials
    || String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const tags = String(d.tags || '').split(',').map(t => t.trim()).filter(Boolean)
    .map(t => `<span class="exp-tag" style="${paletteFor(t).style}">${esc(t)}</span>`)
    .join('\n          ');
  return {
    name: esc(name),
    nameUpper: esc(String(name).toUpperCase()),
    initials: esc(initials),
    role: esc(d.role || ''),
    bio: esc(stripTags(marked.parse(p.body || ''))),
    tags,
    linkedin: escAttr(d.linkedin || '#'),
    twitter: escAttr(d.twitter || '#'),
    email: escAttr(d.email || '#'),
  };
}

function roleVars(r) {
  const d = r.data;
  const tag = d.tag || 'Open';
  const pal = paletteFor(tag);
  return {
    titleUpper: esc(String(d.title || path.basename(r.file, '.md')).toUpperCase()),
    details: esc(d.details || ''),
    tag: esc(tag),
    tagStyle: pal.style,
    dotColor: pal.dot,
    dotShadow: pal.shadow,
    applyUrl: escAttr(d.apply_url || '#'),
  };
}

function buildTeam(team, roles) {
  let html = tpl('team.html');
  html = repeat(html, 'PERSON', team, personVars);
  html = repeat(html, 'ROLE', roles, roleVars);
  writePage('team.html', html);
}

/* ── MAIN ─────────────────────────────────────────────── */
function main() {
  copyDir(__dirname, OUT);

  const companies = loadCollection('companies');
  const team = loadCollection('team');
  const roles = loadCollection('roles');

  const posts = buildBlog();
  buildPortfolio(companies);
  const peek = buildHome(companies);
  buildTeam(team, roles);

  console.log(`Done → ${posts} posts, ${companies.length} companies (${peek} on homepage), ` +
              `${team.length} team members, ${roles.length} open roles.`);
}

main();
