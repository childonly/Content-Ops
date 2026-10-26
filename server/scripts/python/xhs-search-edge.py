#!/usr/bin/env python3
"""XHS search via Playwright persistent context (bypasses headless detection).

Root cause fix for pipeline search failure:
The original xhs-cli requires camoufox (modified Firefox) which cannot be
installed in the TRAE sandbox. The previous Edge-based approach used
launch() + new_context() which was detected by Xiaohongshu's anti-bot
system, resulting in a login modal and 0 search results.

This script adopts the xiaohongshu-skill's proven anti-detection strategy:
1. launch_persistent_context() — maintains browser state across sessions
2. ignore_default_args=['--enable-automation'] — removes automation flag
3. Comprehensive stealth JS — webdriver, chrome.runtime, plugins, WebGL, etc.
4. Login popup dismissal via DOM removal (not click, which redirects)
5. Both __INITIAL_STATE__ and DOM extraction (fallback)

Usage:
    python xhs-search-edge.py --keyword "AI agents" --limit 30
    python xhs-search-edge.py --keyword "测试" --limit 10 --cookie-file /path/to/cookies.json

Output: JSON array to stdout (stderr for logs)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any


def log(msg: str) -> None:
    """Log to stderr (stdout is reserved for JSON output)."""
    print(f"[xhs-search-edge] {msg}", file=sys.stderr, flush=True)


def find_edge_executable() -> str:
    """Find system browser executable for headless automation.

    ⚠️ Quark browser does NOT support headless mode (crashes immediately).
    This function is only used for headless search, so we skip Quark entirely.
    For login (headless=False), xiaohongshu-skill's client.py handles Quark preference.

    Priority:
    - Windows: Edge → Chrome (Quark skipped - doesn't support --headless)
    - macOS:   Edge → Chrome (Safari not supported by Playwright)
    - Linux:   Edge → Chrome
    """
    # Windows — Edge first (supports headless), Chrome second, NO Quark
    win_paths = [
        # 1. Microsoft Edge — supports headless automation
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        # 2. Google Chrome
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    for p in win_paths:
        if p and Path(p).exists():
            return p

    # macOS
    mac_paths = [
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]
    for p in mac_paths:
        if Path(p).exists():
            return p

    # Linux
    linux_paths = ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable",
                   "/usr/bin/google-chrome", "/usr/bin/chromium"]
    for p in linux_paths:
        if Path(p).exists():
            return p

    return ""


def find_chromium_executable() -> str:
    """Find Playwright's bundled Chromium as fallback."""
    # Windows Playwright cache
    win_cache = Path(os.environ.get("LOCALAPPDATA", "")) / "ms-playwright"
    if win_cache.exists():
        for d in win_cache.iterdir():
            if d.name.startswith("chromium-"):
                exe = d / "chrome-win" / "chrome.exe"
                if exe.exists():
                    return str(exe)

    # macOS Playwright cache
    mac_cache = Path.home() / "Library" / "Caches" / "ms-playwright"
    if mac_cache.exists():
        for d in mac_cache.iterdir():
            if d.name.startswith("chromium-"):
                exe = d / "chrome-mac" / "Chromium.app" / "Contents" / "MacOS" / "Chromium"
                if exe.exists():
                    return str(exe)

    return ""


def load_cookies(cookie_file: str) -> list[dict]:
    """Load cookies from a JSON file.

    Supports two formats:
    - Playwright format: list[dict] with name, value, domain, path, etc.
    - xhs-cli format: {"cookies": {name: value, ...}}
    """
    if not cookie_file or not Path(cookie_file).exists():
        log(f"Cookie file not found: {cookie_file}")
        return []

    try:
        with open(cookie_file, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log(f"Failed to read cookie file: {e}")
        return []

    # Playwright format: list[dict]
    if isinstance(data, list):
        cookies = []
        for entry in data:
            if isinstance(entry, dict) and "name" in entry and "value" in entry:
                cookie = {
                    "name": entry["name"],
                    "value": entry["value"],
                    "domain": entry.get("domain", ".xiaohongshu.com"),
                    "path": entry.get("path", "/"),
                }
                if "expires" in entry:
                    cookie["expires"] = entry["expires"]
                if "secure" in entry:
                    cookie["secure"] = entry["secure"]
                if "httpOnly" in entry:
                    cookie["httpOnly"] = entry["httpOnly"]
                if "sameSite" in entry:
                    cookie["sameSite"] = entry["sameSite"]
                cookies.append(cookie)
        return cookies

    # xhs-cli format: {"cookies": {name: value, ...}}
    if isinstance(data, dict):
        cookie_dict = data.get("cookies", data)
        if isinstance(cookie_dict, dict):
            return [
                {
                    "name": k,
                    "value": v,
                    "domain": ".xiaohongshu.com",
                    "path": "/",
                }
                for k, v in cookie_dict.items()
                if isinstance(v, str)
            ]

    return []


def parse_count(s: Any) -> int:
    """Parse count string like '1.2万', '3k', '593' to int."""
    if not s:
        return 0
    s = str(s).replace(",", "").strip()
    if "万" in s or "w" in s.lower():
        return round(float(s.replace("万", "").replace("w", "").replace("W", "")) * 10000)
    if "k" in s.lower():
        return round(float(s.replace("k", "").replace("K", "")) * 1000)
    try:
        return int(s)
    except (ValueError, TypeError):
        return 0


# ============================================================================
# Anti-detection stealth JS (adapted from xiaohongshu-skill/scripts/client.py)
# This is the KEY difference that bypasses Xiaohongshu's headless detection.
# ============================================================================
STEALTH_JS = """
// 1. Remove navigator.webdriver flag
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

// 2. Fake chrome runtime object
if (!window.chrome) { window.chrome = {}; }
if (!window.chrome.runtime) {
    window.chrome.runtime = {
        onMessage: { addListener: function(){}, removeListener: function(){} },
        sendMessage: function(){},
        connect: function(){ return { onMessage: { addListener: function(){} }, postMessage: function(){} }; }
    };
}

// 3. Fake plugins array (headless default is empty)
Object.defineProperty(navigator, 'plugins', {
    get: () => {
        const arr = [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
        ];
        arr.item = (i) => arr[i] || null;
        arr.namedItem = (n) => arr.find(p => p.name === n) || null;
        arr.refresh = () => {};
        return arr;
    }
});

// 4. Fake languages
Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en-US', 'en'] });

// 5. Fix Permissions API (headless returns abnormal status)
if (navigator.permissions) {
    const origQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (params) => {
        if (params.name === 'notifications') {
            return Promise.resolve({ state: Notification.permission });
        }
        return origQuery(params);
    };
}

// 6. Fake WebGL renderer info
const getParameter = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(param) {
    if (param === 37445) return 'Intel Inc.';
    if (param === 37446) return 'Intel Iris OpenGL Engine';
    return getParameter.call(this, param);
};

// 7. Hide CDP traces in Error.stack
const origStackGetter = Object.getOwnPropertyDescriptor(Error.prototype, 'stack').get;
Object.defineProperty(Error.prototype, 'stack', {
    get: function() {
        const stack = origStackGetter.call(this);
        if (stack && typeof stack === 'string') {
            return stack.split('\\n').filter(line =>
                !line.includes('__puppeteer_') &&
                !line.includes('__playwright_') &&
                !line.includes('callFunctionOn') &&
                !line.includes('evaluateOnCallFrame')
            ).join('\\n');
        }
        return stack;
    }
});

// 8. Canvas fingerprint randomization
const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
HTMLCanvasElement.prototype.toDataURL = function(type) {
    const ctx = this.getContext('2d');
    if (ctx) {
        const imageData = ctx.getImageData(0, 0, 1, 1);
        imageData.data[0] = imageData.data[0] ^ (Math.random() * 2 | 0);
        ctx.putImageData(imageData, 0, 0);
    }
    return origToDataURL.apply(this, arguments);
};

// 9. Fix outerWidth/outerHeight in headless mode
Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth });
Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight + 100 });
""".strip()


def dismiss_login_popup(page) -> bool:
    """Dismiss login popup via JS DOM removal (not click, which redirects).

    Adapted from xiaohongshu-skill/scripts/search.py _dismiss_login_popup().
    Clicking the close button triggers Xiaohongshu JS to redirect unlogged
    users to the recommendation page. DOM removal keeps the URL unchanged,
    allowing search results to continue loading in the background.
    """
    try:
        popup = page.locator('.login-container')
        if popup.count() == 0 or not popup.first.is_visible():
            return False
    except Exception:
        return False

    log("Login popup detected, removing via JS DOM removal...")
    page.evaluate("""() => {
        // Remove login popup container
        document.querySelectorAll('.login-container').forEach(el => el.remove());
        // Remove possible mask/overlay layers
        document.querySelectorAll('.mask, .overlay, [class*="mask"], [class*="overlay"], .reds-mask').forEach(el => {
            if (el.style && (el.style.position === 'fixed' || el.style.position === 'absolute')) {
                el.remove();
            }
        });
        // Restore page scrolling (popup may have locked body scroll)
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
    }""")
    time.sleep(1)
    return True


def extract_from_state(page, limit: int) -> list[dict]:
    """Extract search results from __INITIAL_STATE__ (SSR path).

    Adapted from xiaohongshu-skill/scripts/search.py _extract_from_state().
    """
    result = page.evaluate("""() => {
        const feeds = window.__INITIAL_STATE__?.search?.feeds;
        const data = feeds?.value || feeds?._value || feeds;
        if (!data || !Array.isArray(data) || data.length === 0) return '';

        return JSON.stringify(data.slice(0, 50).map(item => {
            const nc = item.noteCard || {};
            const user = nc.user || {};
            const info = nc.interactInfo || {};
            const cover = nc.cover || {};
            const corner = nc.cornerTagInfo || [];
            let published = '';
            for (const tag of corner) {
                if (tag.type === 'publish_time') published = tag.text || '';
            }
            return {
                note_id: item.id || nc.noteId || '',
                title: nc.displayTitle || nc.title || '',
                author: user.nickname || user.nickName || '',
                author_id: user.userId || '',
                likes: info.likedCount || '0',
                favorites: info.collectedCount || '0',
                comments: info.commentCount || '0',
                shares: info.sharedCount || info.shareCount || '0',
                published: published,
                note_type: nc.type || '',
                url: item.id ? 'https://www.xiaohongshu.com/explore/' + item.id : '',
                xsec_token: item.xsecToken || item.xsec_token || '',
                cover_url: cover.urlDefault || cover.urlPre || '',
            };
        }));
    }""")
    if not result:
        return []
    try:
        feeds = json.loads(result)
        return feeds[:limit] if limit > 0 else feeds
    except json.JSONDecodeError:
        return []


def extract_from_dom(page, limit: int) -> list[dict]:
    """Extract search results from DOM (client-rendered fallback).

    Adapted from xiaohongshu-skill/scripts/search.py _extract_from_dom().
    """
    result = page.evaluate("""(limit) => {
        const items = document.querySelectorAll('section.note-item');
        if (!items || items.length === 0) return '';

        const results = [];
        for (let i = 0; i < Math.min(items.length, limit); i++) {
            const item = items[i];
            const entry = {};

            // Extract ID and xsec_token from links
            const coverLink = item.querySelector('a.cover[href*="/explore/"]');
            if (coverLink) {
                const href = coverLink.getAttribute('href') || '';
                const idMatch = href.match(/\\/explore\\/([a-f0-9]+)/);
                entry.note_id = idMatch ? idMatch[1] : '';
                const tokenMatch = href.match(/xsec_token=([^&]+)/);
                entry.xsec_token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : '';
            } else {
                const anyLink = item.querySelector('a[href*="/explore/"]');
                if (anyLink) {
                    const href = anyLink.getAttribute('href') || '';
                    const idMatch = href.match(/\\/explore\\/([a-f0-9]+)/);
                    entry.note_id = idMatch ? idMatch[1] : '';
                    const tokenMatch = href.match(/xsec_token=([^&]+)/);
                    entry.xsec_token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : '';
                } else {
                    entry.note_id = '';
                    entry.xsec_token = '';
                }
            }

            // Title
            const titleEl = item.querySelector('.title span, .title, a.title');
            entry.title = titleEl ? titleEl.textContent.trim() : '';

            // Author
            const authorEl = item.querySelector('.author-wrapper .name, .author .name, [class*="author"] .name, .nickname');
            entry.author = authorEl ? authorEl.textContent.trim() : '';

            const authorLink = item.querySelector('a[href*="/user/profile/"]');
            if (authorLink) {
                const href = authorLink.getAttribute('href') || '';
                const uidMatch = href.match(/\\/user\\/profile\\/([a-f0-9]+)/);
                entry.author_id = uidMatch ? uidMatch[1] : '';
            } else {
                entry.author_id = '';
            }

            // Engagement
            const likeEl = item.querySelector('.like-wrapper .count, [class*="like"] .count, .like-count');
            entry.likes = likeEl ? likeEl.textContent.trim() : '0';
            entry.favorites = '0';
            entry.comments = '0';
            entry.shares = '0';
            entry.published = '';
            entry.note_type = '';
            entry.url = entry.note_id ? 'https://www.xiaohongshu.com/explore/' + entry.note_id : '';
            entry.cover_url = '';

            results.push(entry);
        }
        return JSON.stringify(results);
    }""", limit if limit > 0 else 50)

    if not result:
        return []
    try:
        return json.loads(result)
    except json.JSONDecodeError:
        return []


def search_with_edge(keyword: str, limit: int, cookie_file: str) -> list[dict]:
    """Search Xiaohongshu using Playwright persistent context.

    Key anti-detection features:
    1. launch_persistent_context() — maintains browser state across sessions
    2. ignore_default_args=['--enable-automation'] — removes automation flag
    3. Comprehensive stealth JS injected via add_init_script()
    4. Login popup dismissal via DOM removal
    5. Both __INITIAL_STATE__ and DOM extraction
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log("Playwright not installed")
        return []

    # Find browser executable
    edge_path = find_edge_executable()
    chromium_path = find_chromium_executable()
    browser_path = edge_path or chromium_path
    if not browser_path:
        log("No browser found (Edge or Chromium)")
        return []

    browser_name = "Edge" if edge_path else "Chromium"
    log(f"Using browser: {browser_name} ({browser_path})")

    # Load cookies
    cookies = load_cookies(cookie_file)
    if not cookies:
        log("No cookies available — login required first")
        return []

    cookie_names = {c["name"] for c in cookies}
    if "web_session" not in cookie_names:
        log("Missing web_session cookie — login may have expired")
        return []

    log(f"Loaded {len(cookies)} cookies from {cookie_file}")

    # Persistent user data directory (project-local, sandbox-safe)
    # This maintains browser state (cookies, localStorage, fingerprint) across sessions
    user_data_dir = Path(__file__).resolve().parent.parent / "data" / "browser-data"
    user_data_dir.mkdir(parents=True, exist_ok=True)
    log(f"User data dir: {user_data_dir}")

    # URL-encode the keyword
    from urllib.parse import quote
    encoded_keyword = quote(keyword)

    results: list[dict] = []

    with sync_playwright() as p:
        try:
            # KEY CHANGE: Use launch_persistent_context instead of launch() + new_context()
            # This maintains browser state across sessions and is harder to detect
            launch_args = {
                "user_data_dir": str(user_data_dir),
                "headless": True,
                "viewport": {"width": 1920, "height": 1080},
                "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
                "locale": "zh-CN",
                "timezone_id": "Asia/Shanghai",
                "args": [
                    "--disable-blink-features=AutomationControlled",
                    "--disable-features=AutomationControlled",
                    "--no-sandbox",
                    "--disable-infobars",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                ],
                "ignore_default_args": ["--enable-automation"],
            }

            # Use executable_path only if we have a specific browser
            if edge_path:
                launch_args["executable_path"] = edge_path

            context = p.chromium.launch_persistent_context(**launch_args)
        except Exception as e:
            log(f"Failed to launch persistent context: {e}")
            return []

        # Inject comprehensive stealth JS (runs before every page load)
        context.add_init_script(STEALTH_JS)

        # If persistent context is new but we have cookie backup, migrate
        existing_cookies = context.cookies()
        if not existing_cookies and cookies:
            context.add_cookies(cookies)
            log(f"Migrated {len(cookies)} cookies to persistent context")
        elif existing_cookies:
            log(f"Persistent context already has {len(existing_cookies)} cookies")
            # Also add any missing cookies from backup
            existing_names = {c["name"] for c in existing_cookies}
            missing = [c for c in cookies if c["name"] not in existing_names]
            if missing:
                context.add_cookies(missing)
                log(f"Added {len(missing)} missing cookies from backup")

        # Get or create page
        if context.pages:
            page = context.pages[0]
        else:
            page = context.new_page()
        page.set_default_timeout(60000)

        # Set up XHR response interception to capture search API responses
        # Xiaohongshu search API: /api/sns/web/v1/search/notes
        captured_search_responses: list[dict] = []

        def on_response(response):
            try:
                url = response.url
                if "/api/sns/web/v1/search/notes" in url or "/api/sns/web/v2/search/notes" in url:
                    status = response.status
                    try:
                        body = response.text()
                    except Exception:
                        body = "<unreadable>"
                    captured_search_responses.append({
                        "url": url,
                        "status": status,
                        "body_preview": body[:500] if body else "",
                    })
                    log(f"  [XHR] Search API response: status={status}, body_len={len(body)}")
                    if status != 200:
                        log(f"  [XHR] Error response: {body[:300]}")
            except Exception:
                pass

        page.on("response", on_response)

        # Step 1: Navigate directly to search page (skip homepage to avoid explore feed pollution)
        # Going to homepage first loads explore feed into DOM, which pollutes DOM extraction.
        # Direct search page navigation lets the search API execute automatically.
        # ⚠️ 修复: 移除 source=web_explore_feed 参数，该参数会导致小红书返回推荐流内容而非搜索结果
        # 改用 source=web_search_result 确保返回的是搜索结果
        from urllib.parse import quote
        encoded_keyword = quote(keyword)
        search_url = f"https://www.xiaohongshu.com/search_result?keyword={encoded_keyword}&source=web_search_result"
        log(f"Step 1: Navigating directly to search page...")
        log(f"Search URL: {search_url}")
        try:
            page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
            time.sleep(3)
            # Wait for network to settle
            try:
                page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:
                pass
        except Exception as e:
            log(f"Search page navigation failed: {e}")
            context.close()
            return []

        # Check if redirected to login
        if "login" in page.url.lower() and "search_result" not in page.url.lower():
            log("Redirected to login page — cookies may be expired")
            context.close()
            return []

        log(f"Search page URL: {page.url}")
        log(f"Page title: {page.title()}")

        # Wait for network to settle after search page load
        try:
            page.wait_for_load_state("networkidle", timeout=15000)
            log("Network idle after search page load")
        except Exception:
            log("Network didn't settle, continuing anyway...")

        # Debug: check page content for captcha/login indicators
        try:
            page_info = page.evaluate("""() => {
                const body = document.body ? document.body.innerHTML : '';
                return {
                    bodyLength: body.length,
                    hasLoginContainer: !!document.querySelector('.login-container'),
                    hasCaptcha: body.includes('captcha') || body.includes('验证') || body.includes('security'),
                    hasLoginText: body.includes('登录探索更多内容') || body.includes('扫码登录'),
                    noteItemCount: document.querySelectorAll('section.note-item').length,
                    feedsLinkCount: document.querySelectorAll('a[href*="/explore/"]').length,
                    hasNoResult: body.includes('没有找到') || body.includes('暂无结果'),
                };
            }""")
            log(f"Page debug: {json.dumps(page_info, ensure_ascii=False)}")
        except Exception as e:
            log(f"Page debug failed: {e}")

        # Step 3: Dismiss login popup if present (DOM removal, not click)
        log("Step 3: Checking for login popup...")
        for _ in range(3):
            if dismiss_login_popup(page):
                log("Login popup dismissed")
            else:
                break
            time.sleep(1)

        # Also press Escape to close any remaining modal
        try:
            page.keyboard.press("Escape")
            time.sleep(1)
        except Exception:
            pass

        # Step 4: Wait for __INITIAL_STATE__ to load
        log("Step 4: Waiting for __INITIAL_STATE__ to load...")
        try:
            page.wait_for_function(
                "() => window.__INITIAL_STATE__ !== undefined",
                timeout=30000,
            )
            log("__INITIAL_STATE__ loaded")
        except Exception:
            log("__INITIAL_STATE__ wait timed out, continuing anyway...")

        time.sleep(3)

        # Step 5: Scroll to trigger loading more content
        log("Step 5: Scrolling to load more content...")
        for _ in range(3):
            try:
                page.evaluate("window.scrollBy(0, 500)")
                time.sleep(0.5)
            except Exception:
                break

        # Step 6: Wait for search results to populate
        log("Step 6: Waiting for search results to render (up to 30s)...")
        found_results = False
        for wait_round in range(15):
            time.sleep(2)
            try:
                feed_count = page.evaluate("""
                () => {
                    if (!window.__INITIAL_STATE__ || !window.__INITIAL_STATE__.search) return 0;
                    const feeds = window.__INITIAL_STATE__.search.feeds;
                    if (!feeds) return 0;
                    if (typeof feeds === 'object' && feeds !== null) {
                        if ('_value' in feeds && Array.isArray(feeds._value)) return feeds._value.length;
                        if ('value' in feeds && Array.isArray(feeds.value)) return feeds.value.length;
                        if (Array.isArray(feeds)) return feeds.length;
                    }
                    return 0;
                }
                """)
                if feed_count > 0:
                    log(f"  Round {wait_round + 1}: found {feed_count} feeds in __INITIAL_STATE__")
                    found_results = True
                    break
                if wait_round % 3 == 0:
                    log(f"  Round {wait_round + 1}: still waiting (feeds=0)...")
            except Exception as e:
                log(f"  Round {wait_round + 1}: error checking feeds: {e}")

        # Log captured XHR responses
        if captured_search_responses:
            log(f"Captured {len(captured_search_responses)} search API responses:")
            for resp in captured_search_responses:
                log(f"  status={resp['status']}, body_preview={resp['body_preview'][:200]}")
        else:
            log("No search API XHR responses captured — search may require manual trigger")

            # Try to trigger search manually by typing in search input
            log("Trying to trigger search manually...")
            try:
                search_input = page.locator("input[placeholder*='搜索'], input.search-input, #search-input, input#search-text").first
                if search_input.count() > 0:
                    log("Found search input, typing keyword and pressing Enter...")
                    search_input.click()
                    time.sleep(1)
                    search_input.fill(keyword)
                    time.sleep(1)
                    page.keyboard.press("Enter")
                    time.sleep(5)

                    # Wait for networkidle after manual search
                    try:
                        page.wait_for_load_state("networkidle", timeout=10000)
                    except Exception:
                        pass

                    # Check feeds again
                    feed_count = page.evaluate("""
                    () => {
                        if (!window.__INITIAL_STATE__ || !window.__INITIAL_STATE__.search) return 0;
                        const feeds = window.__INITIAL_STATE__.search.feeds;
                        if (!feeds) return 0;
                        if (typeof feeds === 'object' && feeds !== null) {
                            if ('_value' in feeds && Array.isArray(feeds._value)) return feeds._value.length;
                            if ('value' in feeds && Array.isArray(feeds.value)) return feeds.value.length;
                            if (Array.isArray(feeds)) return feeds.length;
                        }
                        return 0;
                    }
                    """)
                    log(f"After manual search: {feed_count} feeds")
                    if feed_count > 0:
                        found_results = True
                else:
                    log("No search input found on page")
            except Exception as e:
                log(f"Manual search trigger failed: {e}")

        # Also check DOM for note items
        try:
            dom_count = page.locator('section.note-item').count()
            log(f"DOM note-item count: {dom_count}")
        except Exception:
            dom_count = 0

        # Step 7: Extract results — try __INITIAL_STATE__ first, then DOM fallback
        log("Step 7: Extracting search results...")
        raw_results = extract_from_state(page, limit)
        if raw_results:
            log(f"Extracted {len(raw_results)} results from __INITIAL_STATE__")
        else:
            log("__INITIAL_STATE__ has no data, trying DOM extraction...")
            raw_results = extract_from_dom(page, limit)
            if raw_results:
                log(f"Extracted {len(raw_results)} results from DOM")
            else:
                log("No results from either extraction method")

        # Step 8: Scroll more to load additional results
        if raw_results and len(raw_results) < limit:
            log("Step 8: Scrolling for more results...")
            for i in range(min(5, (limit // 20) + 1)):
                try:
                    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    time.sleep(2)
                except Exception:
                    break

            # Re-extract after scrolling
            more_results = extract_from_state(page, limit)
            if len(more_results) > len(raw_results):
                raw_results = more_results
                log(f"After scrolling: {len(raw_results)} results")
            else:
                more_dom = extract_from_dom(page, limit)
                if len(more_dom) > len(raw_results):
                    raw_results = more_dom
                    log(f"After scrolling (DOM): {len(raw_results)} results")

        # Step 9: Build final results
        for item in raw_results[:limit]:
            note_id = item.get("note_id", "")
            results.append({
                "source_platform": "xhs",
                "url": item.get("url", ""),
                "title": item.get("title", ""),
                "text": item.get("title", ""),
                "author": item.get("author", ""),
                "author_followers": 0,
                "likes": parse_count(item.get("likes", 0)),
                "favorites": parse_count(item.get("favorites", 0)),
                "comments": parse_count(item.get("comments", 0)),
                "shares": parse_count(item.get("shares", 0)),
                "posted_at": item.get("published", ""),
                "keyword_matched": keyword,
                "engagement_score": 0,
                "content_hash": "",
                "tags": [],
                "ip_location": "",
                "note_id": note_id,
                "xsec_token": item.get("xsec_token", ""),
            })

        # Step 10: Fetch detail for top posts (optional)
        top_n = min(5, len(results))
        if top_n > 0:
            log(f"Step 10: Fetching detail for top {top_n} posts...")

        for idx, result in enumerate(results[:top_n]):
            note_id = result.get("note_id", "")
            if not note_id:
                continue

            log(f"  [{idx + 1}/{top_n}] reading {note_id}...")
            detail_url = f"https://www.xiaohongshu.com/explore/{note_id}"
            if result.get("xsec_token"):
                detail_url += f"?xsec_token={result['xsec_token']}&xsec_source=pc_feed"

            try:
                page.goto(detail_url, wait_until="domcontentloaded", timeout=15000)
                time.sleep(2)

                # Extract note detail
                detail_data = page.evaluate("""
                () => {
                    const unwrap = (obj, depth) => {
                        if (depth > 6 || obj === null || obj === undefined) return obj;
                        if (typeof obj !== 'object') return obj;
                        if ('_value' in obj && 'dep' in obj) return unwrap(obj._value, depth + 1);
                        if ('value' in obj && 'dep' in obj) return unwrap(obj.value, depth + 1);
                        if (Array.isArray(obj)) return obj.map(item => unwrap(item, depth + 1));
                        const result = {};
                        for (const key of Object.keys(obj)) {
                            if (key === 'dep' || key.startsWith('__')) continue;
                            try { result[key] = unwrap(obj[key], depth + 1); } catch(e) {}
                        }
                        return result;
                    };
                    const state = window.__INITIAL_STATE__;
                    if (!state) return {};
                    const unwrapped = unwrap(state, 0);
                    const noteMap = unwrapped?.note?.noteDetailMap || {};
                    const firstKey = Object.keys(noteMap)[0];
                    if (!firstKey) return {};
                    const note = noteMap[firstKey]?.note || {};
                    return {
                        title: note.title || '',
                        desc: note.desc || '',
                        tags: (note.tagList || []).map(t => t.name || ''),
                        interact: note.interactInfo || {},
                        user: note.user || {},
                        ipLocation: note.ipLocation || '',
                        time: note.time || 0,
                    };
                }
                """)

                if detail_data:
                    result["text"] = detail_data.get("desc", "") or detail_data.get("title", "")
                    result["title"] = detail_data.get("title", "") or result["title"]
                    result["tags"] = detail_data.get("tags", [])
                    result["ip_location"] = detail_data.get("ipLocation", "")

                    interact = detail_data.get("interact", {})
                    if interact:
                        result["likes"] = parse_count(interact.get("likedCount", 0))
                        result["favorites"] = parse_count(interact.get("collectedCount", 0))
                        result["comments"] = parse_count(interact.get("commentCount", 0))

                    user = detail_data.get("user", {})
                    if user.get("nickname"):
                        result["author"] = user["nickname"]

                    ts = detail_data.get("time", 0)
                    if ts:
                        from datetime import datetime, timezone
                        result["posted_at"] = datetime.fromtimestamp(
                            ts / 1000, tz=timezone.utc
                        ).strftime("%Y-%m-%d %H:%M")

                    log(f"    OK: body={len(result['text'])} chars")

            except Exception as e:
                log(f"    Failed: {e}")

            time.sleep(2)

        # Save cookies back to persistent context for next session
        try:
            final_cookies = context.cookies()
            log(f"Persistent context now has {len(final_cookies)} cookies")
        except Exception:
            pass

        context.close()

    log(f"Search complete: {len(results)} results for '{keyword}'")
    return results


def main():
    parser = argparse.ArgumentParser(description="Search XHS via Playwright persistent context")
    parser.add_argument("--keyword", required=True, help="Search keyword")
    parser.add_argument("--limit", type=int, default=30, help="Max results")
    parser.add_argument(
        "--cookie-file",
        default="",
        help="Path to cookie JSON file (Playwright or xhs-cli format)",
    )
    args = parser.parse_args()

    # Auto-detect cookie file if not specified
    cookie_file = args.cookie_file
    if not cookie_file:
        project_cookies = Path(__file__).resolve().parent.parent / "data" / "cookies"
        candidates = [
            project_cookies / "xiaohongshu-skill.json",
            project_cookies / "xhs-content.json",
            Path.home() / ".xiaohongshu" / "cookies.json",
            Path.home() / ".xhs-cli" / "cookies.json",
        ]
        for c in candidates:
            if c.exists():
                cookie_file = str(c)
                log(f"Auto-detected cookie file: {cookie_file}")
                break

    results = search_with_edge(args.keyword, args.limit, cookie_file)
    print(json.dumps(results, ensure_ascii=False))


if __name__ == "__main__":
    main()
