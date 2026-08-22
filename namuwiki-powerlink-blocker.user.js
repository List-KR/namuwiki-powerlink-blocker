// ==UserScript==
// @name         NamuWiki PowerLink Blocker
// @namespace    List-KR
// @version      2.9.2
// @description  Block NamuWiki PowerLink
// @match        https://namu.wiki/*
// @updateURL    https://raw.githubusercontent.com/List-KR/namuwiki-powerlink-blocker/refs/heads/main/namuwiki-powerlink-blocker.user.js
// @downloadURL  https://raw.githubusercontent.com/List-KR/namuwiki-powerlink-blocker/refs/heads/main/namuwiki-powerlink-blocker.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const protectedContent =
    'article,main,h1,h2,h3,h4,h5,h6,' +
    'p,blockquote,ul,ol,pre,table,time,' +
    'form,input,textarea,select,' +
    'figure,picture,video,audio,canvas,' +
    'img[data-doc],img[data-filesize],[id^="fn-"]';

  const isDiv = el =>
    el?.nodeType === 1 && el.localName === 'div';

  const hasProtectedContent = el =>
    el.matches(protectedContent) ||
    el.querySelector(protectedContent);

  function isDynamicAdMount(el) {
    const parent = el.parentElement;
    const shell = parent?.parentElement;

    return (
      /_\d+$/.test(el.id) &&
      !el.childElementCount &&
      isDiv(parent) &&
      parent.childElementCount === 1 &&
      isDiv(shell) &&
      shell.childElementCount === 1 &&
      [...el.attributes].some(attr =>
        /^data-v-[0-9a-f]+$/i.test(attr.name) &&
        parent.hasAttribute(attr.name))
    );
  }

  function isAdMarker(el) {
    if (!isDiv(el))
      return false;

    if (el.id.startsWith('_gad_') ||
      el.style.color.startsWith('rgba(') ||
      isDynamicAdMount(el))
      return true;

    if (el.style.width !== 'auto')
      return false;

    return [...el.children].some(child =>
      child.localName === 'table' &&
      child.querySelector(
        'a[href^="#s-"] img[data-doc][data-filesize]'
      )
    );
  }

  function findShell(root) {
    let shell = root;

    for (let i = 0; i < 8; i++) {
      const parent = shell.parentElement;

      if (!isDiv(parent) ||
        [...parent.children].some(child =>
          child !== shell && hasProtectedContent(child)))
        break;

      shell = parent;
    }

    return shell;
  }

  function hide(el) {
    if (!el ||
      (el.style.getPropertyValue('display') === 'none' &&
        el.style.getPropertyPriority('display') === 'important'))
      return;

    el.style.setProperty('display', 'none', 'important');
  }

  function scan(root) {
    if (!root?.querySelectorAll)
      return;

    if (isAdMarker(root))
      hide(findShell(root));

    root.querySelectorAll('div').forEach(el => {
      if (isAdMarker(el))
        hide(findShell(el));
    });
  }

  function onMutations(records) {
    for (const record of records) {
      if (record.type === 'attributes') {
        scan(record.target);
        continue;
      }

      record.addedNodes.forEach(scan);
    }
  }

  const observer = new MutationObserver(onMutations);

  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['id', 'style']
  });

  scan(document.documentElement);
})();
