// ==UserScript==
// @name         NamuWiki PowerLink Blocker
// @namespace    List-KR
// @version      2.7.1
// @description  Block NamuWiki PowerLink and mobile reserved ad slots
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
    const TIMEOUT = 8000;

    const timers = new Map();
    let rejected = new WeakSet();
    let scheduled = false;
    let lastURL = location.href;


    /*
     * ============================================================
     * CSS
     * ============================================================
     */

    function installCSS() {
        if (!document.documentElement ||
            document.getElementById('nwp-style'))
            return;

        const style = document.createElement('style');

        style.id = 'nwp-style';
        style.textContent = `
            /*
             * 실제 확인된 PowerLink.
             */
            div[style*="width:auto"]:has(
                > table a[href^="#s-"] img[data-doc][data-filesize]
            ),
            div[style*="width: auto"]:has(
                > table a[href^="#s-"] img[data-doc][data-filesize]
            ),

            /*
             * JS가 임시/확정 차단한 슬롯.
             */
            [${ATTR}] {
                display: none !important;
            }
        `;

        document.documentElement.appendChild(style);
    }


    /*
     * ============================================================
     * Helpers
     * ============================================================
     */

    const div = el =>
        el?.nodeType === 1 &&
        el.localName === 'div';

    const text = el =>
        String(el?.textContent || '')
            .replace(/\u00a0/g, '')
            .replace(/\s+/g, ' ')
            .trim();

    const cls = el =>
        el?.getAttribute?.('class')
            ?.trim()
            .replace(/\s+/g, ' ') || '';

    const domainRE =
        /(?:https?:\/\/|www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s]*)?/i;


    /*
     * ============================================================
     * Exact PowerLink
     * ============================================================
     */

    function isPowerLink(el) {
        if (!div(el) || el.style.width !== 'auto')
            return false;

        const table =
            [...el.children]
                .find(x => x.localName === 'table');

        return !!table?.querySelector(
            'a[href^="#s-"] img[data-doc][data-filesize]'
        );
    }


    function containsPowerLink(el) {
        if (isPowerLink(el))
            return true;

        return [...el.querySelectorAll?.('div[style]') || []]
            .some(isPowerLink);
    }


    /*
     * ============================================================
     * Slot state
     * ============================================================
     */

    function clearTimer(el) {
        const id = timers.get(el);

        if (id !== undefined) {
            clearTimeout(id);
            timers.delete(el);
        }
    }


    function confirm(el) {
        if (!el)
            return;

        clearTimer(el);
        el.setAttribute(ATTR, 'confirmed');
    }


    function provisional(el) {
        if (
            !el ||
            el.hasAttribute(ATTR) ||
            rejected.has(el)
        ) {
            return;
        }

        el.setAttribute(ATTR, 'temp');

        const id = setTimeout(() => {
            timers.delete(el);

            if (!el.isConnected)
                return;

            /*
             * PowerLink가 결국 들어왔으면 유지.
             */
            if (containsPowerLink(el)) {
                el.setAttribute(ATTR, 'confirmed');
                return;
            }

            /*
             * 아니면 복원하고 같은 route에서는 다시 안 건드림.
             */
            el.removeAttribute(ATTR);
            rejected.add(el);

        }, TIMEOUT);

        timers.set(el, id);
    }


    /*
     * ============================================================
     * PowerLink 등장 시 provisional slot 승격
     * ============================================================
     */

    function handlePowerLink(root) {
        /*
         * 먼저 이미 임시 차단해 둔 상위 광고 slot을 찾는다.
         */
        let el = root;

        for (let i = 0; el && i < 10; i++, el = el.parentElement) {
            if (el.getAttribute?.(ATTR) === 'temp') {
                confirm(el);
                return;
            }
        }


        if (!MOBILE)
            return;


        /*
         * Android에서 확인된:
         *
         * PowerLink
         *   -> 0px wrapper
         *   -> 약 208px reserved shell
         */
        const inner = root.parentElement;
        const shell = inner?.parentElement;

        if (!div(inner) || !div(shell))
            return;

        if (
            shell === document.body ||
            shell === document.documentElement ||
            shell.id === 'app'
        ) {
            return;
        }

        const sr = shell.getBoundingClientRect();
        const ir = inner.getBoundingClientRect();

        if (
            sr.height < 140 ||
            sr.height > 340 ||
            sr.width < innerWidth * .65 ||
            ir.height > 12 ||
            shell.children.length > 10
        ) {
            return;
        }

        /*
         * PowerLink 경로 외의 자식이 실질적 공간을 쓰면
         * shell 전체는 건드리지 않는다.
         */
        for (const child of shell.children) {
            if (
                child !== inner &&
                child.getBoundingClientRect().height > 12
            ) {
                return;
            }
        }

        confirm(shell);
    }


    /*
     * ============================================================
     * Mobile reserved-slot detection
     * ============================================================
     */

    function mobileGeometry(el) {
        if (!MOBILE || !div(el))
            return false;

        const parent = el.parentElement;

        if (!parent)
            return false;

        const r = el.getBoundingClientRect();
        const p = parent.getBoundingClientRect();

        if (
            r.width <= 0 ||
            r.height <= 0 ||
            p.width <= 0
        ) {
            return false;
        }

        const ratio = r.height / r.width;

        return (
            r.width >= p.width * .90 &&
            r.width >= innerWidth * .68 &&
            r.height >= 165 &&
            r.height <= 300 &&
            ratio >= .47 &&
            ratio <= .78
        );
    }


    /*
     * 정상 나무위키 본문으로 보이면 후보에서 제외.
     *
     * 광고를 놓치는 쪽을 선호한다.
     */
    function adLike(el) {
        if (containsPowerLink(el))
            return true;

        if (
            el.querySelector(
                'article,main,h1,h2,h3,h4,h5,h6,' +
                'p,blockquote,ul,ol,pre,table,time,' +
                'form,input,textarea,select'
            )
        ) {
            return false;
        }

        /*
         * 일반 나무위키 이미지/임베드 보호.
         */
        if (
            el.querySelector(
                'figure,picture,video,audio,canvas,' +
                'img[data-doc],img[data-filesize]'
            )
        ) {
            return false;
        }

        const t = text(el);

        return (
            t === '' ||
            (
                t.length <= 700 &&
                domainRE.test(t)
            )
        );
    }


    /*
     * 검은 surface를 감싸는 같은 크기의 wrapper까지 승격.
     */
    function slotShell(el) {
        let current = el;

        for (let i = 0; i < 4; i++) {
            const parent = current.parentElement;

            if (
                !div(parent) ||
                parent === document.body ||
                parent === document.documentElement ||
                parent.id === 'app'
            ) {
                break;
            }

            const a = current.getBoundingClientRect();
            const b = parent.getBoundingClientRect();

            if (
                Math.abs(a.width - b.width) > 20 ||
                Math.abs(a.height - b.height) > 32
            ) {
                break;
            }

            let occupied = false;

            for (const child of parent.children) {
                if (child === current)
                    continue;

                const r = child.getBoundingClientRect();

                if (
                    (r.width > 20 && r.height > 20) ||
                    text(child)
                ) {
                    occupied = true;
                    break;
                }
            }

            if (occupied)
                break;

            current = parent;
        }

        return current;
    }


    function meaningful(el) {
        return !!el && (
            text(el).length >= 4 ||
            !!el.querySelector?.(
                'h1,h2,h3,h4,h5,h6,p,blockquote,ul,ol,table'
            )
        );
    }


    function neighbor(el, dir) {
        for (let i = 0; el && i < 8; i++) {
            if (
                !el.hasAttribute?.(ATTR) &&
                meaningful(el)
            ) {
                return el;
            }

            el =
                dir < 0
                    ? el.previousElementSibling
                    : el.nextElementSibling;
        }

        return null;
    }


    /*
     * ============================================================
     * Mobile scan
     * ============================================================
     */

    function scanMobileSlots() {
        if (!MOBILE)
            return;

        const candidates = [];
        const seen = new Set();


        for (const surface of document.querySelectorAll('div')) {
            if (
                surface.closest(`[${ATTR}]`) ||
                !mobileGeometry(surface) ||
                !adLike(surface)
            ) {
                continue;
            }

            const shell = slotShell(surface);

            if (seen.has(shell))
                continue;

            seen.add(shell);

            candidates.push({
                shell,
                parent: shell.parentElement,
                signature: cls(shell)
            });
        }


        /*
         * 같은 parent + 같은 class의 후보가 반복되면
         * Android에서 확인된 강한 광고 패턴.
         *
         * 바로 sticky 확정.
         */
        const groups = new Map();

        for (const c of candidates) {
            if (!c.parent || !c.signature)
                continue;

            let byClass = groups.get(c.parent);

            if (!byClass)
                groups.set(c.parent, byClass = new Map());

            let group = byClass.get(c.signature);

            if (!group)
                byClass.set(c.signature, group = []);

            group.push(c);
        }


        const confirmed = new Set();

        for (const byClass of groups.values()) {
            for (const group of byClass.values()) {
                if (group.length < 2)
                    continue;

                for (const { shell } of group) {
                    confirm(shell);
                    confirmed.add(shell);
                }
            }
        }


        /*
         * 단독 검은 박스는 일단 임시 차단.
         *
         * 실제 PowerLink가 들어오면 confirmed.
         * 8초 동안 안 들어오면 복원.
         */
        for (const { shell } of candidates) {
            if (
                confirmed.has(shell) ||
                shell.hasAttribute(ATTR)
            ) {
                continue;
            }

            if (
                !neighbor(
                    shell.previousElementSibling,
                    -1
                ) ||
                !neighbor(
                    shell.nextElementSibling,
                    1
                )
            ) {
                continue;
            }

            provisional(shell);
        }
    }


    /*
     * ============================================================
     * Scan
     * ============================================================
     */

    function scan() {
        try {
            /*
             * exact PowerLink는 CSS가 이미 가리지만,
             * 모바일 shell/provisional 승격을 위해 찾는다.
             */
            for (
                const el of
                document.querySelectorAll('div[style]')
            ) {
                if (isPowerLink(el))
                    handlePowerLink(el);
            }

            scanMobileSlots();

        } catch (e) {
            console.error(
                '[PowerLink] scan failed safely:',
                e
            );
        }
    }


    function schedule() {
        if (scheduled)
            return;

        scheduled = true;

        setTimeout(() => {
            scheduled = false;
            scan();
        }, 80);
    }


    /*
     * ============================================================
     * ResizeObserver
     * ============================================================
     *
     * 검은 slot이 0px -> 200~250px로 늦게 커지는 경우.
     */

    const observed = new WeakSet();

    const resizeObserver =
        MOBILE && typeof ResizeObserver === 'function'
            ? new ResizeObserver(schedule)
            : null;


    function observeWideDivs() {
        if (!resizeObserver)
            return;

        let count = 0;

        for (const el of document.querySelectorAll('div')) {
            if (
                count >= 600 ||
                observed.has(el)
            ) {
                continue;
            }

            const parent = el.parentElement;

            if (!parent)
                continue;

            const r = el.getBoundingClientRect();
            const p = parent.getBoundingClientRect();

            if (
                p.width < innerWidth * .65 ||
                (
                    r.width > 0 &&
                    r.width < p.width * .80
                )
            ) {
                continue;
            }

            observed.add(el);
            resizeObserver.observe(el);

            count++;
        }
    }


    /*
     * ============================================================
     * Bootstrap
     * ============================================================
     */

    function start() {
        installCSS();

        new MutationObserver(() => {
            observeWideDivs();
            schedule();
        }).observe(
            document.documentElement,
            {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: [
                    'style',
                    'href',
                    'src',
                    'data-src',
                    'data-doc',
                    'data-filesize'
                ]
            }
        );

        observeWideDivs();
        schedule();
    }


    if (document.documentElement) {
        start();
    } else {
        const boot =
            new MutationObserver(() => {
                if (!document.documentElement)
                    return;

                boot.disconnect();
                start();
            });

        boot.observe(
            document,
            {
                childList: true,
                subtree: true
            }
        );
    }


    /*
     * ============================================================
     * Slow fallback
     * ============================================================
     */

    if (MOBILE) {
        setInterval(() => {
            observeWideDivs();
            schedule();
        }, 1200);
    }


    /*
     * ============================================================
     * CSR route change
     * ============================================================
     */

    setInterval(() => {
        if (location.href === lastURL)
            return;

        lastURL = location.href;


        /*
         * 이전 route의 timer 종료.
         */
        for (const id of timers.values())
            clearTimeout(id);

        timers.clear();


        /*
         * 이전 route의 차단 mark 전부 해제.
         */
        document
            .querySelectorAll(`[${ATTR}]`)
            .forEach(el =>
                el.removeAttribute(ATTR)
            );


        /*
         * timeout 후 복원된 후보 기록도 새 route에서는 초기화.
         */
        rejected =
            new WeakSet();


        schedule();

    }, 500);

})();
