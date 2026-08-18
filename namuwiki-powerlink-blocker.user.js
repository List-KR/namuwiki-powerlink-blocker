// ==UserScript==
// @name         NamuWiki PowerLink Blocker
// @namespace    List-KR
// @version      2.8.0
// @description  Block NamuWiki PowerLink and reserved ad slots
// @match        https://namu.wiki/*
// @updateURL    https://raw.githubusercontent.com/List-KR/namuwiki-powerlink-blocker/refs/heads/main/namuwiki-powerlink-blocker.user.js
// @downloadURL  https://raw.githubusercontent.com/List-KR/namuwiki-powerlink-blocker/refs/heads/main/namuwiki-powerlink-blocker.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const MOBILE =
        navigator.userAgentData?.mobile === true ||
        /Android|Mobile|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const ATTR = 'data-nwp';
    const pending = new Set();
    const protectedContent =
        'article,main,h1,h2,h3,h4,h5,h6,' +
        'p,blockquote,ul,ol,pre,table,time,' +
        'form,input,textarea,select,' +
        'figure,picture,video,audio,canvas,' +
        'img[data-doc],img[data-filesize]';

    let timer = 0;
    let route = routeKey();


    const isDiv = el =>
        el?.nodeType === 1 && el.localName === 'div';

    const cleanText = el =>
        String(el?.textContent || '')
            .replace(/\u00a0/g, '')
            .replace(/\s+/g, ' ')
            .trim();

    function routeKey() {
        return location.pathname + location.search;
    }


    function installCSS() {
        const style = document.createElement('style');

        style.id = 'nwp-style';
        style.textContent = `
            div[style*="width:auto"]:has(
                > table a[href^="#s-"] img[data-doc][data-filesize]
            ),
            div[style*="width: auto"]:has(
                > table a[href^="#s-"] img[data-doc][data-filesize]
            ),
            [${ATTR}] {
                display: none !important;
            }
        `;

        document.documentElement.appendChild(style);
    }


    function isPowerLink(el) {
        if (!isDiv(el) || el.style.width !== 'auto')
            return false;

        const table = [...el.children]
            .find(child => child.localName === 'table');

        return !!table?.querySelector(
            'a[href^="#s-"] img[data-doc][data-filesize]'
        );
    }


    function mobileGeometry(el, rect = el.getBoundingClientRect()) {
        const parentWidth = el.parentElement
            ?.getBoundingClientRect().width || 0;
        const ratio = rect.height / rect.width;

        return (
            rect.width >= parentWidth * .90 &&
            rect.width >= innerWidth * .68 &&
            rect.height >= 165 &&
            rect.height <= 300 &&
            ratio >= .47 &&
            ratio <= .78
        );
    }


    function isReservedSlot(el) {
        if (!isDiv(el) ||
            el.hasAttribute(ATTR) ||
            el.childElementCount > 12 ||
            cleanText(el) ||
            el.querySelector(protectedContent))
            return false;

        const rect = el.getBoundingClientRect();

        if (MOBILE)
            return mobileGeometry(el, rect);

        const minHeight = Number.parseFloat(
            getComputedStyle(el).minHeight
        );

        return (
            rect.width >= 600 &&
            rect.height >= 80 &&
            rect.height <= 110 &&
            rect.width / rect.height >= 6 &&
            Number.isFinite(minHeight) &&
            Math.abs(minHeight - rect.height) <= 2
        );
    }


    function hide(el) {
        el?.setAttribute(ATTR, '');
    }


    function handlePowerLink(root) {
        if (!MOBILE)
            return;

        let path = root;
        let shell = null;

        for (let i = 0; i < 8; i++) {
            for (const sibling of [
                path.previousElementSibling,
                path.nextElementSibling
            ]) {
                if (isReservedSlot(sibling))
                    hide(sibling);
            }

            const parent = path.parentElement;

            if (!isDiv(parent) ||
                parent === document.body ||
                parent === document.documentElement ||
                parent.id === 'app')
                break;

            let occupied = false;

            for (const child of parent.children) {
                if (child === path)
                    continue;

                const rect = child.getBoundingClientRect();

                if ((rect.width > 20 && rect.height > 12) || cleanText(child)) {
                    occupied = true;
                    break;
                }
            }

            if (occupied)
                break;

            const rect = parent.getBoundingClientRect();

            if (rect.height >= 140 &&
                rect.height <= 340 &&
                rect.width >= innerWidth * .65 &&
                parent.children.length <= 12)
                shell = parent;

            path = parent;
        }

        hide(shell);
    }


    function scan(el) {
        if (!el.isConnected)
            return;

        if (isPowerLink(el))
            handlePowerLink(el);

        if (!el.closest(`[${ATTR}]`) && isReservedSlot(el))
            hide(el);
    }


    function addAncestors(node) {
        let el = node?.parentElement;

        for (let i = 0; el && i < 10; i++, el = el.parentElement) {
            if (isDiv(el))
                pending.add(el);
        }
    }


    function addTree(node) {
        if (node?.nodeType !== 1)
            return;

        if (isDiv(node))
            pending.add(node);

        node.querySelectorAll('div')
            .forEach(el => pending.add(el));
        addAncestors(node);
    }


    function flush() {
        timer = 0;

        const elements = [...pending];
        pending.clear();

        for (const el of elements)
            scan(el);
    }


    function schedule() {
        if (!timer)
            timer = setTimeout(flush, 80);
    }


    function resetRoute() {
        const current = routeKey();

        if (current === route)
            return;

        route = current;
        document.querySelectorAll(`[${ATTR}]`)
            .forEach(el => el.removeAttribute(ATTR));
        pending.clear();
        addTree(document.documentElement);
    }


    function onMutations(records) {
        resetRoute();

        for (const record of records) {
            if (record.target.nodeType === 1) {
                if (isDiv(record.target))
                    pending.add(record.target);

                addAncestors(record.target);
            }

            if (record.type === 'attributes') {
                const root = record.target.closest?.(
                    'div[style*="width"]'
                );

                if (root)
                    pending.add(root);

                continue;
            }

            for (const node of record.addedNodes)
                addTree(node);
        }

        schedule();
    }


    function start() {
        installCSS();
        new MutationObserver(onMutations).observe(
            document.documentElement,
            {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: [
                    'style',
                    'href',
                    'data-doc',
                    'data-filesize'
                ]
            }
        );
        addTree(document.documentElement);
        schedule();
    }


    if (document.documentElement) {
        start();
    } else {
        const observer = new MutationObserver(() => {
            if (!document.documentElement)
                return;

            observer.disconnect();
            start();
        });

        observer.observe(document, { childList: true, subtree: true });
    }
})();
