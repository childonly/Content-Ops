"""自定义长文发布脚本

修复问题：xiaohongshu-skill 的 publish.py 中 get_by_text("写长文") 定位到 <span> 元素，
但父元素 div.creator-tab 拦截了点击事件，导致 Timeout 60000ms exceeded。

解决方案：直接点击父元素 div.creator-tab，或使用 force=True 绕过事件拦截。
"""
from __future__ import annotations

import json
import os
import sys
import time
import random
from typing import Any

# 添加 xiaohongshu-skill 到路径
# 优先使用环境变量 XHS_SKILL_PATH,其次使用 xhs-auto-pipeline 的 config,最后使用默认路径
SKILL_PATH = os.environ.get("XHS_SKILL_PATH", r"C:\Users\wml1027\.trae-cn\skills\xiaohongshu-skill")
sys.path.insert(0, SKILL_PATH)

from scripts.client import XiaohongshuClient

PUBLISH_URL = "https://creator.xiaohongshu.com/publish/publish?source=official"


def publish_longform_fixed(
    title: str,
    content: str,
    auto_publish: bool = False,
    headless: bool = False,
) -> dict[str, Any]:
    """发布长文笔记（修复了点击拦截问题）

    流程：导航到创作者中心 → 点击「写长文」→「新的创作」→ 输入标题正文 → 发布
    """
    print(f"启动浏览器 (headless={headless})...", file=sys.stderr)
    client = XiaohongshuClient(headless=headless)
    client.start()
    page = client.page

    try:
        # 1. 导航到创作者中心发布页
        print("导航到创作者中心发布页...", file=sys.stderr)
        client.navigate(PUBLISH_URL)
        time.sleep(random.uniform(2.0, 3.5))

        current_url = page.url
        print(f"当前 URL: {current_url}", file=sys.stderr)

        # 检查是否被重定向到登录页
        if "login" in current_url.lower():
            return {
                "status": "error",
                "error_type": "LoginRequired",
                "message": "创作者中心需要登录，请先运行 creator_login.py",
            }

        # 2. 点击「写长文」- 修复点击拦截问题
        print("点击「写长文」...", file=sys.stderr)
        clicked = False

        # 方案1：直接点击包含"写长文"的 div.creator-tab 父元素
        try:
            tab_locator = page.locator('div.creator-tab:has-text("写长文")')
            if tab_locator.count() > 0:
                tab_locator.first.click(timeout=15000)
                clicked = True
                print("已点击「写长文」(div.creator-tab)", file=sys.stderr)
        except Exception as e:
            print(f"方案1失败: {e}", file=sys.stderr)

        # 方案2：用 force=True 绕过事件拦截
        if not clicked:
            try:
                longform_btn = page.get_by_text("写长文", exact=True)
                if longform_btn.count() > 0:
                    longform_btn.first.click(force=True, timeout=15000)
                    clicked = True
                    print("已点击「写长文」(force=True)", file=sys.stderr)
            except Exception as e:
                print(f"方案2失败: {e}", file=sys.stderr)

        # 方案3：用 JavaScript 直接点击
        if not clicked:
            try:
                result = page.evaluate("""() => {
                    const tabs = document.querySelectorAll('div.creator-tab, div[class*="tab"]');
                    for (const tab of tabs) {
                        if (tab.textContent.includes('写长文')) {
                            tab.click();
                            return true;
                        }
                    }
                    // 尝试点击任何包含"写长文"的元素
                    const all = document.querySelectorAll('*');
                    for (const el of all) {
                        if (el.textContent.trim() === '写长文' && el.children.length === 0) {
                            el.click();
                            return true;
                        }
                    }
                    return false;
                }""")
                if result:
                    clicked = True
                    print("已点击「写长文」(JS evaluate)", file=sys.stderr)
            except Exception as e:
                print(f"方案3失败: {e}", file=sys.stderr)

        if not clicked:
            return {
                "status": "error",
                "error_type": "ClickFailed",
                "message": "所有点击方案均失败，未找到「写长文」元素",
            }

        time.sleep(random.uniform(1.5, 3.0))

        # 3. 点击「新的创作」
        print("点击「新的创作」...", file=sys.stderr)
        try:
            new_btn = page.get_by_text("新的创作", exact=False)
            if new_btn.count() > 0:
                new_btn.first.click(timeout=10000)
                time.sleep(random.uniform(2.0, 3.5))
                print("已点击「新的创作」", file=sys.stderr)
        except Exception as e:
            print(f"点击「新的创作」失败（可能已在编辑页）: {e}", file=sys.stderr)

        # 4. 输入标题
        print(f"填写标题: {title}", file=sys.stderr)
        try:
            title_input = page.locator('input[placeholder*="标题"], div.title-input input, div.d-input input, input[placeholder*="title"]')
            if title_input.count() > 0:
                title_input.first.fill(title)
                time.sleep(random.uniform(0.5, 1.5))
            else:
                # 回退：用 JavaScript 查找标题输入框
                page.evaluate(f"""() => {{
                    const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
                    for (const input of inputs) {{
                        if (input.placeholder && input.placeholder.includes('标题')) {{
                            input.value = {json.dumps(title)};
                            input.dispatchEvent(new Event('input', {{bubbles: true}}));
                            return true;
                        }}
                    }}
                    if (inputs.length > 0) {{
                        inputs[0].value = {json.dumps(title)};
                        inputs[0].dispatchEvent(new Event('input', {{bubbles: true}}));
                        return true;
                    }}
                    return false;
                }}""")
        except Exception as e:
            print(f"填写标题失败: {e}", file=sys.stderr)

        # 5. 输入正文
        print("填写正文...", file=sys.stderr)
        time.sleep(random.uniform(0.5, 1.0))
        try:
            editor = None
            for selector in ['div.ql-editor', '[role="textbox"]', 'div[contenteditable="true"]', 'div.editor-content']:
                loc = page.locator(selector)
                if loc.count() > 0:
                    editor = loc.first
                    break

            if editor:
                editor.click()
                time.sleep(random.uniform(0.3, 0.8))
                page.keyboard.type(content, delay=random.randint(15, 40))
                time.sleep(random.uniform(0.5, 1.5))
                print("正文已填写", file=sys.stderr)
            else:
                print("未找到正文编辑器", file=sys.stderr)
        except Exception as e:
            print(f"填写正文失败: {e}", file=sys.stderr)

        # 6. 发布（如果 auto_publish=True）
        if auto_publish:
            print("尝试发布...", file=sys.stderr)
            time.sleep(random.uniform(1.0, 2.0))

            # 查找并点击发布按钮
            published = False
            for btn_text in ["发布", "发布笔记", "一键发布"]:
                try:
                    btn = page.get_by_text(btn_text, exact=False)
                    if btn.count() > 0:
                        btn.first.click(timeout=10000)
                        published = True
                        print(f"已点击「{btn_text}」", file=sys.stderr)
                        break
                except:
                    continue

            if not published:
                # 回退：用 JavaScript 查找发布按钮
                try:
                    result = page.evaluate("""() => {
                        const buttons = document.querySelectorAll('button, div[class*="publish"], span[class*="publish"]');
                        for (const btn of buttons) {
                            if (btn.textContent.includes('发布') && !btn.textContent.includes('草稿')) {
                                btn.click();
                                return true;
                            }
                        }
                        return false;
                    }""")
                    if result:
                        published = True
                        print("已通过JS点击发布按钮", file=sys.stderr)
                except:
                    pass

            if published:
                time.sleep(random.uniform(2.0, 4.0))
                print("发布成功！", file=sys.stderr)
                return {
                    "status": "success",
                    "action": "publish_longform",
                    "title": title,
                    "message": "长文发布成功",
                }
            else:
                return {
                    "status": "error",
                    "action": "publish_longform",
                    "message": "未找到发布按钮",
                }
        else:
            return {
                "status": "ready",
                "action": "publish_longform",
                "title": title,
                "message": "已填写完毕，请手动确认发布",
            }

    except Exception as e:
        print(f"发布异常: {e}", file=sys.stderr)
        return {
            "status": "error",
            "error_type": type(e).__name__,
            "message": str(e),
        }
    finally:
        client.close()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="自定义长文发布（修复点击拦截）")
    parser.add_argument("--title", required=True, help="笔记标题")
    parser.add_argument("--content", required=True, help="笔记正文")
    parser.add_argument("--auto-publish", action="store_true", help="自动发布")
    parser.add_argument("--headless", default="false", help="无头模式 (true/false)")
    args = parser.parse_args()

    headless = args.headless.lower() in ("true", "1", "yes")
    result = publish_longform_fixed(
        title=args.title,
        content=args.content,
        auto_publish=args.auto_publish,
        headless=headless,
    )
    print(json.dumps(result, ensure_ascii=False))
