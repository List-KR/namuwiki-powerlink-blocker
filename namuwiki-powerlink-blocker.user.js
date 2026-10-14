// ==UserScript==
// @name         NamuWiki PowerLink Blocker
// @namespace    List-KR
// @version      2.10.0
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
  const knownAdMarkers = new WeakSet();
  const hiddenShells = new Map();

  // While streaming-parsing, a node with no next sibling may still receive
  // children, so emptiness and single-child checks on it are not trustworthy.
  const isComplete = el =>
    document.readyState !== 'loading' || el.nextSibling !== null ||
    (!!el.parentNode && isComplete(el.parentNode));

  const adFill = 'iframe,ins,[id^="google_ads"],[id^="div-gpt"],' +
    '[class^="vm-"],a[href*="adcr.naver.com"],a[href*="searchad.naver.com"],' +
    'table a[href^="#"] img[data-doc][data-filesize]';

  const getScopes = el => [...el.attributes]
    .map(attr => attr.name)
    .filter(name => /^data-v-[0-9a-f]+$/i.test(name));

  const hasDirectText = el => [...el.childNodes].some(node =>
    node.nodeType === 3 && node.textContent.trim());

  // Wiki `#!wiki style` blocks carry plain text; ad slots carry link text only.
  const hasTextOutsideLinks = el => hasDirectText(el) ||
    [...el.querySelectorAll('*')].some(node =>
      !node.closest('a[href]') && hasDirectText(node));

  function isEmptyShell(el) {
    return !el.textContent.trim() &&
      !el.querySelector(':not(div)');
  }

  function isKnownEmptyAdShell(el) {
    return knownAdShells.has(el) && isEmptyShell(el);
  }

  const hasNoPseudoContent = el =>
    ['::before', '::after'].every(pseudo => {
      const content = getComputedStyle(el, pseudo).content;
      return content === 'none' || content === 'normal' ||
        content === '""' || content === "''";
    });

  function isEmptySectionSlot(el) {
    // An unmounted component can leave only a Vue comment between article
    // sections. Infer that boundary from scope relationships, never hashes.
    if (el.id || el.hasAttribute('role') || el.hasAttribute('aria-label') ||
      el.hasAttribute('aria-labelledby') || el.childElementCount ||
      el.textContent.trim() ||
      ![...el.childNodes].some(node => node.nodeType === 8))
      return false;

    const parent = el.parentElement;

    // The article component's own top slot: an empty wrapper directly under
    // <article>, sharing its scope, holding only the unmounted ad's comment.
    if (parent?.localName === 'article')
      return hasNoPseudoContent(el);

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
    return hasNoPseudoContent(el);
  }

  const isExplicitAdMount = el =>
    el.id.startsWith('_gad_') ||
    el.classList.contains('vm-dynamic-placement');

  function isDynamicAdMount(el) {
    const parent = el.parentElement;
    const shell = parent?.parentElement;

    // shortcut: a name blocklist for Vue mount points; replace with a
    // positive ad-slot pattern once the current id scheme is known.
    return (
      /_\d+$/.test(el.id) &&
      !/modal|toast|tooltip|popover|popper|teleport|dialog|menu|overlay/i
        .test(el.id) &&
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

  function isAdMarker(el) {
    if (!isDiv(el))
      return false;

    // A known marker stays one while empty or ad-filled; wiki content that
    // lands in a misjudged slot releases it.
    if (isExplicitAdMount(el) || (knownAdMarkers.has(el) &&
      (isEmptyShell(el) || el.querySelector(adFill))))
      return true;

    if (!isComplete(el))
      return false;

    if (isKnownEmptyAdShell(el) ||
      isEmptySectionSlot(el) ||
      (el.style.color.startsWith('rgba(') && !hasProtectedContent(el) &&
        !hasTextOutsideLinks(el)) ||
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

      if (!isDiv(parent) || !isComplete(parent) ||
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

      if (!isDiv(parent) || !isComplete(parent) ||
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
    // Markers stay markers once filled: an ad slot that loaded its ad must
    // not be restored because it is no longer empty.
    knownAdMarkers.add(marker);

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
        ((knownAdShells.has(shell) &&
          (isEmptyShell(shell) || shell.querySelector(adFill))) ||
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

    // Parser/hydration batches repeat the same target hundreds of times.
    // Scanning the target covers its added nodes and, via scanAncestors,
    // removals that left it empty.
    const targets = new Set(records.map(record => record.target));

    if (targets.size > 200) {
      scan(document.documentElement);
      return;
    }

    for (const target of targets) {
      scanAncestors(target);

      if (![...targets].some(other =>
        other !== target && other.contains(target)))
        scan(target);
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
  // Heuristics are suppressed on still-open nodes while parsing.
  document.addEventListener('DOMContentLoaded', () =>
    scan(document.documentElement));
})();
