// ==UserScript==
// @name         NamuWiki PowerLink Blocker
// @namespace    List-KR
// @version      2.9.8
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
    'article,main,header,footer,nav,aside,h1,h2,h3,h4,h5,h6,' +
    'p,blockquote,ul,ol,pre,table,time,' +
    'form,input,textarea,select,' +
    'figure,picture,video,audio,canvas,iframe,object,embed,' +
    'img[data-doc],img[data-filesize],[id]';

  const isDiv = el =>
    el?.nodeType === 1 && el.localName === 'div';

  const hasProtectedContent = el =>
    el.matches(protectedContent) ||
    el.querySelector(protectedContent);

  const knownAdShells = new WeakSet();
  const hiddenShells = new Map();

  const getScopes = el => [...el.attributes]
    .map(attr => attr.name)
    .filter(name => /^data-v-[0-9a-f]+$/i.test(name));

  const hasDirectText = el => [...el.childNodes].some(node =>
    node.nodeType === 3 && node.textContent.trim());

  function isEmptyShell(el) {
    return !el.textContent.trim() &&
      !el.querySelector(':not(div)');
  }

  function isKnownEmptyAdShell(el) {
    return knownAdShells.has(el) && isEmptyShell(el);
  }

  function isEmptySectionSlot(el) {
    // An unmounted component can leave only a Vue comment between article
    // sections. Infer that boundary from scope relationships, never hashes.
    if (el.id || el.hasAttribute('role') || el.hasAttribute('aria-label') ||
      el.hasAttribute('aria-labelledby') || el.childElementCount ||
      el.textContent.trim() ||
      ![...el.childNodes].some(node => node.nodeType === 8))
      return false;

    const parent = el.parentElement;
    const before = el.previousElementSibling;
    const after = el.nextElementSibling;
    if (!isDiv(parent) || !isDiv(before) || !isDiv(after) ||
      !before.textContent.trim() || !before.querySelector('a[href],p') ||
      !after.querySelector('h2,h3,h4,h5,h6'))
      return false;

    const scopes = getScopes(el);
    const articleScopes = getScopes(before).filter(scope =>
      after.hasAttribute(scope));
    if (!scopes.length || !articleScopes.length ||
      scopes.some(scope => parent.hasAttribute(scope) ||
        before.hasAttribute(scope) || after.hasAttribute(scope)))
      return false;

    // Pseudo-elements may contain actual labels or icons despite an empty DOM.
    return ['::before', '::after'].every(pseudo => {
      const content = getComputedStyle(el, pseudo).content;
      return content === 'none' || content === 'normal' ||
        content === '""' || content === "''";
    });
  }

  const isExplicitAdMount = el =>
    el.id.startsWith('_gad_') ||
    el.classList.contains('vm-dynamic-placement');

  function isDynamicAdMount(el) {
    const parent = el.parentElement;
    const shell = parent?.parentElement;

    return (
      /_\d+$/.test(el.id) &&
      !el.childElementCount &&
      !el.textContent.trim() &&
      isDiv(parent) &&
      parent.childElementCount === 1 &&
      isDiv(shell) &&
      shell.childElementCount === 1 &&
      [...el.attributes].some(attr =>
        /^data-v-[0-9a-f]+$/i.test(attr.name) &&
        parent.hasAttribute(attr.name))
    );
  }

  function isPowerLink(el) {
    if (el.querySelector(
      ':scope > div > table a[href^="#"] img[data-doc][data-filesize]'
    ) && [...el.children].some(header =>
      header.querySelector(':scope > div > span')?.textContent.trim() === '파워링크' &&
      [...header.querySelectorAll(':scope > span > a[href^="#"]')].some(link =>
        link.textContent.trim() === '광고등록')
    ))
      return true;

    // Image labels are shared by both table and div-based ads.
    return el.style.color.startsWith('rgba(') &&
      [...el.children].some(header =>
        header.querySelector(':scope > span > span > img[data-doc][data-filesize]') &&
        header.querySelector(':scope > span > a[href^="#"] img[data-doc][data-filesize]')
      ) && (
        el.querySelectorAll(':scope > div > table a[href^="#"]').length >= 3 ||
        [...el.querySelectorAll(':scope > div > div > div')].some(card =>
          card.querySelector(':scope > div > span > strong > a[title]') &&
          card.querySelectorAll(':scope > div > span > a[title]').length >= 2
        )
      );
  }

  function isAdMarker(el) {
    if (!isDiv(el))
      return false;

    if (isExplicitAdMount(el) || isPowerLink(el) ||
      isKnownEmptyAdShell(el) ||
      isEmptySectionSlot(el) ||
      (el.style.color.startsWith('rgba(') && !hasProtectedContent(el)) ||
      isDynamicAdMount(el))
      return true;

    if (el.style.width !== 'auto')
      return false;

    // In-article PowerLink slots are mounted empty and filled lazily; the
    // reserved min-height of their wrapper shows as a blank gap meanwhile.
    return isEmptyShell(el) || [...el.children].some(child =>
      child.localName === 'table' &&
      child.querySelector(
        'a[href^="#"] img[data-doc][data-filesize]'
      )
    );
  }

  // Wrappers whose only child is the ad still carry margins/min-height.
  function climbSingleChildWrappers(shell) {
    for (let i = 0; i < 8; i++) {
      const parent = shell.parentElement;

      if (!isDiv(parent) || parent.id ||
        parent.matches(protectedContent) || parent.hasAttribute('role') ||
        parent.childElementCount !== 1 || hasDirectText(parent))
        break;

      shell = parent;
    }

    return shell;
  }

  function findShell(root) {
    // Explicit markers must win over the generic /_\d+$/ heuristic.
    // _gad_inarticle_2 matches both, which previously left its outer shell.
    if (isExplicitAdMount(root) || isDynamicAdMount(root)) {
      const shell = climbSingleChildWrappers(root);
      knownAdShells.add(shell);
      return shell;
    }

    if (isKnownEmptyAdShell(root) || isEmptySectionSlot(root))
      return root;

    const scopes = getScopes(root);
    let shell = root;

    for (let i = 0; scopes.length && i < 8; i++) {
      const parent = shell.parentElement;

      if (!isDiv(parent) || parent.id ||
        parent.matches(protectedContent) || parent.hasAttribute('role') ||
        hasDirectText(parent) ||
        !scopes.some(scope => parent.hasAttribute(scope)) ||
        [...parent.children].some(child =>
          child !== shell &&
          (hasProtectedContent(child) || child.textContent.trim())))
        break;

      shell = parent;
    }

    // The scoped component sits inside unscoped layout wrappers
    // (e.g. mobile in-article slot: margin 16px + min-height 250px).
    shell = climbSingleChildWrappers(shell);
    knownAdShells.add(shell);
    return shell;
  }

  function hide(el, marker) {
    if (!el)
      return;

    if (!hiddenShells.has(el)) {
      hiddenShells.set(el, {
        value: el.style.getPropertyValue('display'),
        priority: el.style.getPropertyPriority('display'),
        markers: new Set()
      });
    }

    hiddenShells.get(el).markers.add(marker);

    if (el.style.getPropertyValue('display') === 'none' &&
      el.style.getPropertyPriority('display') === 'important')
      return;

    el.style.setProperty('display', 'none', 'important');
  }

  function recheckHiddenShells() {
    for (const [shell, state] of hiddenShells) {
      // A document-start scan can see a partially parsed layout. Restore
      // it if later content makes it no longer an ad-only wrapper.
      const stillAdOnly = shell.isConnected &&
        ((knownAdShells.has(shell) && isEmptyShell(shell)) ||
        [...state.markers].some(marker =>
          shell.contains(marker) && isAdMarker(marker) &&
          findShell(marker) === shell));

      if (stillAdOnly)
        continue;

      if (shell.style.getPropertyValue('display') === 'none' &&
        shell.style.getPropertyPriority('display') === 'important') {
        if (state.value)
          shell.style.setProperty('display', state.value, state.priority);
        else
          shell.style.removeProperty('display');
      }

      knownAdShells.delete(shell);
      hiddenShells.delete(shell);
    }
  }

  function scan(root) {
    if (!root?.querySelectorAll)
      return;

    if (isAdMarker(root))
      hide(findShell(root), root);

    root.querySelectorAll('div').forEach(el => {
      if (isAdMarker(el))
        hide(findShell(el), el);
    });
  }

  function scanAncestors(node) {
    let el = node?.parentElement;

    for (let i = 0; el && i < 10; i++, el = el.parentElement) {
      if (!isAdMarker(el))
        continue;

      hide(findShell(el), el);
      break;
    }
  }

  function onMutations(records) {
    recheckHiddenShells();

    for (const record of records) {
      if (record.type === 'attributes') {
        scan(record.target);
        scanAncestors(record.target);
        continue;
      }

      // childList fires for removals too: the target can now be an empty
      // ad shell even though addedNodes is empty.
      scan(record.target);
      scanAncestors(record.target);

      record.addedNodes.forEach(node => {
        scan(node);
        scanAncestors(node);
      });
    }
  }

  const observer = new MutationObserver(onMutations);

  observer.observe(document, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      'id',
      'class',
      'style',
      'href',
      'data-doc',
      'data-filesize'
    ]
  });

  scan(document.documentElement);
})();
