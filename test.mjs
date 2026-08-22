import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(
  new URL('./namuwiki-powerlink-blocker.user.js', import.meta.url),
  'utf8'
);
const instrumented = source.replace(
  '  const observer = new MutationObserver(onMutations);',
  '  globalThis.findShell = findShell; ' +
  'globalThis.isAdMarker = isAdMarker; return;\n\n' +
  '  const observer = new MutationObserver(onMutations);'
);
const context = {};

vm.runInNewContext(instrumented, context);

const div = protectedNode => ({
  nodeType: 1,
  localName: 'div',
  id: '',
  attributes: [],
  children: [],
  parentElement: null,
  style: { color: '', width: '' },
  get childElementCount() { return this.children.length; },
  hasAttribute(name) {
    return this.attributes.some(attr => attr.name === name);
  },
  matches: () => protectedNode,
  querySelector: () => null
});
const append = (parent, ...children) => {
  parent.children.push(...children);
  children.forEach(child => child.parentElement = parent);
};

const marker = div(false);
const inner = div(false);
const shell = div(false);
const contentRoot = div(false);

append(inner, div(false), marker, div(false));
append(shell, inner);
append(contentRoot, shell, div(true));

assert.equal(context.findShell(marker), shell);

const footnoteAd = div(false);
const footnoteParent = div(false);

append(footnoteParent, footnoteAd, div(true));
assert.equal(context.findShell(footnoteAd), footnoteAd);

const dynamicMount = div(false);
const dynamicInner = div(false);
const dynamicShell = div(false);

dynamicMount.id = 'D7K0QpZo0_2';
dynamicMount.attributes = [{ name: 'data-v-fe45698a' }];
dynamicInner.attributes = [{ name: 'data-v-fe45698a' }];
append(dynamicInner, dynamicMount);
append(dynamicShell, dynamicInner);

assert.equal(context.isAdMarker(dynamicMount), true);

assert.doesNotThrow(() => new Function(source));
assert.match(source, /\/\/ @version      2\.9\.3/);
assert.match(source, /style\.color\.startsWith\('rgba\('\)/);
assert.match(
  source,
  /style\.setProperty\('display', 'none', 'important'\)/
);
assert.doesNotMatch(
  source,
  /setTimeout|setInterval|getBoundingClientRect|routeKey/
);
