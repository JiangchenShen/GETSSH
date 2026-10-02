#!/usr/bin/env node
// Flags hype words and stock AI phrasing in GETSSH's user-facing copy. It only reports: some words
// are right when they describe a real mechanism ("零信任", "毫秒级" with a measurement behind it),
// so a person decides what to change. The rules behind the lists are in docs/GETSSH_COPY_STYLE_CN.md.
//
//   node scripts/copy-lint.js                 app UI strings and the website checkout next to this repo
//   node scripts/copy-lint.js <path> [...]    only these files or folders
//     --website <dir>   website checkout (default ../GETSSH-WEBSITE)
//     --summary         counts per word only
//     --strict          exit 1 when a word from the hype list is found
//
// Never writes to any file, so it is safe to run on someone else's working tree.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');

// Each rule is [pattern, advice, label?]. A string matches literally; a RegExp is used as written.
// Hits are grouped by label, which defaults to the string itself or to the matched text.
const CATEGORIES = [
  {
    title: '夸张：几乎都该删',
    hype: true,
    rules: [
      ['宇宙级', '删掉'],
      ['纳米级', '删掉'],
      ['量子级', '删掉'],
      ['史诗级', '删掉'],
      ['核弹级', '删掉'],
      ['殿堂级', '删掉'],
      ['航天级', '删掉'],
      [/军工级|军事级|军规级|军用级/, '写出算法和机制，例如 SQLCipher 整库加密、Argon2id'],
      [/银行级|金融级/, '写出算法和机制'],
      [/坚不可摧|固若金汤|铜墙铁壁|无懈可击|牢不可破/, '写清楚防住了什么，不做绝对承诺'],
      // 「无法保证绝对安全」「没有绝对安全的系统」are honest disclaimers, not the claim.
      [/(?<!无法保证|不能保证|不保证|没有|不存在|不可能做到|不可能|无法做到|并非|不是)绝对安全|100\s*%\s*安全|零风险/, '安全上不做绝对承诺'],
      [/堡垒(?!机|主机)/, '写出防护机制（「堡垒机」「堡垒主机」不算）', '堡垒'],
      [/降维打击|碾压|吊打|遥遥领先|天花板|王炸|秒杀|炸裂/, '写出比较对象和数字，没有就删'],
      [/最强|最安全/, '写出比较对象和数字，没有就删'],
      ['黑科技', '说出具体是什么技术'],
      [/颠覆|革命性|划时代/, '写出具体改变了什么'],
      [/无与伦比|前所未有|史无前例/, '删掉'],
      [/终极|极致|巅峰/, '删掉，或换成可以测量的数字'],
      [/\b(?:military|bank|nsa|government)[- ]grade\b/i, 'name the algorithm, e.g. SQLCipher, Argon2id'],
      [/\bun(?:breakable|hackable)\b|\bimpenetrable\b|\bbulletproof\b|\b100\s*% secure\b|\bzero risk\b/i, 'say what it protects against; never promise absolute security'],
      [/\bultimate\b|\bun(?:paralleled|matched|precedented)\b|\bmind[- ]blowing\b|\binsanely\b|\bnext[- ]level\b/i, 'drop it'],
      [/\brevolution(?:ary|i[sz]es?)\b|\bgroundbreaking\b|\bgame[- ]chang(?:er|ing)\b/i, 'say what actually changes'],
      [/\b(?:blazing(?:ly)?|lightning)[- ]fast\b/i, 'give a measured number'],
      [/\bworld[- ]class\b|\bbest[- ]in[- ]class\b|\b(?:cutting|bleeding)[- ]edge\b|\bstate[- ]of[- ]the[- ]art\b/i, 'drop it'],
    ],
  },
  {
    title: '机器腔：改成直接陈述',
    rules: [
      [/打造|助力|赋能|致力于|赋予/, '换成「做」「提供」「给」，或直接写功能'],
      [/一站式|全方位|全链路/, '列出具体包含什么'],
      ['闭环', '说清楚流程从哪里开始、到哪里结束'],
      ['无缝', '说清楚怎么衔接，例如断线后自动重连'],
      ['丝滑', '删掉，或写出帧率、延迟'],
      [/尽享|畅享|匠心|沉浸式/, '删掉'],
      [/重新定义|重塑|焕新/, '写出具体改了什么'],
      ['告别', '直接写现在怎么做'],
      ['深度融合', '写出两者具体怎么配合'],
      [/不仅[^。！？!?\n]{0,40}?(?:更|还|也|而且)/, '只留后半句，或拆成两句', '不仅……更……'],
      [/无论是?[^。！？!?\n]{0,30}?还是/, '直接列出支持的情况', '无论……还是……'],
      [/不是[^。！？!?，,\n]{1,20}[，,]?\s*而是/, '直接说是什么', '不是……而是……'],
      [/让[^。！？!?，,\n]{1,20}?变得/, '直接写结果', '让……变得……'],
      [/开启[^。！？!?\n]{0,10}?新(?:篇章|纪元|时代|体验|旅程)/, '删掉', '开启……新篇章'],
      [/在(?:当今|这个)[^。！？!?\n]{0,12}?时代/, '删掉', '在当今……时代'],
      [/值得一提的是|总而言之|综上所述|简而言之/, '删掉'],
      // 更快、更稳、更安全 / 零配置、零依赖、零信任
      [/([更超极全零])[一-鿿]{1,3}[、，,]\s*\1[一-鿿]{1,3}[、，,和与及]\s*\1[一-鿿]{1,3}/, '只留最重要的一个，并给出依据', '排比三连'],
      [/\bseamless(?:ly)?\b|\beffortless(?:ly)?\b/i, 'say how it works, e.g. reconnects after a drop'],
      [/\bempower(?:s|ed|ing)?\b|\bunleash(?:es|ed|ing)?\b|\bsupercharg(?:e|es|ed|ing)\b|\belevates?\b/i, 'say what the user can do'],
      [/\bharness(?:es|ed|ing)? the power\b|\bunlock(?:s|ed|ing)? the (?:power|potential)\b/i, 'drop it'],
      [/\bdelv(?:e|es|ed|ing)\b|\bleverag(?:e|es|ed|ing)\b|\brobust\b|\bpeace of mind\b|\blook no further\b|\btestament to\b/i, 'use a plain word, or drop it'],
      [/\bwhether you(?:['’]re| are)\b/i, 'list the supported cases directly', 'whether you’re …'],
      [/\bnot (?:just|only)\b[^.!?\n]{0,60}?\bbut\b/i, 'keep the second half', 'not just … but …'],
      [/\bin today['’]s\b/i, 'drop it'],
      [/\btakes? [^.!?\n]{0,25}?to the next level\b/i, 'drop it', 'take … to the next level'],
    ],
  },
  {
    title: '看语境：是字面的技术描述就保留，并确认有出处',
    rules: [
      ['零信任', '确实每次访问都验证时才用'],
      [/[毫微]?秒级/, '附上测量条件，或直接写数字'],
      [/极速|秒开/, '附上测量的数字'],
      [/企业级|工业级|生产级/, '写出具体能力，例如审计日志、权限隔离'],
      ['零拷贝', '确认实现里真的没有拷贝'],
      [/\bzero[- ]trust\b/i, 'only if every access is verified'],
      [/\b(?:enterprise|production|industrial)[- ]grade\b/i, 'name the concrete capability'],
      [/\bzero[- ]copy\b/i, 'only if the implementation really avoids copies'],
      [/\binstant(?:ly)?\b/i, 'give a measured number, or drop it'],
    ],
  },
];

const EXTENSIONS = new Set(['.json', '.md', '.mdx', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html']);
const CODE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'dist-electron', 'release', 'build', 'out', 'coverage', '__tests__']);
// Third-party license texts are quoted verbatim.
const SKIP_SUFFIXES = [path.join('content', 'legal', 'licenses')];

function compile(pattern) {
  if (typeof pattern === 'string') return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  return new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
}

const RULES = CATEGORIES.flatMap((category) =>
  category.rules.map(([pattern, advice, label]) => ({
    category,
    regex: compile(pattern),
    advice,
    label: label ?? (typeof pattern === 'string' ? pattern : null),
  })),
);

function collect(target, files) {
  // A file named on the command line is scanned whatever its extension.
  if (fs.statSync(target).isFile()) {
    files.push(target);
    return;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !SKIP_SUFFIXES.some((suffix) => full.endsWith(suffix))) collect(full, files);
    } else if (
      entry.isFile() &&
      EXTENSIONS.has(path.extname(entry.name)) &&
      !entry.name.endsWith('.d.ts') &&
      !/\.(?:test|spec)\.[^.]+$/.test(entry.name)
    ) {
      files.push(full);
    }
  }
}

function snippet(line, start, end) {
  const from = Math.max(0, start - 12);
  const to = Math.min(line.length, end + 12);
  return (
    (from > 0 ? '…' : '') +
    line.slice(from, start).trimStart() +
    `【${line.slice(start, end)}】` +
    line.slice(end, to).trimEnd() +
    (to < line.length ? '…' : '')
  );
}

function scan(file, hits, notes) {
  const ext = path.extname(file);
  const code = CODE.has(ext);
  const markdown = ext === '.md' || ext === '.mdx';
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    notes.push(`读不了 ${path.relative(process.cwd(), file) || file}（${error.code ?? error.message}）`);
    return;
  }
  let fenced = false;
  let blockComment = false;
  text.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (markdown && trimmed.startsWith('```')) {
      fenced = !fenced;
      return;
    }
    // Code samples in docs and whole-line comments in source are not copy anyone reads in the
    // product. A comment after code on the same line is still scanned.
    if (fenced) return;
    if (code) {
      if (blockComment) {
        if (trimmed.includes('*/')) blockComment = false;
        return;
      }
      if (/^(?:\/\*|\{\/\*)/.test(trimmed) && !trimmed.includes('*/')) {
        blockComment = true;
        return;
      }
      if (/^(?:\/\/|\/\*|\*|\{\/\*|import\s)/.test(trimmed)) return;
    }
    // Report each span of characters once, even when two rules match it exactly.
    const taken = new Set();
    for (const rule of RULES) {
      for (const match of line.matchAll(rule.regex)) {
        const start = match.index;
        const end = start + match[0].length;
        if (taken.has(`${start}:${end}`)) continue;
        taken.add(`${start}:${end}`);
        hits.push({ file, line: index + 1, column: start + 1, rule, text: match[0], snippet: snippet(line, start, end) });
      }
    }
  });
}

function main() {
  const options = { summary: false, strict: false, website: path.resolve(REPO, '..', 'GETSSH-WEBSITE') };
  const targets = [];
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--summary') options.summary = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--website') {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error('--website needs a directory');
      options.website = path.resolve(args[++i]);
    } else if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`);
    else targets.push(path.resolve(arg));
  }

  const notes = [];
  if (!targets.length) {
    targets.push(path.join(REPO, 'apps', 'getssh-client', 'src'));
    const site = path.join(options.website, 'src');
    if (fs.existsSync(site)) targets.push(site);
    else notes.push(`没找到官网仓库 ${options.website}，这次只检查应用`);
  }

  const files = [];
  for (const target of targets) collect(target, files);
  const hits = [];
  for (const file of files) scan(file, hits, notes);
  hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);

  const rel = (file) => path.relative(process.cwd(), file) || file;
  console.log(`copy-lint：检查了 ${files.length} 个文件`);
  for (const target of targets) console.log(`  ${rel(target)}`);
  for (const note of notes) console.log(`  （${note}）`);

  for (const category of CATEGORIES) {
    const list = hits.filter((hit) => hit.rule.category === category);
    console.log(`\n== ${category.title}（${list.length} 处）`);
    if (options.summary) continue;
    for (const hit of list) console.log(`${rel(hit.file)}:${hit.line}:${hit.column}  ${hit.snippet}`);
  }

  console.log('\n== 按词汇总');
  for (const category of CATEGORIES) {
    const counts = new Map();
    for (const hit of hits) {
      if (hit.rule.category !== category) continue;
      const label = hit.rule.label ?? hit.text.toLowerCase();
      const entry = counts.get(label) ?? { count: 0, advice: hit.rule.advice };
      entry.count++;
      counts.set(label, entry);
    }
    if (!counts.size) continue;
    console.log(`${category.title}`);
    for (const [label, { count, advice }] of [...counts].sort((a, b) => b[1].count - a[1].count)) {
      console.log(`  ${count} × ${label}：${advice}`);
    }
  }

  if (options.strict && hits.some((hit) => hit.rule.category.hype)) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`copy-lint: ${error.message}`);
  process.exitCode = 2;
}
