// ==UserScript==
// @name         NamuWiki PowerLink Blocker
// @namespace    List-KR
// @version      2.6.0
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

    const ATTR_POWERLINK =
        'data-nwp-powerlink';

    const ATTR_POWERLINK_SHELL =
        'data-nwp-powerlink-shell';

    const ATTR_MOBILE_SLOT =
        'data-nwp-mobile-reserved-slot';


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
     * viewport가 아니라 UA를 본다.
     *
     * 확인된 차이:
     *
     * PC UA + 좁은 viewport
     *   → 별도 모바일 예약 슬롯 문제 없음
     *
     * Mobile UA
     *   → Android / iOS에서 예약 광고 슬롯 발생
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
            String(
                navigator.userAgent || ''
            );

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


    function cssNumber(value) {
        const n =
            Number.parseFloat(value);

        return Number.isFinite(n)
            ? n
            : 0;
    }


    /*
     * 클래스명을 하드코딩하지 않는다.
     *
     * 단, 같은 페이지에서 같은 종류의 component가
     * 반복되는지 확인하는 runtime signature로는 사용한다.
     */
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
            document.createElement(
                'style'
            );

        style.id =
            STYLE_ID;

        style.textContent = `
            /*
             * 실제 Android/iOS에서 차단 확인된
             * PowerLink 본체.
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
             * JS에서 확정한 요소들.
             */
            [${ATTR_POWERLINK}="1"],
            [${ATTR_POWERLINK_SHELL}="1"],
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
     * PowerLink 확정 조건:
     *
     * <div style="width:auto">
     *   <table>
     *     ...
     *     <a href="#s-*">
     *       <img data-doc data-filesize>
     *     </a>
     *   </table>
     * </div>
     *
     * /jump/ 단독 조건은 사용하지 않는다.
     * 일반 문서 이미지에도 존재하기 때문.
     */

    function getDirectTable(root) {
        if (!isElement(root))
            return null;

        for (
            const child of
            root.children
        ) {
            if (
                child.localName ===
                'table'
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


    function markPowerLink(root) {
        if (
            !isExactPowerLinkRoot(root)
        ) {
            return false;
        }

        if (
            root.getAttribute(
                ATTR_POWERLINK
            ) !== '1'
        ) {
            root.setAttribute(
                ATTR_POWERLINK,
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
     * 5. Mobile PowerLink shell
     * ============================================================
     *
     * Android에서 실측:
     *
     * PowerLink
     *   ↓
     * 높이 0 wrapper
     *   ↓
     * 약 208px reserved shell
     *
     * PowerLink 본체만 숨기면 이 shell 때문에
     * 투명 공간이 남았다.
     */

    function getSafePowerLinkShell(root) {
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
         * 페이지 전체를 절대 잡지 않는다.
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


        const shellRect =
            shell.getBoundingClientRect();

        const innerRect =
            inner.getBoundingClientRect();

        const style =
            getComputedStyle(shell);


        /*
         * 실제값은 208px.
         *
         * 약간의 변화만 허용한다.
         */
        if (
            shellRect.height < 140 ||
            shellRect.height > 340
        ) {
            return null;
        }


        if (
            shellRect.width <
            window.innerWidth * 0.65
        ) {
            return null;
        }


        if (
            shell.children.length > 10
        ) {
            return null;
        }


        /*
         * PowerLink를 직접 감싸는 wrapper는
         * 거의 0px이어야 한다.
         */
        if (
            innerRect.height > 12
        ) {
            return null;
        }


        /*
         * 다른 자식이 실제 콘텐츠를 차지하고 있다면
         * shell 전체를 건드리지 않는다.
         */
        for (
            const child of
            shell.children
        ) {
            if (child === inner)
                continue;

            const rect =
                child.getBoundingClientRect();

            if (
                rect.height > 12
            ) {
                return null;
            }
        }


        const minHeight =
            cssNumber(
                style.minHeight
            );


        if (
            minHeight < 100 &&
            shellRect.height < 160
        ) {
            return null;
        }

        return shell;
    }


    function markPowerLinkShell(root) {
        if (!MOBILE_UA)
            return;

        const shell =
            getSafePowerLinkShell(root);

        if (!shell)
            return;

        /*
         * Sticky.
         *
         * 같은 URL에서는 절대 복원하지 않는다.
         */
        if (
            shell.getAttribute(
                ATTR_POWERLINK_SHELL
            ) !== '1'
        ) {
            shell.setAttribute(
                ATTR_POWERLINK_SHELL,
                '1'
            );

            debug(
                'PowerLink shell confirmed',
                shell
            );
        }
    }


    /*
     * ============================================================
     * 6. Mobile reserved-slot geometry
     * ============================================================
     *
     * 확인된 사례:
     *
     * Android:
     *   약 360 × 250
     *
     * iOS:
     *   약 200px대 높이의 full-width 검은 placeholder
     *
     * 특정 250px 하나에 고정하지 않는다.
     */

    function isMobileReservedGeometry(
        slot,
        parentRect
    ) {
        if (!isDiv(slot))
            return false;

        const rect =
            slot.getBoundingClientRect();


        if (
            rect.width <= 0 ||
            rect.height <= 0
        ) {
            return false;
        }


        /*
         * 부모 폭 거의 전체.
         */
        if (
            rect.width <
            parentRect.width * 0.92
        ) {
            return false;
        }


        /*
         * 모바일 viewport에서도
         * 충분히 넓은 요소여야 한다.
         */
        if (
            rect.width <
            window.innerWidth * 0.70
        ) {
            return false;
        }


        /*
         * Android 250px +
         * iOS의 200px대 reserved slot.
         *
         * 너무 넓히면 정상 콘텐츠 위험이 커지므로
         * 현재 확인 범위만 사용한다.
         */
        if (
            rect.height < 170 ||
            rect.height > 280
        ) {
            return false;
        }

        return true;
    }


    /*
     * ============================================================
     * 7. Normal document-content protection
     * ============================================================
     *
     * div / span / svg 같은 광고 placeholder 내부 구조는 허용.
     *
     * 명확한 문서/미디어 콘텐츠가 존재하면
     * 단독 빈 슬롯 탐지에서 제외한다.
     */

    const FORBIDDEN_EMPTY_SLOT_SELECTOR = [
        'article',
        'main',

        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',

        'p',
        'blockquote',
        'ul',
        'ol',
        'pre',

        'table',

        'figure',
        'picture',
        'img',

        'iframe',
        'video',
        'audio',
        'canvas',

        'form',
        'input',
        'textarea',
        'select',
        'button'
    ].join(',');


    function containsForbiddenEmptySlotContent(
        slot
    ) {
        if (!isElement(slot))
            return true;

        return !!slot.querySelector(
            FORBIDDEN_EMPTY_SLOT_SELECTOR
        );
    }


    /*
     * ============================================================
     * 8. Loaded-ad hints
     * ============================================================
     */

    const DOMAIN_LIKE_RE =
        /(?:https?:\/\/|www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s]*)?/i;


    function containsExactPowerLink(root) {
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
     * ============================================================
     * 9. Long article-sequence parent
     * ============================================================
     *
     * 본문 중간 광고를 찾을 때만 사용한다.
     *
     * 상단 광고는 별도 scanner가 담당한다.
     */

    function isArticleSequenceParent(
        parent
    ) {
        if (!isDiv(parent))
            return false;


        if (
            parent.children.length < 10
        ) {
            return false;
        }


        const rect =
            parent.getBoundingClientRect();


        if (
            rect.height <
            window.innerHeight * 3
        ) {
            return false;
        }


        if (
            rect.width <
            window.innerWidth * 0.70
        ) {
            return false;
        }

        return true;
    }


    /*
     * ============================================================
     * 10. Document neighbor
     * ============================================================
     *
     * 단독 검은 박스가 실제 본문 사이에 끼어 있는지 확인.
     */

    function looksLikeDocumentNeighbor(
        el
    ) {
        if (!isElement(el))
            return false;


        /*
         * 이미 우리가 잡은 광고는 건너뛴다.
         */
        if (
            el.getAttribute(
                ATTR_MOBILE_SLOT
            ) === '1'
        ) {
            return false;
        }


        const text =
            cleanText(
                el.textContent
            );


        if (
            text.length >= 4
        ) {
            return true;
        }


        if (
            el.querySelector?.(
                'h1,h2,h3,h4,h5,h6,p,blockquote'
            )
        ) {
            return true;
        }

        return false;
    }


    function findMeaningfulSibling(
        start,
        direction
    ) {
        let current =
            start;


        /*
         * 중간에 0px spacer 등이 낄 수 있으므로
         * 최대 5개까지 건너뛴다.
         */
        for (
            let i = 0;
            current && i < 5;
            i++
        ) {
            if (
                looksLikeDocumentNeighbor(
                    current
                )
            ) {
                return current;
            }


            current =
                direction < 0
                    ? current.previousElementSibling
                    : current.nextElementSibling;
        }


        return null;
    }


    /*
     * ============================================================
     * 11. Standalone empty mobile slot
     * ============================================================
     *
     * 이번 iOS 사례의 핵심.
     *
     * 긴 본문 container가 아니어도:
     *
     * 분류 / 제목 / 설명
     * ↓
     * [검은 full-width 예약 광고]
     * ↓
     * 실제 본문
     *
     * 형태를 잡는다.
     */

    function looksSafeAsStandaloneEmptySlot(
        slot
    ) {
        if (!MOBILE_UA)
            return false;


        if (!isDiv(slot))
            return false;


        if (
            slot.getAttribute(
                ATTR_MOBILE_SLOT
            ) === '1'
        ) {
            return false;
        }


        const parent =
            slot.parentElement;


        if (
            !isDiv(parent) &&
            !isElement(parent)
        ) {
            return false;
        }


        /*
         * html/body/#app는 후보 parent로 인정하지 않는다.
         */
        if (
            parent === document.body ||
            parent === document.documentElement ||
            parent.id === 'app'
        ) {
            return false;
        }


        const parentRect =
            parent.getBoundingClientRect();


        if (
            !isMobileReservedGeometry(
                slot,
                parentRect
            )
        ) {
            return false;
        }


        /*
         * 상단 검은 placeholder는 의미 있는 텍스트가 없어야 한다.
         *
         * NBSP / 공백은 cleanText에서 제거됨.
         */
        if (
            cleanText(
                slot.textContent
            ) !== ''
        ) {
            return false;
        }


        /*
         * div/span/svg 같은 placeholder wrapper는 허용하지만
         * 실제 문서/미디어 구조가 있으면 보호한다.
         */
        if (
            containsForbiddenEmptySlotContent(
                slot
            )
        ) {
            return false;
        }


        const previous =
            findMeaningfulSibling(
                slot.previousElementSibling,
                -1
            );

        const next =
            findMeaningfulSibling(
                slot.nextElementSibling,
                1
            );


        /*
         * 정상 문서 내용 사이에 실제로 끼어 있을 때만.
         *
         * 이 조건 때문에 화면의 아무 200px 빈 div나
         * 무작정 지우지 않는다.
         */
        if (
            !previous ||
            !next
        ) {
            return false;
        }


        return true;
    }


    /*
     * ============================================================
     * 12. Repeated mobile slot
     * ============================================================
     *
     * Android에서 확인한 본문 중간 반복 광고.
     *
     * 동일 class 문자열을 하드코딩하지 않고
     * 현재 route에서 같은 signature가 반복되는지만 본다.
     */

    function looksSafeAsRepeatedSlot(
        slot
    ) {
        if (!isDiv(slot))
            return false;


        if (
            containsExactPowerLink(
                slot
            )
        ) {
            return true;
        }


        const text =
            cleanText(
                slot.textContent
            );


        /*
         * 로딩 중 빈 placeholder.
         *
         * 반복되는 동일 class + 동일 geometry라는
         * 강한 추가 조건이 있기 때문에 허용.
         */
        if (text === '') {
            return true;
        }


        /*
         * 실제 광고가 로드된 상태.
         */
        if (
            text.length <= 700 &&
            DOMAIN_LIKE_RE.test(text)
        ) {
            return true;
        }


        return false;
    }


    function scanRepeatedMobileSlots(
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
            if (
                group.length < 2
            ) {
                continue;
            }


            let valid =
                true;

            let hasNew =
                false;


            for (
                const slot of
                group
            ) {
                /*
                 * Sticky 슬롯은 재검증하지 않는다.
                 */
                if (
                    slot.getAttribute(
                        ATTR_MOBILE_SLOT
                    ) === '1'
                ) {
                    continue;
                }


                hasNew =
                    true;


                if (
                    !isMobileReservedGeometry(
                        slot,
                        parentRect
                    )
                ) {
                    valid = false;
                    break;
                }


                if (
                    !looksSafeAsRepeatedSlot(
                        slot
                    )
                ) {
                    valid = false;
                    break;
                }
            }


            if (
                !valid ||
                !hasNew
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


                if (
                    !isMobileReservedGeometry(
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
                    'repeated mobile slot confirmed',
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
     * 13. Article singleton slot
     * ============================================================
     *
     * 본문 중간에 한 개만 들어가는 빈 광고.
     */

    function scanArticleSingletonSlots(
        parent,
        parentRect
    ) {
        for (
            const slot of
            parent.children
        ) {
            if (!isDiv(slot))
                continue;


            if (
                slot.getAttribute(
                    ATTR_MOBILE_SLOT
                ) === '1'
            ) {
                continue;
            }


            if (
                !isMobileReservedGeometry(
                    slot,
                    parentRect
                )
            ) {
                continue;
            }


            /*
             * 본문 중간 singleton은
             * 빈 placeholder만 선제 차단.
             */
            if (
                cleanText(
                    slot.textContent
                ) !== ''
            ) {
                continue;
            }


            if (
                containsForbiddenEmptySlotContent(
                    slot
                )
            ) {
                continue;
            }


            const previous =
                findMeaningfulSibling(
                    slot.previousElementSibling,
                    -1
                );

            const next =
                findMeaningfulSibling(
                    slot.nextElementSibling,
                    1
                );


            if (
                !previous ||
                !next
            ) {
                continue;
            }


            slot.setAttribute(
                ATTR_MOBILE_SLOT,
                '1'
            );


            debug(
                'article singleton slot confirmed',
                slot
            );
        }
    }


    /*
     * ============================================================
     * 14. Top/standalone mobile slot scan
     * ============================================================
     *
     * 2.5.0의 사각지대였던 부분.
     *
     * 긴 article sequence가 아니어도
     * 전체 DOM에서 안전 조건을 만족하는 full-width
     * empty reserved slot을 찾는다.
     */

    function scanStandaloneMobileSlots() {
        if (!MOBILE_UA)
            return;


        for (
            const slot of
            document.querySelectorAll('div')
        ) {
            if (
                !looksSafeAsStandaloneEmptySlot(
                    slot
                )
            ) {
                continue;
            }


            /*
             * 여기까지 통과하면 현재 route에서 sticky.
             */
            slot.setAttribute(
                ATTR_MOBILE_SLOT,
                '1'
            );


            debug(
                'standalone mobile slot confirmed',
                slot
            );
        }
    }


    /*
     * ============================================================
     * 15. ResizeObserver
     * ============================================================
     *
     * iOS에서:
     *
     * 0px
     * ↓
     * 임시 높이
     * ↓
     * 200px대 검은 슬롯
     *
     * 처럼 나중에 layout이 확정되는 경우 대응.
     *
     * ResizeObserver에서는 직접 숨기지 않고
     * 전체 안전 판정을 다시 예약한다.
     */

    const resizeObserved =
        new WeakSet();


    let resizeObserver =
        null;


    function getResizeObserver() {
        if (resizeObserver)
            return resizeObserver;


        if (
            typeof ResizeObserver !==
            'function'
        ) {
            return null;
        }


        resizeObserver =
            new ResizeObserver(
                () => {
                    scheduleScan();
                }
            );


        return resizeObserver;
    }


    /*
     * 폭이 넓은 container의 direct div children을 관찰한다.
     *
     * 아직 height=0이어도 관찰하므로
     * 나중에 216/250px로 커지는 순간을 잡을 수 있다.
     */

    function registerResizeTargets() {
        if (!MOBILE_UA)
            return;


        const ro =
            getResizeObserver();


        if (!ro)
            return;


        for (
            const parent of
            document.querySelectorAll('div')
        ) {
            const parentRect =
                parent.getBoundingClientRect();


            if (
                parentRect.width <
                window.innerWidth * 0.70
            ) {
                continue;
            }


            /*
             * 너무 큰 최상위 root 직접 관찰은 제외.
             */
            if (
                parent === document.body ||
                parent === document.documentElement ||
                parent.id === 'app'
            ) {
                continue;
            }


            /*
             * 자식이 지나치게 많은 매우 큰 root에서
             * 모든 요소를 observe하는 것 방지.
             */
            if (
                parent.children.length > 120
            ) {
                continue;
            }


            for (
                const child of
                parent.children
            ) {
                if (!isDiv(child))
                    continue;


                if (
                    resizeObserved.has(
                        child
                    )
                ) {
                    continue;
                }


                const rect =
                    child.getBoundingClientRect();


                /*
                 * 0px loading slot도 포함하고,
                 * 폭이 너무 작은 UI 요소는 제외.
                 */
                if (
                    rect.width > 0 &&
                    rect.width <
                    parentRect.width * 0.80
                ) {
                    continue;
                }


                resizeObserved.add(
                    child
                );


                try {
                    ro.observe(
                        child
                    );
                } catch {
                    // ignored
                }
            }
        }
    }


    /*
     * ============================================================
     * 16. Mobile master scan
     * ============================================================
     */

    function scanMobileReservedSlots() {
        if (!MOBILE_UA)
            return;


        /*
         * 나중에 크기가 바뀌는 후보 등록.
         */
        registerResizeTargets();


        /*
         * A.
         * 긴 본문 안의 반복/단독 광고.
         */
        for (
            const parent of
            document.querySelectorAll(
                'div'
            )
        ) {
            if (
                !isArticleSequenceParent(
                    parent
                )
            ) {
                continue;
            }


            const parentRect =
                parent.getBoundingClientRect();


            scanRepeatedMobileSlots(
                parent,
                parentRect
            );


            scanArticleSingletonSlots(
                parent,
                parentRect
            );
        }


        /*
         * B.
         * 제목/분류 아래 등에 독립적으로 생기는
         * iOS/Android 상단 검은 광고.
         */
        scanStandaloneMobileSlots();
    }


    /*
     * ============================================================
     * 17. PowerLink master scan
     * ============================================================
     */

    function scanPowerLinks() {
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


            markPowerLink(
                root
            );


            if (MOBILE_UA) {
                markPowerLinkShell(
                    root
                );
            }
        }
    }


    /*
     * ============================================================
     * 18. Main scan
     * ============================================================
     */

    function runScan() {
        try {
            scanPowerLinks();


            if (MOBILE_UA) {
                scanMobileReservedSlots();
            }

        } catch (error) {
            /*
             * userscript 내부 에러가 사이트 앱으로
             * 절대 전파되지 않는다.
             */
            console.error(
                '[PowerLink] scan failed safely:',
                error
            );
        }
    }


    /*
     * ============================================================
     * 19. Scheduler
     * ============================================================
     */

    let scanTimer =
        null;


    function scheduleScan() {
        if (
            scanTimer !== null
        ) {
            return;
        }


        /*
         * mutation / resize가 몰리더라도
         * 한 번으로 합친다.
         */
        scanTimer =
            setTimeout(
                () => {
                    scanTimer =
                        null;

                    runScan();
                },
                80
            );
    }


    /*
     * ============================================================
     * 20. Route cleanup
     * ============================================================
     *
     * Sticky 해제는 오직 URL 변경 때만.
     *
     * 같은 URL에서 광고 내부 DOM이 어떻게 바뀌든
     * 이미 확정한 슬롯은 절대 되살리지 않는다.
     */

    function clearMarksForRouteChange() {
        try {
            for (
                const el of
                document.querySelectorAll(
                    `[${ATTR_POWERLINK}],` +
                    `[${ATTR_POWERLINK_SHELL}],` +
                    `[${ATTR_MOBILE_SLOT}]`
                )
            ) {
                el.removeAttribute(
                    ATTR_POWERLINK
                );

                el.removeAttribute(
                    ATTR_POWERLINK_SHELL
                );

                el.removeAttribute(
                    ATTR_MOBILE_SLOT
                );
            }


            debug(
                'sticky marks cleared'
            );

        } catch (error) {
            console.error(
                '[PowerLink] cleanup failed safely:',
                error
            );
        }
    }


    /*
     * ============================================================
     * 21. MutationObserver
     * ============================================================
     */

    let mutationObserver =
        null;


    function startMutationObserver() {
        if (
            !document.documentElement ||
            mutationObserver
        ) {
            return;
        }


        installCSS();


        mutationObserver =
            new MutationObserver(
                () => {
                    /*
                     * callback 내부에서 페이지 DOM을
                     * 뜯어고치지 않는다.
                     *
                     * 재검사만 예약.
                     */
                    scheduleScan();
                }
            );


        mutationObserver.observe(
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
                ],

                characterData: true
            }
        );


        scheduleScan();


        debug(
            'MutationObserver installed',
            {
                mobileUA:
                    MOBILE_UA,

                ua:
                    navigator.userAgent
            }
        );
    }


    /*
     * ============================================================
     * 22. document-start bootstrap
     * ============================================================
     */

    function bootstrap() {
        if (
            document.documentElement
        ) {
            startMutationObserver();

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


                    startMutationObserver();
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
     * 23. Late scans
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
     * iOS/Android의 늦은 광고 layout 확정에 대한
     * 최종 fallback.
     *
     * Mobile UA에서만.
     */
    if (MOBILE_UA) {
        setInterval(
            scheduleScan,
            1500
        );
    }


    /*
     * ============================================================
     * 24. CSR route watcher
     * ============================================================
     *
     * Vue router / history.pushState를 monkey patch하지 않는다.
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
             * 이전 route에서 확정한 sticky mark만 제거.
             */
            clearMarksForRouteChange();


            /*
             * 새 route는 처음부터 다시 독립 판정.
             */
            scheduleScan();

        },
        500
    );


    /*
     * ============================================================
     * 25. Safety policy
     * ============================================================
     *
     * 절대 하지 않음:
     *
     * - Vue hook
     * - Vuex hook
     * - store.commit 수정
     * - INITIAL_STATE 수정
     * - fetch hook
     * - XMLHttpRequest hook
     * - WebSocket hook
     * - googletag / GPT 수정
     * - router monkey patch
     * - history.pushState patch
     * - DOM remove()
     * - replaceWith()
     * - innerHTML 교체
     * - 광고 payload 변조
     *
     *
     * 애매한 경우:
     *     광고를 놓친다.
     *
     * 광고로 확정한 경우:
     *     현재 URL에서 sticky display:none.
     *
     * CSR URL 변경:
     *     mark 초기화 후 다시 판정.
     */

})();
