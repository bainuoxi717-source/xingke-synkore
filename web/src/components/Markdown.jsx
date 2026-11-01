// 极简 Markdown 渲染（行内支持 PPT 引用、课堂出处引用）
import React from 'react';
import SlideRef from './SlideRef.jsx';

// 粗体 / 斜体 / 行内码 / PPT 引用 / 课堂出处
const buildInline = (text, ctx, keyPrefix = '') => {
  const nodes = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|PPT\s*第\s*[\d、,，和\s]+\s*张|\[?P\d+\]?|【\d{4}-\d{2}-\d{2}[^】]*】)/g;
  let last = 0, m, i = 0;

  const pushPlain = (s) => { if (s) nodes.push(s); };

  while ((m = re.exec(text)) !== null) {
    pushPlain(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}t${i++}`;

    if (tok.startsWith('**')) {
      // 递归：加粗里可能包着 PPT 引用（如 **PPT 第 4 张**）
      nodes.push(<strong key={key}>{buildInline(tok.slice(2, -2), ctx, key + 'b')}</strong>);
    } else if (tok.startsWith('`')) {
      nodes.push(<code key={key} className="md-code">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('*')) {
      nodes.push(<em key={key}>{tok.slice(1, -1)}</em>);
    } else if (/^PPT/.test(tok)) {
      // PPT 第 3 张 / PPT 第 3、4 张
      const nums = (tok.match(/\d+/g) ?? []).map(Number).filter((n) => n > 0 && n <= 20);
      if (nums.length && ctx?.slides?.length) {
        nums.forEach((n, k) => {
          if (k > 0) nodes.push('、');
          nodes.push(<SlideRef key={`${key}s${k}`} n={n} slides={ctx.slides} onOpen={ctx.onOpenSlide} />);
        });
      } else nodes.push(tok);
    } else if (/^\[?P\d+\]?$/.test(tok)) {
      const n = Number(tok.replace(/\D/g, ''));
      if (ctx?.slides?.[n - 1]) nodes.push(<SlideRef key={key} n={n} slides={ctx.slides} onOpen={ctx.onOpenSlide} />);
      else nodes.push(tok);
    } else if (tok.startsWith('【')) {
      // 课堂出处：能匹配到引用就做成可悬停的 chip
      const c = (ctx?.citations ?? []).find((x) => tok.includes(x.date) && (!x.leti || tok.includes(`第${x.leti}节`)));
      nodes.push(
        <span key={key} className="cite-inline" title={c?.quote ? `原话：“${c.quote}”` : tok}>
          {tok}
        </span>
      );
    } else nodes.push(tok);

    last = m.index + tok.length;
  }
  pushPlain(text.slice(last));
  return nodes.length ? nodes : text;
};

export default function Markdown({ text, slides, citations, onOpenSlide }) {
  const ctx = { slides, citations, onOpenSlide };
  const lines = String(text ?? '').split('\n');
  const out = [];
  let list = null;
  let table = null;
  let quote = null;

  const flush = () => {
    if (list) {
      const Tag = list.ordered ? 'ol' : 'ul';
      out.push(<Tag key={`l${out.length}`} className="md-list">{list.items.map((it, i) => <li key={i}>{buildInline(it, ctx, `l${out.length}${i}`)}</li>)}</Tag>);
      list = null;
    }
    if (table) {
      out.push(
        <div key={`t${out.length}`} className="md-table-wrap">
          <table className="md-table">
            <thead><tr>{table.head.map((h, i) => <th key={i}>{buildInline(h, ctx)}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{buildInline(c, ctx)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      table = null;
    }
    if (quote) {
      out.push(<blockquote key={`q${out.length}`} className="md-quote">{buildInline(quote, ctx)}</blockquote>);
      quote = null;
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { flush(); continue; }

    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (/^[\s|:-]+$/.test(line)) continue;
      if (!table) table = { head: cells, rows: [] };
      else table.rows.push(cells);
      continue;
    } else if (table) flush();

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flush(); const L = h[1].length; out.push(React.createElement(`h${L + 2}`, { key: `h${out.length}`, className: 'md-h' }, buildInline(h[2], ctx))); continue; }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flush(); out.push(<hr key={`hr${out.length}`} className="md-hr" />); continue; }

    if (/^\s*>\s?/.test(line)) { quote = (quote ? quote + ' ' : '') + line.replace(/^\s*>\s?/, ''); continue; }
    if (quote) flush();

    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const ordered = !!ol;
      const content = (ul ? ul[1] : ol[1]);
      if (list && list.ordered !== ordered) flush();
      if (!list) list = { ordered, items: [] };
      list.items.push(content);
      continue;
    }
    if (list) flush();

    out.push(<p key={`p${out.length}`} className="md-p">{buildInline(line, ctx)}</p>);
  }
  flush();
  return <div className="md-body">{out}</div>;
}
