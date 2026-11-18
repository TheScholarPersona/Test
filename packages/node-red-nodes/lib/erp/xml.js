'use strict';
/**
 * Kleiner XML-Leser und -Schreiber für IDoc-XML: Elemente, Attribute, Text, Entitäten, CDATA;
 * Kommentare, Verarbeitungsanweisungen und DOCTYPE werden übersprungen. Keine externen Entitäten
 * (kein XXE), keine Namensräume nötig.
 */

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = (s) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });

/** XML-Text → Baum `{ name, attrs, children, text }`. */
function parseXml(xml) {
  const s = String(xml).replace(/^﻿/, '');
  let i = 0;
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const fail = (msg) => {
    throw new Error(`XML: ${msg} (Position ${i})`);
  };
  while (i < s.length) {
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i);
      if (end < 0) fail('Kommentar nicht geschlossen');
      i = end + 3;
    } else if (s.startsWith('<![CDATA[', i)) {
      const end = s.indexOf(']]>', i);
      if (end < 0) fail('CDATA nicht geschlossen');
      stack[stack.length - 1].text += s.slice(i + 9, end);
      i = end + 3;
    } else if (s.startsWith('<?', i) || s.startsWith('<!', i)) {
      const end = s.indexOf('>', i);
      if (end < 0) fail('Anweisung nicht geschlossen');
      i = end + 1;
    } else if (s.startsWith('</', i)) {
      const end = s.indexOf('>', i);
      const name = s.slice(i + 2, end).trim();
      const node = stack.pop();
      if (!node || node.name !== name) fail(`schließendes </${name}> passt nicht zu <${node?.name}>`);
      i = end + 1;
    } else if (s[i] === '<') {
      const end = s.indexOf('>', i);
      if (end < 0) fail('Element nicht geschlossen');
      let body = s.slice(i + 1, end);
      const selfClosing = body.endsWith('/');
      if (selfClosing) body = body.slice(0, -1);
      const nameMatch = /^([^\s/>]+)/.exec(body);
      if (!nameMatch) fail('Elementname fehlt');
      const node = { name: nameMatch[1], attrs: {}, children: [], text: '' };
      for (const a of body.slice(nameMatch[1].length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) node.attrs[a[1]] = decode(a[3] ?? a[4] ?? '');
      stack[stack.length - 1].children.push(node);
      if (!selfClosing) stack.push(node);
      i = end + 1;
    } else {
      const next = s.indexOf('<', i);
      const end = next < 0 ? s.length : next;
      stack[stack.length - 1].text += decode(s.slice(i, end));
      i = end;
    }
  }
  if (stack.length !== 1) fail(`<${stack[stack.length - 1].name}> nicht geschlossen`);
  const elements = root.children;
  if (elements.length !== 1) fail('genau ein Wurzelelement erwartet');
  return elements[0];
}

/** Erstes Kind mit dem Namen, alle Kinder mit dem Namen, Text eines Kindes (getrimmt, sonst ''). */
const child = (node, name) => node?.children.find((c) => c.name === name);
const childrenOf = (node, name) => (node ? node.children.filter((c) => c.name === name) : []);
const textOf = (node, name) => (child(node, name)?.text ?? '').trim();

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Baum `{ name, attrs?, children? | text? }` → XML-Text (eingerückt). Felder mit leerem Wert werden weggelassen. */
function toXml(node, indent = '') {
  const attrs = Object.entries(node.attrs ?? {})
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join('');
  const children = (node.children ?? []).filter((c) => c && (c.children?.length || (c.text !== undefined && c.text !== null && c.text !== '')));
  if (!children.length) return `${indent}<${node.name}${attrs}>${esc(node.text ?? '')}</${node.name}>`;
  return `${indent}<${node.name}${attrs}>\n${children.map((c) => toXml(c, indent + '  ')).join('\n')}\n${indent}</${node.name}>`;
}

module.exports = { parseXml, toXml, child, childrenOf, textOf };
