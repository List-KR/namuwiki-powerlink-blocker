// ==UserScript==
// @name         NamuWiki PowerLink Blocker
// @namespace    List-KR
// @version      3.0.0
// @description  Block NamuWiki PowerLink
// @match        https://namu.wiki/*
// @updateURL    https://raw.githubusercontent.com/List-KR/namuwiki-powerlink-blocker/refs/heads/main/namuwiki-powerlink-blocker.user.js
// @downloadURL  https://raw.githubusercontent.com/List-KR/namuwiki-powerlink-blocker/refs/heads/main/namuwiki-powerlink-blocker.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  // Detection relies on what an ad has to be, not on how the frontend draws
  // it. Class names, inline styles, labels and nesting have all changed
  // between releases; these properties have not:
  //
  // 1. PowerLink must show each advertiser's display URL, but its links
  //    pose as section anchors (href="#s-N") so the real target stays out
  //    of the DOM. A wiki link that shows a domain navigates to it.
  // 2. Ad networks name their own containers; the wiki cannot rename them.
  // 3. An unfilled slot reserves its height with min-height.

  // Wiki-authored structure that never sits inside an ad. Tables and images
  // are left out on purpose: PowerLink imitates both.
  const wikiContent =
    'article,main,header,footer,nav,aside,h1,h2,h3,h4,h5,h6,' +
    'p,blockquote,ul,ol,dl,pre,time,form,input,textarea,select,button,' +
    'video,audio,canvas';

  const media = 'img,picture,svg,video,audio,canvas,iframe,object,embed';

  const networkAd =
    '[id^="google_ads_iframe_"],ins.adsbygoogle,' +
    '.vm-placement,.vm-dynamic-placement';

  // Cards also fake links with non-anchor elements that carry an href.
  const linkSelector = 'a,[href]';

  const seedSelector = linkSelector + ',div,' + networkAd;

  const displayUrl =
    /^(?:https?:\/\/)?((?:[\p{L}\p{N}-]+\.)+\p{L}{2,})(?::\d+)?(?:[/?#]\S*)?$/u;

  // Ad slots reserve 90-300px; page layout containers reserve far more.
  const slotMinHeight = 30;
  const slotMaxHeight = 400;

  const hiddenShells = new Map();

  // While parsing, an element with no following sibling anywhere up its
  // chain may still receive children; judging it now could swallow content
  // that has not arrived yet.
  function isSettled(el) {
    if (document.readyState !== 'loading')
      return true;

    for (let node = el; node; node = node.parentNode) {
      if (node.nextSibling)
        return true;
    }

    return false;
  }

  // A link that stays on this document: no href, a fragment, javascript:,
  // or the current URL itself.
  function isInertLink(el) {
    if (el.localName !== 'a' && !el.hasAttribute('href'))
      return false;

    const href = el.getAttribute('href')?.trim();
    if (!href || href.startsWith('#') || /^javascript:/i.test(href))
      return true;

    let url;
    try {
      url = new URL(href, location.href);
    } catch {
      return false;
    }

    return url.origin === location.origin &&
      url.pathname === location.pathname &&
      url.search === location.search;
  }

  // The wiki's own host is never an advertiser.
  function getDisplayHost(text) {
    const host = displayUrl.exec(text)?.[1].toLowerCase();
    return host && host !== location.hostname &&
      !host.endsWith('.' + location.hostname) ? host : null;
  }

  const isAdLink = el =>
    isInertLink(el) && !!getDisplayHost(el.textContent.trim());

  // Wiki prose carries text outside inert links; ad cards carry none.
  function hasForeignText(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.data.trim())
        continue;

      const link = node.parentElement.closest(linkSelector);
      if (!link || !isInertLink(link))
        return true;
    }

    return false;
  }

  function hasNavigatingLink(root) {
    for (const link of root.querySelectorAll(linkSelector)) {
      if (!isInertLink(link))
        return true;
    }

    return false;
  }

  // The largest ancestor that is still nothing but inert links.
  function findAdRoot(link) {
    let root = link;

    for (let parent = link.parentElement;
      parent && parent !== document.body && isSettled(parent);
      parent = parent.parentElement) {
      if (parent.matches(wikiContent) || parent.querySelector(wikiContent) ||
        hasForeignText(parent) || hasNavigatingLink(parent))
        break;

      root = parent;
    }

    return root;
  }

  // A lone link is a honeypot; a card pairs its display URL with title and
  // description links.
  function isAdRoot(root) {
    let textLinks = 0;
    let urlLinks = 0;

    for (const link of root.querySelectorAll(linkSelector)) {
      if (!isInertLink(link))
        continue;

      const text = link.textContent.trim();
      if (text)
        textLinks++;
      if (getDisplayHost(text))
        urlLinks++;
    }

    return urlLinks > 0 && textLinks >= 2;
  }

  // GPT nests its iframe container inside the publisher's slot element.
  function findNetworkRoot(el) {
    let gpt = null;

    for (let node = el; node; node = node.parentElement) {
      if (node.id.startsWith('google_ads_iframe_'))
        gpt = node;
    }

    return gpt ? gpt.parentElement : el;
  }

  function isReservedSlot(el) {
    if (el.localName !== 'div' || el.querySelector(':not(div)') ||
      el.textContent.trim() || !isSettled(el))
      return false;

    const style = getComputedStyle(el);
    const minHeight = parseFloat(style.minHeight);

    // Backgrounds and pseudo-elements can draw content into an empty box.
    return style.minHeight.endsWith('px') &&
      minHeight >= slotMinHeight && minHeight <= slotMaxHeight &&
      style.backgroundImage === 'none' &&
      ['::before', '::after'].every(pseudo =>
        ['none', 'normal', '""', "''"].includes(
          getComputedStyle(el, pseudo).content));
  }

  const isBlank = el =>
    !el.matches(media) && !el.matches(wikiContent) &&
    !el.querySelector(media) && !el.querySelector(wikiContent) &&
    !el.textContent.trim();

  // Wrappers around an ad keep its margins and min-height. Climb while
  // everything beside it is blank, decoy siblings included.
  function findShell(root) {
    let shell = root;

    for (let parent = root.parentElement;
      parent && parent !== document.body && isSettled(parent);
      parent = parent.parentElement) {
      if (parent.matches(wikiContent) ||
        [...parent.childNodes].some(node => node !== shell &&
          (node.nodeType === Node.TEXT_NODE ? node.data.trim() :
            node.nodeType === Node.ELEMENT_NODE && !isBlank(node))))
        break;

      shell = parent;
    }

    return shell;
  }

  function shellFor(el) {
    if (!el.isConnected)
      return null;

    if (el.matches(networkAd))
      return findShell(findNetworkRoot(el));

    if (isAdLink(el)) {
      const root = findAdRoot(el);
      return isAdRoot(root) ? findShell(root) : null;
    }

    return isReservedSlot(el) ? findShell(el) : null;
  }

  const isHiddenByUs = el =>
    el.style.getPropertyValue('display') === 'none' &&
    el.style.getPropertyPriority('display') === 'important';

  function hide(shell, marker) {
    let state = hiddenShells.get(shell);

    if (!state) {
      state = {
        value: shell.style.getPropertyValue('display'),
        priority: shell.style.getPropertyPriority('display'),
        markers: new Set()
      };
      hiddenShells.set(shell, state);
    }

    state.markers.add(marker);

    if (!isHiddenByUs(shell))
      shell.style.setProperty('display', 'none', 'important');
  }

  // A partial parse or a reused component can make an earlier verdict
  // stale: restore every shell that none of its markers resolves to.
  function recheck() {
    for (const [shell, state] of hiddenShells) {
      for (const marker of state.markers) {
        if (shellFor(marker) !== shell)
          state.markers.delete(marker);
      }

      if (state.markers.size)
        continue;

      if (isHiddenByUs(shell)) {
        if (state.value)
          shell.style.setProperty('display', state.value, state.priority);
        else
          shell.style.removeProperty('display');
      }

      hiddenShells.delete(shell);
    }
  }

  function check(el, seen) {
    if (seen.has(el))
      return;

    seen.add(el);

    const shell = shellFor(el);
    if (shell)
      hide(shell, el);
  }

  function scan(root, seen) {
    if (root.nodeType !== Node.ELEMENT_NODE)
      return;

    check(root, seen);
    root.querySelectorAll(seedSelector).forEach(el => check(el, seen));
  }

  // Text, attribute and removal changes can turn an ancestor into a seed:
  // a link gains its display URL, a slot loses its last child.
  function scanAncestors(node, seen) {
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;

    for (let i = 0; el && i < 8; i++, el = el.parentElement)
      check(el, seen);
  }

  function onMutations(records) {
    recheck();

    const seen = new Set();

    for (const record of records) {
      scanAncestors(record.target, seen);
      record.addedNodes.forEach(node => scan(node, seen));
    }
  }

  function rescan() {
    recheck();

    const seen = new Set();
    document.querySelectorAll(seedSelector).forEach(el => check(el, seen));
  }

  new MutationObserver(onMutations).observe(document, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['id', 'class', 'style', 'href']
  });

  rescan();
  // Verdicts deferred on still-open nodes are settled once parsing ends.
  document.addEventListener('DOMContentLoaded', rescan);
})();
