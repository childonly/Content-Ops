/**
 * 卡片渲染服务 — 基于 Auto-Redbook-Skills 设计理念的 TypeScript 实现
 *
 * 功能：
 *   - 将 Markdown 内容渲染为 1080×1440 的小红书卡片 PNG
 *   - 支持 8 套主题（default / sketch / playful-geometric / neo-brutalism / botanical / professional / retro / terminal）
 *   - 支持 4 种分页模式（separator / auto-fit / auto-split / dynamic）
 *   - 封面 + 正文卡片一体化渲染
 *
 * 架构：
 *   Markdown 解析 → 内容分页 → HTML 模板渲染 → Playwright 截图 → PNG 输出
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { chromium, type Browser, type Page } from 'playwright'
import { createServiceLogger } from '../../utils/logger';

const log = createServiceLogger('card-render')

// ============================================================================
// 类型定义
// ============================================================================

export type CardTheme =
  | 'default'
  | 'sketch'
  | 'playful-geometric'
  | 'neo-brutalism'
  | 'botanical'
  | 'professional'
  | 'retro'
  | 'terminal'

export type PaginationMode = 'separator' | 'auto-fit' | 'auto-split' | 'dynamic'

export interface CardRenderOptions {
  /** 主题 */
  theme?: CardTheme
  /** 分页模式 */
  mode?: PaginationMode
  /** 输出目录 */
  outputDir?: string
  /** 卡片宽度（默认 1080） */
  width?: number
  /** 卡片高度（默认 1440，dynamic 模式下为最小高度） */
  height?: number
  /** 封面标题（如提供则生成封面） */
  title?: string
  /** 封面副标题 */
  subtitle?: string
  /** 封面 emoji */
  emoji?: string
  /** 文件前缀 */
  prefix?: string
}

export interface RenderResult {
  /** 封面图片路径（如有） */
  cover?: string
  /** 正文卡片图片路径列表 */
  cards: string[]
  /** 所有图片（封面在前） */
  allImages: string[]
  /** 使用的主题 */
  theme: CardTheme
  /** 使用的分页模式 */
  mode: PaginationMode
  /** 卡片数量 */
  cardCount: number
}

export interface ParsedMarkdown {
  frontmatter: {
    emoji?: string
    title?: string
    subtitle?: string
  }
  body: string
}

// ============================================================================
// 常量
// ============================================================================

const DEFAULT_WIDTH = 1080
const DEFAULT_HEIGHT = 1440
const DEFAULT_THEME: CardTheme = 'sketch'
const DEFAULT_MODE: PaginationMode = 'separator'

const TEMPLATE_DIR = path.join(__dirname, 'templates')
const THEME_DIR = path.join(__dirname, 'themes')

// ============================================================================
// 浏览器单例管理
// ============================================================================

let browser: Browser | null = null
let browserRefCount = 0

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    log.info('Launching Playwright Chromium browser...')
    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    browserRefCount = 0
  }
  browserRefCount++
  return browser
}

async function releaseBrowser(): Promise<void> {
  browserRefCount--
  if (browserRefCount <= 0 && browser) {
    // 延迟关闭，避免频繁启动
    setTimeout(async () => {
      if (browser && browserRefCount <= 0) {
        log.info('Closing Playwright browser (idle timeout)')
        await browser.close()
        browser = null
        browserRefCount = 0
      }
    }, 30000)
  }
}

// ============================================================================
// Markdown 解析
// ============================================================================

/**
 * 解析带 frontmatter 的 Markdown
 */
function parseMarkdown(md: string): ParsedMarkdown {
  const result: ParsedMarkdown = {
    frontmatter: {},
    body: md,
  }

  // 匹配 --- 包裹的 frontmatter
  const fmMatch = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/)
  if (fmMatch) {
    const fmText = fmMatch[1]
    const fm: Record<string, string> = {}
    for (const line of fmText.split('\n')) {
      const colonIdx = line.indexOf(':')
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim()
        let value = line.slice(colonIdx + 1).trim()
        // 去除引号
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        fm[key] = value
      }
    }
    result.frontmatter = fm
    result.body = md.slice(fmMatch[0].length)
  }

  return result
}

// ============================================================================
// 内容分页
// ============================================================================

/**
 * 根据分页模式将内容拆分为多个卡片页面
 */
function paginateContent(body: string, mode: PaginationMode): string[] {
  switch (mode) {
    case 'separator':
      return paginateBySeparator(body)
    case 'auto-fit':
    case 'auto-split':
    case 'dynamic':
      // auto-fit / auto-split / dynamic 在渲染时由 CSS 和 Playwright 处理
      // 这里先返回单页，后续在渲染时根据实际高度拆分
      return [body.trim()]
    default:
      return [body.trim()]
  }
}

function paginateBySeparator(body: string): string[] {
  const parts = body.split(/\n---\s*\n/)
  return parts.map(p => p.trim()).filter(Boolean)
}

// ============================================================================
// 简单 Markdown → HTML 转换（足够卡片渲染使用）
// ============================================================================

function markdownToHtml(md: string): string {
  let html = md
    // 转义 HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // 标题
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')

  // 粗体
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

  // 斜体
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // 列表
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>\n${m}</ul>\n`)

  // 段落（非标签的行）
  const lines = html.split('\n')
  const result: string[] = []
  let inParagraph = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (inParagraph) {
        result.push('</p>')
        inParagraph = false
      }
      continue
    }
    if (trimmed.startsWith('<')) {
      if (inParagraph) {
        result.push('</p>')
        inParagraph = false
      }
      result.push(line)
    } else {
      if (!inParagraph) {
        result.push('<p>')
        inParagraph = true
      }
      result.push(line)
    }
  }
  if (inParagraph) {
    result.push('</p>')
  }

  return result.join('\n')
}

// ============================================================================
// HTML 模板加载
// ============================================================================

function loadTemplate(name: string): string {
  const filePath = path.join(TEMPLATE_DIR, name)
  return fs.readFileSync(filePath, 'utf-8')
}

function loadThemeCss(theme: CardTheme): string {
  const filePath = path.join(THEME_DIR, `${theme}.css`)
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8')
  }
  log.warn(`Theme ${theme} not found, falling back to default`)
  const defaultPath = path.join(THEME_DIR, 'default.css')
  return fs.readFileSync(defaultPath, 'utf-8')
}

// ============================================================================
// HTML 生成
// ============================================================================

/**
 * 生成封面 HTML
 */
function buildCoverHtml(
  title: string,
  subtitle: string,
  emoji: string,
  theme: CardTheme,
  width: number,
  height: number,
): string {
  const template = loadTemplate('cover.html')
  const themeCss = loadThemeCss(theme)

  return template
    .replace('{{WIDTH}}', String(width))
    .replace('{{HEIGHT}}', String(height))
    .replace('{{THEME_CSS}}', themeCss)
    .replace('{{EMOJI}}', emoji || '✨')
    .replace('{{TITLE}}', escapeHtml(title))
    .replace('{{SUBTITLE}}', escapeHtml(subtitle || ''))
}

/**
 * 生成正文卡片 HTML
 */
function buildCardHtml(
  contentHtml: string,
  theme: CardTheme,
  width: number,
  height: number,
  mode: PaginationMode,
): string {
  const template = loadTemplate('card.html')
  const themeCss = loadThemeCss(theme)
  const modeClass = `mode-${mode}`

  return template
    .replace('{{WIDTH}}', String(width))
    .replace('{{HEIGHT}}', String(height))
    .replace('{{THEME_CSS}}', themeCss)
    .replace('{{MODE_CLASS}}', modeClass)
    .replace('{{CONTENT}}', contentHtml)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ============================================================================
// Playwright 截图渲染
// ============================================================================

/**
 * 将 HTML 字符串渲染为 PNG 图片
 */
async function renderHtmlToPng(
  page: Page,
  html: string,
  outputPath: string,
  width: number,
  height: number,
  mode: PaginationMode,
): Promise<{ path: string; actualHeight: number }> {
  await page.setViewportSize({ width, height: mode === 'dynamic' ? 800 : height })
  await page.setContent(html, { waitUntil: 'networkidle' })

  // 等待字体和样式加载
  await page.waitForTimeout(300)

  if (mode === 'dynamic') {
    // 动态高度：获取内容实际高度，然后用完整页面截图
    const actualHeight = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      const card = doc.querySelector('.card-container');
      return card ? card.scrollHeight : 1440;
    })
    const finalHeight = Math.max(height, Math.min(actualHeight + 40, 3000))
    await page.setViewportSize({ width, height: finalHeight })
    await page.waitForTimeout(100)

    await page.screenshot({
      path: outputPath,
      type: 'png',
      fullPage: false,
    })
    return { path: outputPath, actualHeight: finalHeight }
  } else {
    // 固定高度：直接截图
    await page.screenshot({
      path: outputPath,
      type: 'png',
      fullPage: false,
    })
    return { path: outputPath, actualHeight: height }
  }
}

// ============================================================================
// auto-split 模式：自动根据内容高度拆分为多张卡片
// ============================================================================

async function autoSplitRender(
  page: Page,
  bodyHtml: string,
  theme: CardTheme,
  width: number,
  height: number,
  outputDir: string,
  prefix: string,
): Promise<string[]> {
  // 先渲染完整内容，测量总高度
  const fullHtml = buildCardHtml(bodyHtml, theme, width, height * 10, 'auto-fit')
  await page.setViewportSize({ width, height: height * 5 })
  await page.setContent(fullHtml, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)

  const totalHeight = await page.evaluate(() => {
    const doc = (globalThis as any).document;
    const content = doc.querySelector('.card-content');
    return content ? content.scrollHeight : 1440;
  })

  const cards: string[] = []
  if (totalHeight <= height - 120) {
    // 内容不足一屏，直接生成一张
    const cardPath = path.join(outputDir, `${prefix}card_1.png`)
    const singleHtml = buildCardHtml(bodyHtml, theme, width, height, 'auto-fit')
    await renderHtmlToPng(page, singleHtml, cardPath, width, height, 'auto-fit')
    cards.push(cardPath)
    return cards
  }

  // 计算需要的页数
  const usableHeight = height - 120 // 上下内边距
  const pageCount = Math.ceil(totalHeight / usableHeight)

  for (let i = 0; i < pageCount; i++) {
    const cardPath = path.join(outputDir, `${prefix}card_${i + 1}.png`)
    // 用 CSS transform 偏移内容，模拟分页
    const offsetY = -(i * usableHeight)
    const paginatedHtml = buildPaginatedCardHtml(
      bodyHtml, theme, width, height, offsetY,
    )
    await renderHtmlToPng(page, paginatedHtml, cardPath, width, height, 'auto-fit')
    cards.push(cardPath)
  }

  return cards
}

function buildPaginatedCardHtml(
  contentHtml: string,
  theme: CardTheme,
  width: number,
  height: number,
  offsetY: number,
): string {
  const template = loadTemplate('card.html')
  const themeCss = loadThemeCss(theme)

  const paginatedContent = `
    <div class="card-content-wrapper" style="transform: translateY(${offsetY}px);">
      ${contentHtml}
    </div>
  `

  return template
    .replace('{{WIDTH}}', String(width))
    .replace('{{HEIGHT}}', String(height))
    .replace('{{THEME_CSS}}', themeCss)
    .replace('{{MODE_CLASS}}', 'mode-auto-split')
    .replace('{{CONTENT}}', paginatedContent)
}

// ============================================================================
// 主入口
// ============================================================================

/**
 * 渲染小红书卡片
 *
 * @param markdown 内容（支持 frontmatter）
 * @param options 渲染选项
 * @returns 渲染结果（封面 + 卡片路径）
 */
export async function renderCards(
  markdown: string,
  options: CardRenderOptions = {},
): Promise<RenderResult> {
  const theme = options.theme || DEFAULT_THEME
  const mode = options.mode || DEFAULT_MODE
  const width = options.width || DEFAULT_WIDTH
  const height = options.height || DEFAULT_HEIGHT
  const prefix = options.prefix || ''

  // 输出目录
  const outputDir = options.outputDir || fs.mkdtempSync(path.join(os.tmpdir(), 'card-render-'))
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  log.info(`Rendering cards: theme=${theme}, mode=${mode}, size=${width}x${height}`)

  // 解析 Markdown
  const parsed = parseMarkdown(markdown)
  const fm = parsed.frontmatter
  const title = options.title || fm.title || ''
  const subtitle = options.subtitle || fm.subtitle || ''
  const emoji = options.emoji || fm.emoji || '✨'

  // 分页
  const pages = paginateContent(parsed.body, mode)
  log.info(`Paginated into ${pages.length} pages (mode=${mode})`)

  const browser = await getBrowser()
  const page = await browser.newPage()

  try {
    const result: RenderResult = {
      cards: [],
      allImages: [],
      theme,
      mode,
      cardCount: 0,
    }

    // 渲染封面（如果有标题）
    if (title) {
      const coverPath = path.join(outputDir, `${prefix}cover.png`)
      const coverHtml = buildCoverHtml(title, subtitle, emoji, theme, width, height)
      await renderHtmlToPng(page, coverHtml, coverPath, width, height, 'auto-fit')
      result.cover = coverPath
      result.allImages.push(coverPath)
    }

    // 渲染正文卡片
    if (mode === 'auto-split' && pages.length === 1) {
      // auto-split 模式：自动根据高度拆分
      const contentHtml = markdownToHtml(pages[0])
      const cardPaths = await autoSplitRender(
        page, contentHtml, theme, width, height, outputDir, prefix,
      )
      result.cards = cardPaths
      result.allImages.push(...cardPaths)
    } else {
      // separator / auto-fit / dynamic 模式：每页一张
      for (let i = 0; i < pages.length; i++) {
        const cardPath = path.join(outputDir, `${prefix}card_${i + 1}.png`)
        const contentHtml = markdownToHtml(pages[i])
        const cardHtml = buildCardHtml(contentHtml, theme, width, height, mode)
        await renderHtmlToPng(page, cardHtml, cardPath, width, height, mode)
        result.cards.push(cardPath)
        result.allImages.push(cardPath)
      }
    }

    result.cardCount = result.allImages.length
    log.info(`Rendered ${result.cardCount} images (${result.cover ? '1 cover + ' : ''}${result.cards.length} cards)`)

    return result
  } finally {
    await page.close()
    await releaseBrowser()
  }
}

/**
 * 获取可用主题列表
 */
export function getAvailableThemes(): { name: CardTheme; label: string; description: string }[] {
  return [
    { name: 'default', label: '简约灰', description: '经典简约灰色调，百搭通用' },
    { name: 'sketch', label: '手绘素描', description: '铅笔手绘风格，温暖亲切' },
    { name: 'playful-geometric', label: '几何活泼', description: '几何图形 + 明亮色彩，年轻活力' },
    { name: 'neo-brutalism', label: '新野兽派', description: '粗边框 + 高饱和，个性鲜明' },
    { name: 'botanical', label: '植物自然', description: '绿色植物系，清新自然' },
    { name: 'professional', label: '专业商务', description: '深蓝灰色调，专业稳重' },
    { name: 'retro', label: '复古怀旧', description: '暖色复古风，文艺气息' },
    { name: 'terminal', label: '终端极客', description: '黑底绿字，程序员风格' },
  ]
}

/**
 * 健康检查
 */
export async function healthCheck(): Promise<{ available: boolean; detail: string }> {
  try {
    const browser = await getBrowser()
    const page = await browser.newPage()
    await page.setContent('<html><body>OK</body></html>')
    await page.close()
    await releaseBrowser()
    return { available: true, detail: 'Playwright Chromium is ready' }
  } catch (e: any) {
    return { available: false, detail: e.message || String(e) }
  }
}
