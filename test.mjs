import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(
    new URL('./namuwiki-powerlink-blocker.user.js', import.meta.url),
    'utf8'
).replace(
    '    function handlePowerLink(root) {',
    '    globalThis.findAdShell = findAdShell; return;\n\n' +
    '    function handlePowerLink(root) {'
);
const context = {
    document: { body: {}, documentElement: {} },
    location: { pathname: '/', search: '' },
    navigator: { userAgent: '' }
};

vm.runInNewContext(source, context);

const div = text => ({
    nodeType: 1,
    localName: 'div',
    attributes: [{ name: 'data-v-deadbeef' }],
    children: [],
    parentElement: null,
    textContent: text,
    hasAttribute: name => name === 'data-v-deadbeef',
    matches: () => false,
    querySelector: () => null
});
const append = (parent, ...children) => {
    parent.children.push(...children);
    children.forEach(child => child.parentElement = parent);
};
const ad = div('ad');
const adShell = div('');
const footnotes = div('footnote');
const articleFooter = div('');

append(adShell, div(''), ad, div(''));
append(articleFooter, div(''), adShell, div(''), footnotes);

assert.equal(context.findAdShell(ad), adShell);
