// ==UserScript==
// @name         NamuWiki PowerLink Blocker
// @namespace    List-KR
// @version      2.5.0
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
     * 1. Mobile UA detection
     * ============================================================
     *
     * 실제 테스트 결과:
     *
     * PC UA + 좁은 viewport
     *   → 모바일 예약 광고 슬롯 문제 없음
     *
     * Mobile UA
     *   → Android / iOS에서 별도 예약 슬롯 발생
     *
     * 따라서 viewport 자체는 mobile 판정에 사용하지 않는다.
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
        return isTag(
            node,
            'div'
        );
    }


    function cleanText(text) {
        return String(text || '')
            .replace(/\u00a0/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }


    function cssNumber(value) {
        const number =
            Number.parseFloat(value);

        return Number.isFinite(number)
            ? number
            : 0;
    }


    /*
     * class 이름을 하드코딩하지 않는다.
     *
     * 단, 현재 페이지 안에서 같은 component가
     * 반복되는지를 비교하기 위한 signature로만 쓴다.
     */
    function classSignature(el) {
        if (!isElement(el))
            return null;

        const value =
            el.getAttribute('class');

        if (!value)
            return null;

        const normalized =
            value
                .trim()
                .replace(/\s+/g, ' ');

        return normalized || null;
    }


    /*
     * ============================================================
     * 3. CSS
     * ============================================================
     *
     * PowerLink 본체는 Android에서 실제 작동이 확인된
     * exact selector를 그대로 사용한다.
     *
     * :has() 중첩은 하지 않는다.
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
             * 확정 PowerLink.
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
             * JS가 확정한 PowerLink / shell /
             * mobile reserved slot.
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
     * 4. Exact PowerLink detection
     * ============================================================
     *
     * 이것만 PowerLink의 확정 marker로 쓴다.
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
     * data-doc="/jump/..." 단독 판정은 사용하지 않는다.
     * 일반 문서 이미지에도 존재하는 것을 확인했기 때문.
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
     * 5. Mobile PowerLink reserved shell
     * ============================================================
     *
     * Android에서 실측한 별도 케이스:
     *
     * PowerLink root
     *     ↓
     * 0px wrapper
     *     ↓
     * 약 208px reserved shell
     *
     * PowerLink 본체를 display:none 해도
     * 이 shell이 min-height를 유지해서 투명 공간이 남았다.
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
         * 최상위 DOM 보호.
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
         * 실제 측정은 208px.
         *
         * 작은 사이트 변경은 허용하되
         * 일반 콘텐츠 container까지 잡지 않게 제한.
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


        /*
         * 실제 shell은 비교적 단순했다.
         */
        if (
            shell.children.length > 10
        ) {
            return null;
        }


        /*
         * PowerLink 직전 wrapper는 사실상 0px.
         */
        if (
            innerRect.height > 12
        ) {
            return null;
        }


        /*
         * 다른 직계 자식이 실제 높이를 차지하면
         * shell 전체를 숨기지 않는다.
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


        /*
         * 내용은 0인데 부모만 공간을 예약하는
         * 형태인지 마지막 확인.
         */
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
         * 현재 route에서는 절대 자동 복원하지 않는다.
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
                'PowerLink reserved shell confirmed',
                shell
            );
        }
    }


    /*
     * ============================================================
     * 6. Mobile reserved-slot geometry
     * ============================================================
     *
     * Android:
     *   약 360 × 250
     *
     * iOS:
     *   같은 계열 검은 박스가 약 180~260px 높이 범위에서
     *   렌더링되는 것으로 관찰됨.
     *
     * 특정 250px 값 하나에 의존하지 않는다.
     */

    function isMobileReservedGeometry(
        el,
        parentRect
    ) {
        if (!isDiv(el))
            return false;

        const rect =
            el.getBoundingClientRect();


        if (
            rect.width <= 0 ||
            rect.height <= 0
        ) {
            return false;
        }


        /*
         * 부모 본문 폭 거의 전체.
         */
        if (
            rect.width <
            parentRect.width * 0.94
        ) {
            return false;
        }


        /*
         * 현재까지 확인된 mobile reserved ad 영역.
         *
         * Android 250px 포함.
         * iOS의 약 200px대 placeholder 포함.
         */
        if (
            rect.height < 180 ||
            rect.height > 260
        ) {
            return false;
        }

        return true;
    }


    /*
     * ============================================================
     * 7. Semantic-content protection
     * ============================================================
     *
     * div/span/svg 같은 placeholder 내부 구조는 허용한다.
     *
     * 대신 명백한 문서 콘텐츠 구조가 있으면
     * 절대 mobile reserved slot로 잡지 않는다.
     */

    const FORBIDDEN_DOCUMENT_SELECTOR = [
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

        'video',
        'audio',

        'iframe',

        'form',
        'textarea'
    ].join(',');


    function containsForbiddenDocumentContent(
        slot
    ) {
        if (!isElement(slot))
            return true;

        return !!slot.querySelector(
            FORBIDDEN_DOCUMENT_SELECTOR
        );
    }


    /*
     * ============================================================
     * 8. Loaded-ad hints
     * ============================================================
     *
     * 확정 PowerLink 외의 모바일 슬롯은
     * 본문 중간 광고일 수 있으므로 보조 신호를 사용한다.
     */

    const DOMAIN_LIKE_RE =
        /(?:https?:\/\/|www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s]*)?/i;


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
     * ============================================================
     * 9. Is this a safe mobile ad candidate?
     * ============================================================
     *
     * 중요한 변경:
     *
     * querySelectorAll('*').length 같은
     * placeholder DOM 복잡도 조건은 사용하지 않는다.
     *
     * iOS에서 내부 placeholder 구조가 먼저 생기면
     * 이전 버전이 랜덤하게 실패할 수 있었기 때문.
     */

    function looksSafeAsMobileReservedSlot(
        slot
    ) {
        if (!isDiv(slot))
            return false;


        /*
         * 이미 확정한 슬롯은 재판정하지 않는다.
         */
        if (
            slot.getAttribute(
                ATTR_MOBILE_SLOT
            ) === '1'
        ) {
            return true;
        }


        /*
         * exact PowerLink가 들어있다면 강한 광고 신호.
         */
        if (
            containsExactPowerLink(
                slot
            )
        ) {
            return true;
        }


        /*
         * 실제 문서 semantic 구조가 있으면 보호.
         */
        if (
            containsForbiddenDocumentContent(
                slot
            )
        ) {
            return false;
        }


        const text =
            cleanText(
                slot.textContent
            );


        /*
         * 빈 검은 placeholder.
         *
         * div/span/svg 등이 내부에 몇 개 있든 상관없다.
         */
        if (text === '') {
            return true;
        }


        /*
         * 너무 긴 텍스트는 일반 콘텐츠일 가능성이 높음.
         */
        if (
            text.length > 700
        ) {
            return false;
        }


        /*
         * 이미 광고가 로드되어 도메인이 노출된 상태.
         */
        if (
            DOMAIN_LIKE_RE.test(text)
        ) {
            return true;
        }


        /*
         * 애매하면 안 잡는다.
         */
        return false;
    }


    /*
     * ============================================================
     * 10. Long article-sequence parents
     * ============================================================
     *
     * 페이지 전체의 모든 200px div를 조사하지 않는다.
     *
     * 실제 본문처럼:
     *
     * - direct child가 많이 존재
     * - viewport보다 훨씬 긴 높이
     * - 화면 대부분의 폭
     *
     * 을 가진 sequence container만 대상으로 한다.
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
     * 11. Repeated reserved-slot detection
     * ============================================================
     *
     * 같은 난독화 class를 하드코딩하지 않는다.
     *
     * 현재 페이지에서 같은 signature가 반복되고,
     * 미확정 요소들이 전부 모바일 광고 geometry이면
     * 해당 그룹을 광고 슬롯로 확정한다.
     */

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
            /*
             * 하나뿐이면 repeated 방식에서는 건드리지 않는다.
             */
            if (
                group.length < 2
            ) {
                continue;
            }


            let valid =
                true;


            let hasNewCandidate =
                false;


            for (
                const slot of
                group
            ) {
                /*
                 * 이미 sticky로 숨긴 슬롯은 그대로 인정.
                 */
                if (
                    slot.getAttribute(
                        ATTR_MOBILE_SLOT
                    ) === '1'
                ) {
                    continue;
                }


                hasNewCandidate =
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
                    !looksSafeAsMobileReservedSlot(
                        slot
                    )
                ) {
                    valid = false;
                    break;
                }
            }


            if (
                !valid ||
                !hasNewCandidate
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
                 * 실제 숨기기 직전에 geometry 한 번 더 확인.
                 */
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
                    'repeated mobile reserved slot confirmed',
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
     * 12. Singleton reserved-slot detection
     * ============================================================
     *
     * 반복 class가 없는 단독 검은 박스도 잡는다.
     *
     * 대신 최초 판정은 더 보수적으로 한다.
     */

    function looksLikeDocumentNeighbor(
        el
    ) {
        if (!isElement(el))
            return false;


        const text =
            cleanText(
                el.textContent
            );


        /*
         * 실제 텍스트 블록.
         */
        if (
            text.length >= 4
        ) {
            return true;
        }


        /*
         * 제목이 포함된 section.
         */
        if (
            el.querySelector?.(
                'h1,h2,h3,h4,h5,h6'
            )
        ) {
            return true;
        }

        return false;
    }


    /*
     * 바로 앞뒤에 spacer가 끼어 있을 수 있으므로
     * 몇 sibling 정도는 건너뛰면서 실제 본문을 찾는다.
     */

    function findMeaningfulSibling(
        start,
        direction
    ) {
        let current =
            start;

        for (
            let i = 0;
            current && i < 4;
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


    function looksSafeAsSingletonMobileSlot(
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
            !isMobileReservedGeometry(
                slot,
                parentRect
            )
        ) {
            return false;
        }


        /*
         * loaded ad면 별도 hint만으로도 판정 가능.
         */
        const text =
            cleanText(
                slot.textContent
            );


        if (
            text !== '' &&
            DOMAIN_LIKE_RE.test(text) &&
            !containsForbiddenDocumentContent(slot)
        ) {
            return true;
        }


        /*
         * singleton의 빈 placeholder는
         * 문서 semantic content가 없어야 한다.
         */
        if (text !== '')
            return false;


        if (
            containsForbiddenDocumentContent(
                slot
            )
        ) {
            return false;
        }


        /*
         * placeholder 내부의
         * div/span/svg 구조 개수는 제한하지 않는다.
         */


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
         * 앞뒤 모두 실제 문서 sequence가 확인될 때만
         * 단독 empty slot을 확정.
         */
        if (
            !previous ||
            !next
        ) {
            return false;
        }


        return true;
    }


    function scanSingletonMobileSlots(
        parent,
        parentRect
    ) {
        for (
            const child of
            parent.children
        ) {
            if (
                !looksSafeAsSingletonMobileSlot(
                    child,
                    parentRect
                )
            ) {
                continue;
            }


            child.setAttribute(
                ATTR_MOBILE_SLOT,
                '1'
            );


            debug(
                'singleton mobile reserved slot confirmed',
                child
            );
        }
    }


    /*
     * ============================================================
     * 13. ResizeObserver
     * ============================================================
     *
     * 이번 버전의 핵심.
     *
     * 광고 slot:
     *
     *   height 0
     *      ↓
     *   120px
     *      ↓
     *   216px / 250px
     *
     * 식으로 나중에 커지는 경우를 직접 감지한다.
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
                entries => {
                    for (
                        const entry of
                        entries
                    ) {
                        const slot =
                            entry.target;


                        if (!isDiv(slot))
                            continue;


                        /*
                         * 이미 sticky면 아무것도 하지 않는다.
                         */
                        if (
                            slot.getAttribute(
                                ATTR_MOBILE_SLOT
                            ) === '1'
                        ) {
                            continue;
                        }


                        const parent =
                            slot.parentElement;


                        if (
                            !isArticleSequenceParent(
                                parent
                            )
                        ) {
                            continue;
                        }


                        const parentRect =
                            parent.getBoundingClientRect();


                        /*
                         * 크기가 mobile ad 범위에 들어오는 순간
                         * 바로 singleton 안전 판정을 시도.
                         */
                        if (
                            looksSafeAsSingletonMobileSlot(
                                slot,
                                parentRect
                            )
                        ) {
                            slot.setAttribute(
                                ATTR_MOBILE_SLOT,
                                '1'
                            );


                            debug(
                                'mobile slot confirmed by ResizeObserver',
                                slot
                            );
                        }
                    }
                }
            );


        return resizeObserver;
    }


    function observeArticleChildren(
        parent
    ) {
        if (!MOBILE_UA)
            return;


        const ro =
            getResizeObserver();


        if (!ro)
            return;


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


    /*
     * ============================================================
     * 14. Mobile master scan
     * ============================================================
     */

    function scanMobileReservedSlots() {
        if (!MOBILE_UA)
            return;


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


            /*
             * 나중에 커지는 슬롯 감시 등록.
             */
            observeArticleChildren(
                parent
            );


            /*
             * 이미 180~260px로 완성된 슬롯도 즉시 검사.
             */
            scanRepeatedMobileSlots(
                parent,
                parentRect
            );


            scanSingletonMobileSlots(
                parent,
                parentRect
            );
        }
    }


    /*
     * ============================================================
     * 15. PowerLink master scan
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
     * 16. Main scan
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
             * blocker 실패가 사이트로 전파되지 않게
             * 최상단에서 모두 잡는다.
             */
            console.error(
                '[PowerLink] scan failed safely:',
                error
            );
        }
    }


    /*
     * ============================================================
     * 17. Scheduler
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
         * 렌더 도중 매 mutation마다 즉시 훑지 않고
         * 80ms 동안 묶어서 한 번 검사.
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
     * 18. Sticky route cleanup
     * ============================================================
     *
     * 같은 URL에서는:
     *
     * - 광고 내용 변경
     * - iframe 추가
     * - table 추가
     * - class 변경
     * - 이미지 추가
     *
     * 등이 일어나도 한번 잡은 슬롯은 복원하지 않는다.
     *
     * URL이 실제로 바뀔 때만 mark를 초기화한다.
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
     * 19. MutationObserver
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
                     * DOM mutation 자체를 수정하지 않고
                     * 재검사 예약만 한다.
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

                /*
                 * 광고 내부가 text node 변경으로 완성되는 경우.
                 */
                characterData: true
            }
        );


        scheduleScan();


        debug(
            'MutationObserver installed',
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
     * 20. document-start bootstrap
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
     * 21. Late scans
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
     * Mutation/ResizeObserver 둘 다 놓치는 아주 특이한 경우를
     * 위한 저빈도 fallback.
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
     * 22. CSR route watcher
     * ============================================================
     *
     * history.pushState나 router를 monkey patch하지 않는다.
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
             * Sticky 해제는 오직 route 변경 때만.
             */
            clearMarksForRouteChange();


            /*
             * ResizeObserver의 기존 관찰 대상은
             * DOM에서 사라지면 브라우저가 알아서 정리한다.
             *
             * 새 route의 article children은 다음 scan에서
             * 다시 observe된다.
             */
            scheduleScan();

        },
        500
    );


    /*
     * ============================================================
     * 23. Safety policy
     * ============================================================
     *
     * 이 스크립트는 절대로:
     *
     * - Vue를 hook하지 않는다.
     * - Vuex를 hook하지 않는다.
     * - store.commit을 수정하지 않는다.
     * - INITIAL_STATE를 수정하지 않는다.
     * - fetch를 hook하지 않는다.
     * - XMLHttpRequest를 hook하지 않는다.
     * - WebSocket을 hook하지 않는다.
     * - googletag / GPT를 건드리지 않는다.
     * - router를 patch하지 않는다.
     * - history.pushState를 patch하지 않는다.
     * - DOM node를 remove()하지 않는다.
     * - replaceWith()하지 않는다.
     * - innerHTML을 교체하지 않는다.
     * - 광고 payload를 변조하지 않는다.
     *
     *
     * 광고 판정이 애매하면:
     *     → 그냥 놓친다.
     *
     * 광고로 확정되면:
     *     → 현재 URL 동안 display:none만 유지한다.
     *
     * CSR URL 변경:
     *     → mark를 해제하고 새 route에서 다시 판정한다.
     */

})();
