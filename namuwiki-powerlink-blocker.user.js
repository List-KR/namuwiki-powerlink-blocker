// ==UserScript==
// @name         NamuWiki PowerLink Blocker
// @namespace    List-KR
// @version      1.2.0
// @description  Block NamuWiki PowerLink on SSR/CSR without relying on obfuscated class names
// @match        https://namu.wiki/*
// @updateURL    https://raw.githubusercontent.com/List-KR/namuwiki-powerlink-blocker/refs/heads/main/namuwiki-powerlink-blocker.user.js
// @downloadURL  https://raw.githubusercontent.com/List-KR/namuwiki-powerlink-blocker/refs/heads/main/namuwiki-powerlink-blocker.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const HOOKED = Symbol.for('namu.powerlink.blocker.hooked');

    /*
     * ============================================================
     * 1. CSR: Vuex commit에 들어오는 PowerLink 데이터 차단
     * ============================================================
     *
     * 확인된 pd 구조:
     *
     * JSON string:
     * [
     *   [ 광고 데이터, "!/jump/...", 업체명, 도메인, ... ],
     *   [ "//i.namu.wiki/i/...", ... ]
     * ]
     *
     * pd라는 key 이름에는 의존하지 않는다.
     */

    function isPowerLinkData(value) {
        if (typeof value !== 'string')
            return false;

        // 빠른 사전 필터
        if (
            !value.includes('!/jump/') ||
            !value.includes('//i.namu.wiki/i/')
        ) {
            return false;
        }

        try {
            const data = JSON.parse(value);

            if (
                !Array.isArray(data) ||
                data.length !== 2 ||
                !Array.isArray(data[0]) ||
                !Array.isArray(data[1])
            ) {
                return false;
            }

            const hasJump =
                JSON.stringify(data[0]).includes('!/jump/');

            const hasAssets =
                data[1].some(x =>
                    typeof x === 'string' &&
                    x.startsWith('//i.namu.wiki/i/')
                );

            return hasJump && hasAssets;

        } catch {
            return false;
        }
    }


    function scrubPowerLink(obj, seen = new WeakSet()) {
        if (
            !obj ||
            typeof obj !== 'object' ||
            seen.has(obj)
        ) {
            return;
        }

        seen.add(obj);

        for (const key of Object.keys(obj)) {
            let value;

            try {
                value = obj[key];
            } catch {
                continue;
            }

            if (isPowerLinkData(value)) {
                console.debug(
                    '[PowerLink] payload blocked:',
                    key
                );

                // 자료형은 string 그대로 유지
                obj[key] = '[[],[]]';
                continue;
            }

            if (value && typeof value === 'object') {
                scrubPowerLink(value, seen);
            }
        }
    }


    /*
     * ============================================================
     * 2. Vuex store hook
     * ============================================================
     */

    function getStore() {
        return document
            .querySelector('#app')
            ?.__vue_app__
            ?.config
            ?.globalProperties
            ?.$store;
    }


    function hookStore(store) {
        if (!store || store[HOOKED])
            return;

        Object.defineProperty(store, HOOKED, {
            value: true,
            configurable: false
        });

        const originalCommit = store.commit;

        store.commit = function(type, payload, ...args) {
            // updateAsyncData → commit 직전에 광고 데이터 제거
            scrubPowerLink(payload);

            return originalCommit.call(
                this,
                type,
                payload,
                ...args
            );
        };

        console.debug(
            '[PowerLink] Vuex commit blocker installed'
        );
    }


    /*
     * ============================================================
     * 3. DOM 공통 유틸
     * ============================================================
     */

    const DOMAIN_RE =
        /^(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?$/i;


    function isEmptySpacer(el) {
        return (
            el instanceof HTMLDivElement &&
            el.childElementCount === 0 &&
            el.textContent.trim() === ''
        );
    }


    /*
     * 절대로 parent.remove() 하지 않는다.
     *
     * PowerLink 자신만 숨기고,
     * 바로 양옆이 완전히 빈 div일 경우에만 같이 숨긴다.
     */
    function hideBlock(el) {
        if (!(el instanceof HTMLElement))
            return;

        if (el.dataset.powerlinkHidden === '1')
            return;

        el.dataset.powerlinkHidden = '1';

        el.style.setProperty(
            'display',
            'none',
            'important'
        );

        const prev = el.previousElementSibling;
        const next = el.nextElementSibling;

        if (isEmptySpacer(prev)) {
            prev.style.setProperty(
                'display',
                'none',
                'important'
            );
        }

        if (isEmptySpacer(next)) {
            next.style.setProperty(
                'display',
                'none',
                'important'
            );
        }
    }


    /*
     * ============================================================
     * 4. SSR: 이미 완성돼서 HTML에 박혀 온 PowerLink 탐지
     * ============================================================
     *
     * 확인된 특징:
     *
     * <div style="width: auto;">
     *   <table>
     *     ...
     *     <a href="#s-4">www.example.com</a>
     *
     * 화면에는 외부 도메인인데 실제 href는 내부 #s-*.
     *
     * 난독화 class 이름은 사용하지 않는다.
     */

    function isRenderedPowerLink(el) {
        if (!(el instanceof HTMLDivElement))
            return false;

        if (el.style.width !== 'auto')
            return false;

        // 바로 아래가 광고용 table
        const table =
            el.querySelector(':scope > table');

        if (!table)
            return false;

        const links =
            table.querySelectorAll('a[href^="#s-"]');

        let domainLinks = 0;

        for (const a of links) {
            const href =
                a.getAttribute('href') || '';

            const text =
                a.textContent.trim();

            if (
                /^#s-\d+(?:\.\d+)*$/.test(href) &&
                DOMAIN_RE.test(text)
            ) {
                domainLinks++;
            }
        }

        /*
         * 외부 도메인처럼 보이면서 #s-*로 향하는 링크가
         * 하나라도 있으면 PowerLink로 판정.
         *
         * width:auto + direct table 조건까지 같이 있으므로
         * 일반 문서 링크와 충돌 가능성은 낮음.
         */
        return domainLinks >= 1;
    }


    /*
     * ============================================================
     * 5. CSR skeleton 탐지
     * ============================================================
     *
     * 확인된 skeleton:
     *
     * <div style="width: auto;">
     *   <table>
     *     ...
     *     <img data-filesize data-doc>   // src 없음
     *     ...
     *   </table>
     * </div>
     *
     * 실제 확인된 skeleton에는 src 없는 이미지가 3개 존재.
     */

    function isPowerLinkSkeleton(el) {
        if (!(el instanceof HTMLDivElement))
            return false;

        if (el.style.width !== 'auto')
            return false;

        const table =
            el.querySelector(':scope > table');

        if (!table)
            return false;

        const missingImages =
            table.querySelectorAll(
                'img[data-filesize][data-doc]:not([src])'
            );

        if (missingImages.length < 3)
            return false;

        /*
         * skeleton에는 실제 텍스트 대신
         * 빈 placeholder div가 다수 존재.
         *
         * 오탐 방지용 추가 조건.
         */
        const emptyDivCount =
            [...table.querySelectorAll('div')]
                .filter(div =>
                    div.childElementCount === 0 &&
                    div.textContent.trim() === ''
                )
                .length;

        return emptyDivCount >= 6;
    }


    /*
     * ============================================================
     * 6. SSR/CSR DOM scan
     * ============================================================
     */

    function scanPowerLink(root = document) {
        const candidates = [];

        if (root instanceof HTMLDivElement) {
            candidates.push(root);
        }

        if (root?.querySelectorAll) {
            candidates.push(
                ...root.querySelectorAll(
                    'div[style]'
                )
            );
        }

        for (const el of candidates) {

            // 최초 SSR로 이미 완성돼 들어온 광고
            if (isRenderedPowerLink(el)) {
                console.debug(
                    '[PowerLink] SSR block hidden'
                );

                hideBlock(el);
                continue;
            }

            // CSR 중 잠깐 생성되는 skeleton
            if (isPowerLinkSkeleton(el)) {
                console.debug(
                    '[PowerLink] skeleton hidden'
                );

                hideBlock(el);
            }
        }
    }


    /*
     * ============================================================
     * 7. DOM observer
     * ============================================================
     */

    function startObserver() {
        if (!document.documentElement) {
            queueMicrotask(startObserver);
            return;
        }

        const observer =
            new MutationObserver(records => {

                for (const record of records) {
                    for (const node of record.addedNodes) {

                        if (
                            node.nodeType !==
                            Node.ELEMENT_NODE
                        ) {
                            continue;
                        }

                        scanPowerLink(node);
                    }
                }
            });

        observer.observe(
            document.documentElement,
            {
                childList: true,
                subtree: true
            }
        );

        /*
         * document-start 시점 이후 이미 들어온 SSR DOM도 검사.
         */
        scanPowerLink(document);
    }


    startObserver();


    /*
     * ============================================================
     * 8. DOMContentLoaded 후 SSR 전체 재검사
     * ============================================================
     *
     * MutationObserver 설치 전에 parser가 지나간 부분이나
     * hydration 타이밍 차이를 보완.
     */

    document.addEventListener(
        'DOMContentLoaded',
        () => {
            scanPowerLink(document);
        },
        { once: true }
    );


    /*
     * ============================================================
     * 9. Vue app/store 등장 대기
     * ============================================================
     *
     * 최초 SSR 시 Vue가 아직 mount 안 되었으므로
     * store가 생긴 뒤 commit hook을 설치한다.
     */

    const storeWatcher =
        setInterval(() => {

            const store = getStore();

            if (store) {
                hookStore(store);
            }

        }, 50);


    /*
     * 디버그용
     */
    console.debug(
        '[PowerLink] blocker bootstrap installed'
    );

})();
