// ==UserScript==
// @name         NamuWiki PowerLink Blocker
// @namespace    List-KR
// @version      2.4.0
// @description  Safely block NamuWiki PowerLink and mobile-UA reserved ad slots
// @match        https://namu.wiki/*
// @updateURL    https://raw.githubusercontent.com/List-KR/namuwiki-powerlink-blocker/refs/heads/main/namuwiki-powerlink-blocker.user.js
// @downloadURL  https://raw.githubusercontent.com/List-KR/namuwiki-powerlink-blocker/refs/heads/main/namuwiki-powerlink-blocker.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    /*
     * ============================================================
     * 0. Configuration
     * ============================================================
     */

    const DEBUG = false;

    const STYLE_ID =
        'namuwiki-powerlink-blocker-style';

    const ATTR_ROOT =
        'data-nwp-powerlink-root';

    const ATTR_SHELL =
        'data-nwp-powerlink-shell';

    const ATTR_MOBILE_SLOT =
        'data-nwp-mobile-ad-slot';


    function debug(...args) {
        if (DEBUG) {
            console.debug(
                '[PowerLink]',
                ...args
            );
        }
    }


    /*
     * ============================================================
     * 1. Mobile UA
     * ============================================================
     *
     * viewport가 아니라 UA를 기준으로 한다.
     *
     * 실제 확인:
     *
     * PC UA + mobile viewport
     *   → 예약공간 문제 없음
     *
     * Mobile UA
     *   → 208px / 250px 광고 예약공간 발생
     */

    function detectMobileUA() {
        try {
            if (
                navigator.userAgentData?.mobile === true
            ) {
                return true;
            }
        } catch {
            // ignored
        }

        const ua =
            String(navigator.userAgent || '');

        return (
            /Android|Mobile|iPhone|iPad|iPod/i
                .test(ua)
        );
    }


    const MOBILE_UA =
        detectMobileUA();


    /*
     * ============================================================
     * 2. DOM helpers
     * ============================================================
     */

    function isElement(node) {
        return (
            !!node &&
            node.nodeType === 1
        );
    }


    function isTag(node, tag) {
        return (
            isElement(node) &&
            node.localName === tag
        );
    }


    function isDiv(node) {
        return isTag(node, 'div');
    }


    function cleanText(text) {
        return String(text || '')
            .replace(/\u00a0/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }


    function numberFromCSS(value) {
        const n =
            Number.parseFloat(value);

        return Number.isFinite(n)
            ? n
            : 0;
    }


    function classSignature(el) {
        if (!isElement(el))
            return null;

        const value =
            el.getAttribute('class');

        if (!value)
            return null;

        const result =
            value
                .trim()
                .replace(/\s+/g, ' ');

        return result || null;
    }


    /*
     * ============================================================
     * 3. CSS
     * ============================================================
     */

    function installCSS() {
        if (!document.documentElement)
            return;

        if (
            document.getElementById(
                STYLE_ID
            )
        ) {
            return;
        }

        const style =
            document.createElement('style');

        style.id =
            STYLE_ID;

        style.textContent = `
            /*
             * 확인된 PowerLink 본체.
             *
             * PC / Mobile 공통.
             */
            div[style*="width:auto"]:has(
                > table
                a[href^="#s-"]
                img[data-doc][data-filesize]
            ),

            div[style*="width: auto"]:has(
                > table
                a[href^="#s-"]
                img[data-doc][data-filesize]
            ),

            /*
             * JS에서 확정한 요소.
             */
            [${ATTR_ROOT}="1"],
            [${ATTR_SHELL}="1"],
            [${ATTR_MOBILE_SLOT}="1"] {
                display: none !important;
            }
        `;

        document.documentElement
            .appendChild(style);

        debug(
            'CSS installed',
            {
                mobileUA: MOBILE_UA
            }
        );
    }


    /*
     * ============================================================
     * 4. Exact PowerLink
     * ============================================================
     *
     * 이것만 PowerLink의 확정 표식으로 사용.
     *
     * /jump/는 사용하지 않는다.
     */

    function getDirectTable(root) {
        if (!isElement(root))
            return null;

        for (
            const child of
            root.children
        ) {
            if (
                child.localName === 'table'
            ) {
                return child;
            }
        }

        return null;
    }


    function isExactPowerLinkRoot(root) {
        if (!isDiv(root))
            return false;

        if (
            !root.style ||
            root.style.width !== 'auto'
        ) {
            return false;
        }

        const table =
            getDirectTable(root);

        if (!table)
            return false;

        return !!table.querySelector(
            'a[href^="#s-"] ' +
            'img[data-doc][data-filesize]'
        );
    }


    function markExactPowerLink(root) {
        if (
            !isExactPowerLinkRoot(root)
        ) {
            return false;
        }

        if (
            root.getAttribute(
                ATTR_ROOT
            ) !== '1'
        ) {
            root.setAttribute(
                ATTR_ROOT,
                '1'
            );

            debug(
                'PowerLink confirmed',
                root
            );
        }

        return true;
    }


    /*
     * ============================================================
     * 5. Mobile 208px PowerLink shell
     * ============================================================
     *
     * Android 실측:
     *
     * PowerLink root
     *     ↓
     * 0px wrapper
     *     ↓
     * 208px reserved shell
     *
     * 본체를 숨겨도 이 shell의 min-height 때문에
     * 빈 공간이 남았음.
     */

    function getSafeMobileShell(root) {
        if (!MOBILE_UA)
            return null;

        if (
            !isExactPowerLinkRoot(root)
        ) {
            return null;
        }

        const inner =
            root.parentElement;

        const shell =
            inner?.parentElement;

        if (
            !isDiv(inner) ||
            !isDiv(shell)
        ) {
            return null;
        }


        /*
         * 최상위 layout 보호.
         */
        if (
            shell === document.body ||
            shell === document.documentElement ||
            shell.id === 'app'
        ) {
            return null;
        }


        if (
            root.parentElement !== inner ||
            inner.parentElement !== shell
        ) {
            return null;
        }


        const rect =
            shell.getBoundingClientRect();

        const style =
            getComputedStyle(shell);


        /*
         * 실제값 208px.
         * 일반 콘텐츠를 잡지 않도록 범위를 제한.
         */
        if (
            rect.height < 140 ||
            rect.height > 340
        ) {
            return null;
        }


        if (
            rect.width <
            window.innerWidth * 0.65
        ) {
            return null;
        }


        /*
         * 실제 shell direct children = 6.
         */
        if (
            shell.children.length > 10
        ) {
            return null;
        }


        /*
         * PowerLink를 담는 inner는 이미
         * 거의 0px이어야 한다.
         */
        const innerRect =
            inner.getBoundingClientRect();

        if (
            innerRect.height > 10
        ) {
            return null;
        }


        /*
         * PowerLink 경로 외의 다른 자식이
         * 실제 높이를 차지하면 parent를 숨기지 않는다.
         */
        for (
            const child of
            shell.children
        ) {
            if (child === inner)
                continue;

            const childRect =
                child.getBoundingClientRect();

            if (
                childRect.height > 10
            ) {
                return null;
            }
        }


        const minHeight =
            numberFromCSS(
                style.minHeight
            );

        if (
            minHeight < 100 &&
            rect.height < 160
        ) {
            return null;
        }

        return shell;
    }


    function markMobileShell(root) {
        if (!MOBILE_UA)
            return;

        const shell =
            getSafeMobileShell(root);

        if (!shell)
            return;

        /*
         * Sticky.
         *
         * 현재 route에서는 절대 다시 살리지 않는다.
         */
        if (
            shell.getAttribute(
                ATTR_SHELL
            ) !== '1'
        ) {
            shell.setAttribute(
                ATTR_SHELL,
                '1'
            );

            debug(
                'mobile PowerLink shell confirmed',
                shell
            );
        }
    }


    /*
     * ============================================================
     * 6. Mobile 250px slots - common helpers
     * ============================================================
     */

    const DOMAIN_LIKE_RE =
        /(?:https?:\/\/|www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s]*)?/i;


    function isMobile250Geometry(
        el,
        parentRect
    ) {
        if (!isDiv(el))
            return false;

        const rect =
            el.getBoundingClientRect();


        /*
         * Android 실측 = 250px.
         */
        if (
            rect.height < 247 ||
            rect.height > 253
        ) {
            return false;
        }


        /*
         * 본문 폭 거의 전체.
         */
        if (
            rect.width <
            parentRect.width * 0.94
        ) {
            return false;
        }

        return true;
    }


    function containsExactPowerLink(
        root
    ) {
        if (!isElement(root))
            return false;

        for (
            const div of
            root.querySelectorAll(
                'div[style]'
            )
        ) {
            if (
                isExactPowerLinkRoot(div)
            ) {
                return true;
            }
        }

        return false;
    }


    /*
     * 반복 슬롯용 판정.
     */
    function looksSafeAsRepeatedAdSlot(
        slot
    ) {
        if (!isDiv(slot))
            return false;


        if (
            containsExactPowerLink(slot)
        ) {
            return true;
        }


        const text =
            cleanText(
                slot.textContent
            );


        /*
         * 로딩 전 placeholder.
         */
        if (text === '') {
            if (
                slot.querySelector(
                    'article, main, ' +
                    'h1, h2, h3, h4, h5, h6, ' +
                    'p, blockquote, ul, ol, pre'
                )
            ) {
                return false;
            }

            return true;
        }


        /*
         * 긴 문서 콘텐츠는 보호.
         */
        if (
            text.length > 700
        ) {
            return false;
        }


        /*
         * 로딩된 광고에서 확인된 도메인 문자열.
         */
        if (
            DOMAIN_LIKE_RE.test(text)
        ) {
            return true;
        }

        return false;
    }


    /*
     * ============================================================
     * 7. Repeated 250px ad slots
     * ============================================================
     *
     * 같은 class 구조가 최소 2개 이상 반복되는
     * 기존 모바일 광고 슬롯.
     *
     * class 이름 자체는 하드코딩하지 않는다.
     */

    function scanRepeated250Slots(
        parent,
        parentRect
    ) {
        const groups =
            new Map();


        for (
            const child of
            parent.children
        ) {
            if (!isDiv(child))
                continue;

            const signature =
                classSignature(child);

            if (!signature)
                continue;

            let group =
                groups.get(signature);

            if (!group) {
                group = [];

                groups.set(
                    signature,
                    group
                );
            }

            group.push(child);
        }


        for (
            const [
                signature,
                group
            ] of groups
        ) {
            /*
             * 최소 2개 반복.
             */
            if (
                group.length < 2
            ) {
                continue;
            }


            let valid =
                true;

            let unmarked =
                0;


            for (
                const slot of
                group
            ) {
                /*
                 * 이미 확정된 슬롯은 sticky.
                 */
                if (
                    slot.getAttribute(
                        ATTR_MOBILE_SLOT
                    ) === '1'
                ) {
                    continue;
                }


                unmarked++;


                if (
                    !isMobile250Geometry(
                        slot,
                        parentRect
                    )
                ) {
                    valid = false;
                    break;
                }


                if (
                    !looksSafeAsRepeatedAdSlot(
                        slot
                    )
                ) {
                    valid = false;
                    break;
                }
            }


            if (
                !valid ||
                unmarked === 0
            ) {
                continue;
            }


            for (
                const slot of
                group
            ) {
                if (
                    slot.getAttribute(
                        ATTR_MOBILE_SLOT
                    ) === '1'
                ) {
                    continue;
                }


                /*
                 * race 방지.
                 */
                if (
                    !isMobile250Geometry(
                        slot,
                        parentRect
                    )
                ) {
                    continue;
                }


                slot.setAttribute(
                    ATTR_MOBILE_SLOT,
                    '1'
                );


                debug(
                    'repeated 250px ad slot confirmed',
                    {
                        signature,
                        slot
                    }
                );
            }
        }
    }


    /*
     * ============================================================
     * 8. Singleton 250px slot
     * ============================================================
     *
     * 방금 확인한:
     *
     * 본문
     * ↓
     * [검은 360×250 슬롯]
     * ↓
     * 다음 본문
     *
     * 같은 class가 두 번 반복되지 않아도 잡는다.
     *
     *
     * 대신 오탐 방지를 매우 강하게 한다.
     */


    /*
     * candidate 양옆이 실제 문서 내용인지 확인.
     */
    function looksLikeDocumentNeighbor(el) {
        if (!isElement(el))
            return false;


        /*
         * 250px 광고 slot 자체가 이웃이라면
         * "본문 사이"라고 보지 않는다.
         */
        const rect =
            el.getBoundingClientRect();

        if (
            rect.height >= 247 &&
            rect.height <= 253
        ) {
            return false;
        }


        const text =
            cleanText(
                el.textContent
            );


        /*
         * 실제 텍스트가 있는 본문/제목.
         */
        if (
            text.length >= 4
        ) {
            return true;
        }


        /*
         * section heading 계열.
         */
        if (
            el.querySelector?.(
                'h1, h2, h3, h4, h5, h6'
            )
        ) {
            return true;
        }

        return false;
    }


    /*
     * 단독 광고 slot은 "아직 비어 있을 때"만 잡는다.
     *
     * 이미 복잡한 DOM이 들어간 250px 요소를 억지로 판정하지 않는다.
     *
     * 따라서 광고를 늦게 발견하면 놓칠 수 있지만
     * 정상 콘텐츠 보호를 우선한다.
     */
    function looksSafeAsSingleton250Slot(
        slot,
        parentRect
    ) {
        if (!isDiv(slot))
            return false;


        if (
            slot.getAttribute(
                ATTR_MOBILE_SLOT
            ) === '1'
        ) {
            return false;
        }


        if (
            !isMobile250Geometry(
                slot,
                parentRect
            )
        ) {
            return false;
        }


        /*
         * 빈 placeholder 상태만 대상으로 한다.
         */
        if (
            cleanText(
                slot.textContent
            ) !== ''
        ) {
            return false;
        }


        /*
         * 정상 문서 semantic 구조가 조금이라도 있으면
         * 절대 건드리지 않는다.
         */
        if (
            slot.querySelector(
                'article, main, ' +
                'h1, h2, h3, h4, h5, h6, ' +
                'p, blockquote, ul, ol, pre, ' +
                'table, iframe, video, audio, ' +
                'form, input, textarea, canvas'
            )
        ) {
            return false;
        }


        /*
         * 로딩 placeholder는 대체로 매우 단순하다.
         *
         * 너무 복잡하면 일반 widget일 가능성을 고려해서
         * 건드리지 않는다.
         */
        if (
            slot.querySelectorAll('*')
                .length > 8
        ) {
            return false;
        }


        const prev =
            slot.previousElementSibling;

        const next =
            slot.nextElementSibling;


        /*
         * 단독 슬롯은 반드시 실제 본문 두 블록 사이에
         * 끼어 있는 경우에만 잡는다.
         */
        if (
            !looksLikeDocumentNeighbor(prev) ||
            !looksLikeDocumentNeighbor(next)
        ) {
            return false;
        }


        return true;
    }


    function scanSingleton250Slots(
        parent,
        parentRect
    ) {
        for (
            const child of
            parent.children
        ) {
            if (
                !looksSafeAsSingleton250Slot(
                    child,
                    parentRect
                )
            ) {
                continue;
            }


            /*
             * 여기까지 통과하면 현재 route에서 sticky.
             *
             * 이후 광고 DOM이 채워져도 절대 복원하지 않는다.
             */
            child.setAttribute(
                ATTR_MOBILE_SLOT,
                '1'
            );


            debug(
                'singleton 250px ad slot confirmed',
                child
            );
        }
    }


    /*
     * ============================================================
     * 9. Mobile 250px master scan
     * ============================================================
     */

    function scanMobile250Slots() {
        if (!MOBILE_UA)
            return;


        /*
         * 아무 div의 자식을 보는 게 아니라
         * 실제 긴 본문 sequence처럼 보이는 부모만 검사한다.
         */
        for (
            const parent of
            document.querySelectorAll(
                'div'
            )
        ) {
            if (
                parent.children.length < 10
            ) {
                continue;
            }


            const parentRect =
                parent.getBoundingClientRect();


            /*
             * 매우 긴 본문.
             */
            if (
                parentRect.height <
                window.innerHeight * 3
            ) {
                continue;
            }


            /*
             * 본문 폭.
             */
            if (
                parentRect.width <
                window.innerWidth * 0.70
            ) {
                continue;
            }


            /*
             * 1단계:
             *
             * 동일 class가 반복되는 광고 slot.
             */
            scanRepeated250Slots(
                parent,
                parentRect
            );


            /*
             * 2단계:
             *
             * 본문 중간에 단독으로 끼어드는
             * 빈 250px 광고 slot.
             */
            scanSingleton250Slots(
                parent,
                parentRect
            );
        }
    }


    /*
     * ============================================================
     * 10. PowerLink scan
     * ============================================================
     */

    function scanExactPowerLinks() {
        for (
            const root of
            document.querySelectorAll(
                'div[style]'
            )
        ) {
            if (
                !isExactPowerLinkRoot(
                    root
                )
            ) {
                continue;
            }


            markExactPowerLink(
                root
            );


            if (MOBILE_UA) {
                markMobileShell(
                    root
                );
            }
        }
    }


    /*
     * ============================================================
     * 11. Main scan
     * ============================================================
     */

    function runScan() {
        try {
            scanExactPowerLinks();


            if (MOBILE_UA) {
                scanMobile250Slots();
            }

        } catch (error) {
            /*
             * userscript 오류가 사이트 code에 전파되지 않도록
             * 여기서 완전히 잡는다.
             */
            console.error(
                '[PowerLink] scan failed safely:',
                error
            );
        }
    }


    /*
     * ============================================================
     * 12. Throttled scheduler
     * ============================================================
     *
     * 거대한 문서에서 mutation이 연속 발생하더라도
     * 매 mutation마다 전체 DOM을 검사하지 않는다.
     */

    let scanTimer =
        null;


    function scheduleScan() {
        if (scanTimer !== null)
            return;


        scanTimer =
            setTimeout(
                () => {
                    scanTimer =
                        null;

                    runScan();
                },
                100
            );
    }


    /*
     * ============================================================
     * 13. Route cleanup
     * ============================================================
     *
     * Sticky mark의 유일한 제거 시점.
     *
     * 같은 URL에서는:
     *
     * - 내용 변경
     * - table 생성
     * - iframe 생성
     * - class 변경
     * - 광고 로딩 완료
     *
     * 무엇이 일어나도 한번 광고로 확정된 slot을
     * 다시 살리지 않는다.
     *
     * CSR로 URL이 바뀔 때만 전부 초기화.
     */

    function clearMarksForRouteChange() {
        try {
            for (
                const el of
                document.querySelectorAll(
                    `[${ATTR_ROOT}],` +
                    `[${ATTR_SHELL}],` +
                    `[${ATTR_MOBILE_SLOT}]`
                )
            ) {
                el.removeAttribute(
                    ATTR_ROOT
                );

                el.removeAttribute(
                    ATTR_SHELL
                );

                el.removeAttribute(
                    ATTR_MOBILE_SLOT
                );
            }


            debug(
                'sticky marks cleared for route change'
            );

        } catch (error) {
            console.error(
                '[PowerLink] route cleanup failed safely:',
                error
            );
        }
    }


    /*
     * ============================================================
     * 14. MutationObserver
     * ============================================================
     */

    let observer =
        null;


    function startObserver() {
        if (
            !document.documentElement ||
            observer
        ) {
            return;
        }


        installCSS();


        observer =
            new MutationObserver(
                () => {
                    /*
                     * DOM mutation 자체에는 손대지 않는다.
                     *
                     * 일정 시간 후 재검사만 한다.
                     */
                    scheduleScan();
                }
            );


        observer.observe(
            document.documentElement,
            {
                childList: true,
                subtree: true,

                /*
                 * PowerLink가 attribute 변경만으로
                 * 완성될 수도 있다.
                 */
                attributes: true,

                attributeFilter: [
                    'style',
                    'href',
                    'src',
                    'data-src',
                    'data-doc',
                    'data-filesize'
                ],

                /*
                 * 광고 내부 text가 나중에 들어오는 경우.
                 */
                characterData: true
            }
        );


        scheduleScan();


        debug(
            'observer installed',
            {
                mobileUA:
                    MOBILE_UA,

                userAgent:
                    navigator.userAgent
            }
        );
    }


    /*
     * ============================================================
     * 15. document-start
     * ============================================================
     */

    function bootstrap() {
        if (
            document.documentElement
        ) {
            startObserver();

            return;
        }


        const bootstrapObserver =
            new MutationObserver(
                () => {
                    if (
                        !document.documentElement
                    ) {
                        return;
                    }


                    bootstrapObserver
                        .disconnect();


                    startObserver();
                }
            );


        bootstrapObserver.observe(
            document,
            {
                childList: true,
                subtree: true
            }
        );
    }


    bootstrap();


    /*
     * ============================================================
     * 16. Late scans
     * ============================================================
     */

    document.addEventListener(
        'DOMContentLoaded',
        scheduleScan,
        {
            once: true
        }
    );


    window.addEventListener(
        'load',
        scheduleScan,
        {
            once: true
        }
    );


    window.addEventListener(
        'pageshow',
        scheduleScan
    );


    /*
     * 모바일 광고 슬롯의 높이가 뒤늦게 250px로
     * 확정되는 경우 대비.
     */
    if (MOBILE_UA) {
        setInterval(
            scheduleScan,
            1500
        );
    }


    /*
     * ============================================================
     * 17. CSR route watcher
     * ============================================================
     *
     * history.pushState/router를 monkey patch하지 않는다.
     */

    let previousURL =
        location.href;


    setInterval(
        () => {
            const currentURL =
                location.href;


            if (
                currentURL ===
                previousURL
            ) {
                return;
            }


            previousURL =
                currentURL;


            /*
             * 이전 route에서 확정한 광고 mark만 이때 해제.
             */
            clearMarksForRouteChange();


            /*
             * 새 route의 DOM을 다시 독립적으로 판정.
             */
            scheduleScan();

        },
        500
    );


    /*
     * ============================================================
     * 18. Safety policy
     * ============================================================
     *
     * 절대 하지 않는 것:
     *
     * - Vue hook
     * - Vuex hook
     * - store.commit 수정
     * - INITIAL_STATE 수정
     * - fetch hook
     * - XMLHttpRequest hook
     * - WebSocket hook
     * - googletag / GPT 수정
     * - router patch
     * - history.pushState patch
     * - remove()
     * - replaceWith()
     * - innerHTML 교체
     * - 광고 payload 변조
     *
     *
     * 판정이 애매하면:
     *     광고를 그냥 보여준다.
     *
     * 한번 광고라고 확정하면:
     *     현재 URL에서는 계속 숨긴다.
     *
     * URL이 바뀌면:
     *     전부 초기화하고 새로 판단한다.
     */

})();
