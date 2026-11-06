/**
 * 多端（iOS / Android / 小程序）的**确定性**产物：主题/Token 文件 + 设计规格清单。
 *
 * 为什么不直接生成原生页面代码：HTML→原生（SwiftUI/Compose/WXML）不是确定性转换，
 * 布局模型（flex/grid vs 约束/修饰符）、伪元素、自定义滚动等无法 1:1 映射。插件只做
 * 「能验证的部分」——把当前设计系统精确翻译成各平台的主题常量，并给出一份规格清单，
 * 页面代码由 AI 按规格编写。产物里明确标注保真度，避免被当成像素级还原。
 *
 * 所有输出确定性（键序固定、无时间戳）。
 */
import type { CodeFile } from '../codegen.js'
import { TAILWIND_MAP } from './tailwind-map.js'

export type PlatformTarget = 'ios' | 'android' | 'miniprogram'
export type PlatformStack =
  | 'swiftui'
  | 'uikit'
  | 'compose'
  | 'xml'
  | 'weapp'
  | 'uniapp'
  | 'taro'

export interface PlatformInput {
  /** 语义色名 → hex 或 rgba（如 { 'bg.canvas': '#fafafa' }）。 */
  semantics: Record<string, string>
  /** 语义色名 → --ts-* 变量名（如 { 'bg.canvas': '--ts-color-bg-canvas' }）。 */
  semanticVars: Record<string, string>
  fontFamilies: Record<string, string>
  fontSizes: Record<string, number>
  weights: Record<string, number>
  lineHeights: Record<string, number>
  spacing: number[]
  radius: Record<string, number>
  shadows: Record<string, string>
  /** 组件 id → base 类（用于规格里的组件映射建议）。 */
  components: Array<{ id: string; base: string }>
}

/** 默认组件清单（取自 tailwind 映射表，形状与 components.json 一致）。 */
export function defaultComponents(): Array<{ id: string; base: string }> {
  return TAILWIND_MAP.map((m) => ({ id: m.id, base: m.base }))
}

export const STACKS: Record<PlatformTarget, PlatformStack[]> = {
  ios: ['swiftui', 'uikit'],
  android: ['compose', 'xml'],
  miniprogram: ['weapp', 'uniapp', 'taro'],
}

const PLATFORM_LABEL: Record<PlatformTarget, string> = {
  ios: 'iOS',
  android: 'Android',
  miniprogram: '小程序',
}

const STACK_LABEL: Record<PlatformStack, string> = {
  swiftui: 'SwiftUI',
  uikit: 'UIKit',
  compose: 'Jetpack Compose',
  xml: 'XML 布局',
  weapp: '微信小程序原生',
  uniapp: 'uni-app',
  taro: 'Taro',
}

/** 组件 → 各平台惯用构件的映射建议（用于 design-spec.md）。 */
const COMPONENT_HINTS: Record<string, Partial<Record<PlatformStack, string>>> = {
  'ts-btn': { swiftui: 'Button + .buttonStyle(.borderedProminent)', uikit: 'UIButton(configuration: .filled())', compose: 'Button', xml: 'MaterialButton', weapp: '<button type="primary">', uniapp: '<button type="primary">', taro: 'Button' },
  'ts-input': { swiftui: 'TextField', uikit: 'UITextField', compose: 'OutlinedTextField', xml: 'TextInputLayout+TextInputEditText', weapp: '<input>', uniapp: '<input>', taro: 'Input' },
  'ts-card': { swiftui: 'VStack + .background(.regularMaterial)', uikit: 'UIView + layer.cornerRadius', compose: 'Card', xml: 'MaterialCardView', weapp: '<view class="card">', uniapp: '<view class="card">', taro: 'View + Card' },
  'ts-nav': { swiftui: 'NavigationStack / TabView', uikit: 'UITabBarController / UINavigationController', compose: 'NavigationBar', xml: 'BottomNavigationView', weapp: 'tabBar（app.json）', uniapp: 'tabBar（pages.json）', taro: 'TabBar' },
  'ts-tabs': { swiftui: 'Picker(.segmented)', uikit: 'UISegmentedControl', compose: 'TabRow', xml: 'TabLayout', weapp: '自定义 view 切换', uniapp: '<u-tabs>', taro: 'Tabs' },
  'ts-dialog': { swiftui: '.alert / .sheet', uikit: 'UIAlertController / present', compose: 'AlertDialog', xml: 'MaterialAlertDialogBuilder', weapp: 'wx.showModal', uniapp: 'uni.showModal', taro: 'Modal' },
  'ts-toast': { swiftui: 'overlay + animation', uikit: '自定义 UIView', compose: 'Snackbar', xml: 'Snackbar', weapp: 'wx.showToast', uniapp: 'uni.showToast', taro: 'Toast' },
  'ts-avatar': { swiftui: 'AsyncImage + .clipShape(Circle())', uikit: 'UIImageView + cornerRadius', compose: 'AsyncImage + CircleShape', xml: 'ShapeableImageView', weapp: '<image class="avatar">', uniapp: '<image class="avatar">', taro: 'Image' },
  'ts-progress': { swiftui: 'ProgressView(value:)', uikit: 'UIProgressView', compose: 'LinearProgressIndicator', xml: 'LinearProgressIndicator', weapp: '<progress>', uniapp: '<progress>', taro: 'Progress' },
  'ts-table': { swiftui: 'List / Table', uikit: 'UITableView', compose: 'LazyColumn', xml: 'RecyclerView', weapp: '<view> 列表 + scroll-view', uniapp: '<scroll-view>', taro: 'ScrollView' },
}

const FIDELITY_NOTE = `## 保真度与人工校对点

- 本产物只保证**主题/Token 与规格清单**确定性正确；**页面结构由 AI 按规格编写**，不是自动转换。
- HTML→原生**必然有损**：flex/grid 布局、伪元素（::before/::after）、自定义滚动、CSS 动画/过渡、
  绝对定位层级等无法 1:1 映射，需要按平台惯例重写。
- 请勿把本产物当作「像素级还原」；上线前请在真机/模拟器上逐屏校对。`

/** 把语义色值规范成各平台可用的形式。 */
function colorValue(raw: string): { hex: string; opacity: number } {
  const trimmed = raw.trim()
  const rgba = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(trimmed)
  if (rgba) {
    const hex = '#' + [rgba[1], rgba[2], rgba[3]].map((n) => Math.round(Number(n)).toString(16).padStart(2, '0')).join('')
    return { hex, opacity: rgba[4] !== undefined ? Number(rgba[4]) : 1 }
  }
  return { hex: trimmed.startsWith('#') ? trimmed : '#000000', opacity: 1 }
}

/** 语义色名 `bg.canvas` → 各平台常量名。 */
export function constantName(semanticKey: string, style: 'camel' | 'snake' | 'kebab' | 'upperSnake' = 'camel'): string {
  const parts = semanticKey.split('.')
  const camel = parts[0]! + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')
  switch (style) {
    case 'snake':
      return parts.join('_')
    case 'kebab':
      return parts.join('-')
    case 'upperSnake':
      return parts.join('_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()
    default:
      return camel
  }
}

/** 生成平台无关的设计规格清单 design-spec.md。 */
export function designSpec(target: PlatformTarget, stack: PlatformStack, input: PlatformInput): string {
  const lines: string[] = []
  lines.push(`# 设计规格清单（${PLATFORM_LABEL[target]} · ${STACK_LABEL[stack]}）`)
  lines.push('')
  lines.push('> 由天枢画布从当前设计系统生成。请按本规格编写页面代码。')
  lines.push('')
  lines.push('## 语义色')
  lines.push('')
  lines.push('| 语义 | 变量 | 值 | 建议常量名 |')
  lines.push('| --- | --- | --- | --- |')
  for (const [key, value] of Object.entries(input.semantics)) {
    lines.push(`| ${key} | \`${input.semanticVars[key] ?? ''}\` | \`${value}\` | \`${constantName(key, 'camel')}\` |`)
  }
  lines.push('')
  lines.push('## 字阶')
  lines.push('')
  lines.push('| 档位 | px | pt/sp |')
  lines.push('| --- | --- | --- |')
  for (const [name, px] of Object.entries(input.fontSizes)) {
    lines.push(`| ${name} | ${px}px | ${px}pt |`)
  }
  lines.push('')
  lines.push(`字重：${Object.entries(input.weights).map(([k, v]) => `${k}=${v}`).join('、')}`)
  lines.push(`行高：${Object.entries(input.lineHeights).map(([k, v]) => `${k}=${v}`).join('、')}`)
  lines.push(`字体族：sans=${input.fontFamilies.sans ?? ''}`)
  lines.push(`等宽：${input.fontFamilies.mono ?? ''}`)
  lines.push('')
  lines.push('## 间距 / 圆角 / 阴影')
  lines.push('')
  lines.push(`间距档位：${input.spacing.join(', ')}（px）`)
  lines.push(`圆角：${Object.entries(input.radius).map(([k, v]) => `${k}=${v}`).join('、')}`)
  lines.push(`阴影：${Object.entries(input.shadows).map(([k, v]) => `${k}=\`${v}\``).join('、')}`)
  lines.push('')
  lines.push('> 说明：1px（CSS）≈ 1pt（iOS）≈ 1dp（Android）在 @1x 下等价；小程序用 rpx 时按 750 设计宽换算。')
  lines.push('')
  lines.push('## 组件映射建议')
  lines.push('')
  lines.push('| ts-* 类 | 本平台惯用构件 |')
  lines.push('| --- | --- |')
  for (const comp of input.components) {
    const hint = COMPONENT_HINTS[comp.base]?.[stack]
    if (hint) lines.push(`| \`${comp.base}\` | ${hint} |`)
  }
  lines.push('')
  lines.push(FIDELITY_NOTE)
  return lines.join('\n')
}

/** iOS · SwiftUI：DesignTokens.swift + Color/Font 扩展。 */
function swiftUiFiles(input: PlatformInput): CodeFile[] {
  const colorLines = Object.entries(input.semantics)
    .map(([key, value]) => {
      const { hex, opacity } = colorValue(value)
      const name = constantName(key, 'camel')
      return opacity < 1
        ? `        public static let ${name} = Color(hex: "${hex}").opacity(${opacity})`
        : `        public static let ${name} = Color(hex: "${hex}")`
    })
    .join('\n')
  const fontLines = Object.entries(input.fontSizes)
    .map(([name, px]) => `        public static let ${name} = CGFloat(${px})`)
    .join('\n')
  const spacingLines = input.spacing.map((v) => `        public static let s${v} = CGFloat(${v})`).join('\n')

  const swift = `import SwiftUI

/// 由天枢画布生成的设计 Token。请勿手改。
public enum DesignTokens {
    public enum Color_ {
${colorLines}
    }

    public enum FontSize {
${fontLines}
    }

    public enum Spacing {
${spacingLines}
    }

    public enum Radius {
${Object.entries(input.radius)
  .filter(([, v]) => v < 9999)
  .map(([k, v]) => `        public static let ${k} = CGFloat(${v})`)
  .join('\n')}
    }
}

public extension Color {
    /// 解析 #rrggbb / #rgb。
    init(hex: String) {
        let cleaned = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        let expanded = cleaned.count == 3 ? cleaned.map { "\\($0)\\($0)" }.joined() : cleaned
        let value = UInt64(expanded, radix: 16) ?? 0
        self.init(
            .sRGB,
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255,
            opacity: 1
        )
    }
}
`
  return [{ name: 'DesignTokens.swift', content: swift, language: 'swift' }]
}

/** iOS · UIKit：DesignTokens.h/.m。 */
function uiKitFiles(input: PlatformInput): CodeFile[] {
  const header = `#import <UIKit/UIKit.h>

/// 由天枢画布生成的设计 Token。请勿手改。
@interface TSDesignTokens : NSObject

${Object.keys(input.semantics).map((k) => `+ (UIColor *)${constantName(k, 'camel')};`).join('\n')}

+ (UIFont *)fontOfSize:(CGFloat)size weight:(UIFontWeight)weight;
+ (CGFloat)spacing:(NSInteger)step;
+ (CGFloat)radius:(NSString *)name;

@end
`
  const impl = `#import "TSDesignTokens.h"

@implementation TSDesignTokens

+ (UIColor *)colorWithHex:(NSString *)hex {
    NSString *cleaned = [hex hasPrefix:@"#"] ? [hex substringFromIndex:1] : hex;
    unsigned int value = 0;
    [[NSScanner scannerWithString:cleaned] scanHexInt:&value];
    return [UIColor colorWithRed:((value >> 16) & 0xFF) / 255.0
                           green:((value >> 8) & 0xFF) / 255.0
                            blue:(value & 0xFF) / 255.0
                           alpha:1.0];
}

${Object.entries(input.semantics)
  .map(([key, value]) => `+ (UIColor *)${constantName(key, 'camel')} { return [self colorWithHex:@"${colorValue(value).hex}"]; }`)
  .join('\n')}

+ (UIFont *)fontOfSize:(CGFloat)size weight:(UIFontWeight)weight {
    return [UIFont systemFontOfSize:size weight:weight];
}

+ (CGFloat)spacing:(NSInteger)step {
    static const CGFloat table[] = {${input.spacing.join(', ')}};
    NSInteger count = ${input.spacing.length};
    if (step < 0 || step >= count) return 0;
    return table[step];
}

+ (CGFloat)radius:(NSString *)name {
    NSDictionary<NSString *, NSNumber *> *map = @{${Object.entries(input.radius)
      .filter(([, v]) => v < 9999)
      .map(([k, v]) => `@"${k}": @${v}`)
      .join(', ')}};
    return map[name].doubleValue;
}

@end
`
  return [
    { name: 'TSDesignTokens.h', content: header, language: 'objc' },
    { name: 'TSDesignTokens.m', content: impl, language: 'objc' },
  ]
}

/** Android · Compose：Theme.kt + Color.kt + Type.kt。 */
function composeFiles(input: PlatformInput): CodeFile[] {
  const colorKt = `package com.example.theme

import androidx.compose.ui.graphics.Color

// 由天枢画布生成。请勿手改。
${Object.entries(input.semantics)
  .map(([key, value]) => {
    const { hex, opacity } = colorValue(value)
    const argb = `0x${opacity < 1 ? Math.round(opacity * 255).toString(16).padStart(2, '0') : 'FF'}${hex.replace('#', '').toUpperCase()}`
    return `val ${constantName(key, 'camel')} = Color(${argb})`
  })
  .join('\n')}
`
  const typeKt = `package com.example.theme

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// 由天枢画布生成。请勿手改。
object TsTypography {
${Object.entries(input.fontSizes)
  .map(([name, px]) => `    val ${name} = TextStyle(fontSize = ${px}.sp, fontWeight = FontWeight.Normal)`)
  .join('\n')}
}
`
  const themeKt = `package com.example.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp

// 由天枢画布生成。请勿手改。
private val TsColorScheme = lightColorScheme(
    background = ${constantName('bg.canvas', 'camel')},
    surface = ${constantName('bg.surface', 'camel')},
    onBackground = ${constantName('text.primary', 'camel')},
    onSurface = ${constantName('text.primary', 'camel')},
    primary = ${constantName('action.primary', 'camel')},
    onPrimary = ${constantName('action.primaryText', 'camel')},
    outline = ${constantName('border.default', 'camel')},
)

val TsShapes = MaterialTheme.shapes.copy(
    small = RoundedCornerShape(${input.radius.sm ?? 6}.dp),
    medium = RoundedCornerShape(${input.radius.md ?? 10}.dp),
    large = RoundedCornerShape(${input.radius.lg ?? 14}.dp),
)

@Composable
fun TsTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = TsColorScheme, shapes = TsShapes, content = content)
}
`
  return [
    { name: 'Color.kt', content: colorKt, language: 'kotlin' },
    { name: 'Type.kt', content: typeKt, language: 'kotlin' },
    { name: 'Theme.kt', content: themeKt, language: 'kotlin' },
  ]
}

/** Android · XML：colors.xml + dimens.xml + themes.xml。 */
function xmlFiles(input: PlatformInput): CodeFile[] {
  const colors = `<?xml version="1.0" encoding="utf-8"?>
<!-- 由天枢画布生成。请勿手改。 -->
<resources>
${Object.entries(input.semantics)
  .map(([key, value]) => `    <color name="${constantName(key, 'snake')}">${colorValue(value).hex}</color>`)
  .join('\n')}
</resources>
`
  const dimens = `<?xml version="1.0" encoding="utf-8"?>
<!-- 由天枢画布生成。请勿手改。 -->
<resources>
${input.spacing.map((v, i) => `    <dimen name="ts_space_${i}">${v}dp</dimen>`).join('\n')}
${Object.entries(input.radius)
  .filter(([, v]) => v < 9999)
  .map(([k, v]) => `    <dimen name="ts_radius_${k}">${v}dp</dimen>`)
  .join('\n')}
</resources>
`
  const themes = `<?xml version="1.0" encoding="utf-8"?>
<!-- 由天枢画布生成。请勿手改。 -->
<resources>
    <style name="Theme.Ts" parent="Theme.Material3.DayNight.NoActionBar">
        <item name="colorPrimary">@color/${constantName('action.primary', 'snake')}</item>
        <item name="colorOnPrimary">@color/${constantName('action.primaryText', 'snake')}</item>
        <item name="android:colorBackground">@color/${constantName('bg.canvas', 'snake')}</item>
        <item name="colorSurface">@color/${constantName('bg.surface', 'snake')}</item>
        <item name="colorOnSurface">@color/${constantName('text.primary', 'snake')}</item>
        <item name="colorOutline">@color/${constantName('border.default', 'snake')}</item>
    </style>
</resources>
`
  return [
    { name: 'res/values/colors.xml', content: colors, language: 'xml' },
    { name: 'res/values/dimens.xml', content: dimens, language: 'xml' },
    { name: 'res/values/themes.xml', content: themes, language: 'xml' },
  ]
}

/** 小程序 · 微信原生：app.wxss + theme.js。 */
function weappFiles(input: PlatformInput): CodeFile[] {
  const wxss = `/* 由天枢画布生成。请勿手改。 */
page {
${Object.entries(input.semantics)
  .map(([key, value]) => `  --${constantName(key, 'kebab')}: ${colorValue(value).hex};`)
  .join('\n')}
${Object.entries(input.fontSizes)
  .map(([name, px]) => `  --fs-${name}: ${px}px;`)
  .join('\n')}
${input.spacing.map((v, i) => `  --space-${i}: ${v}px;`).join('\n')}
${Object.entries(input.radius)
  .filter(([, v]) => v < 9999)
  .map(([k, v]) => `  --radius-${k}: ${v}px;`)
  .join('\n')}
}
`
  const themeJs = `// 由天枢画布生成。请勿手改。
module.exports = {
  colors: {
${Object.entries(input.semantics)
  .map(([key, value]) => `    '${key}': '${colorValue(value).hex}',`)
  .join('\n')}
  },
  fontSize: ${JSON.stringify(input.fontSizes, null, 2).replace(/\n/g, '\n  ')},
  spacing: ${JSON.stringify(input.spacing)},
}
`
  return [
    { name: 'app.wxss', content: wxss, language: 'css' },
    { name: 'theme.js', content: themeJs, language: 'javascript' },
  ]
}

/** 小程序 · uni-app：uni.scss + theme.js。 */
function uniappFiles(input: PlatformInput): CodeFile[] {
  const scss = `/* 由天枢画布生成。请勿手改。 */
${Object.entries(input.semantics)
  .map(([key, value]) => `$ts-${constantName(key, 'kebab')}: ${colorValue(value).hex};`)
  .join('\n')}
${Object.entries(input.fontSizes)
  .map(([name, px]) => `$ts-fs-${name}: ${px}px;`)
  .join('\n')}
${input.spacing.map((v, i) => `$ts-space-${i}: ${v}px;`).join('\n')}
${Object.entries(input.radius)
  .filter(([, v]) => v < 9999)
  .map(([k, v]) => `$ts-radius-${k}: ${v}px;`)
  .join('\n')}
`
  return [{ name: 'uni.scss', content: scss, language: 'scss' }]
}

/** 小程序 · Taro：app.scss + tailwind.config.js（复用 Tailwind 主题）。 */
function taroFiles(input: PlatformInput): CodeFile[] {
  const scss = `/* 由天枢画布生成。请勿手改。 */
:root {
${Object.entries(input.semantics)
  .map(([key, value]) => `  --ts-${constantName(key, 'kebab')}: ${colorValue(value).hex};`)
  .join('\n')}
${Object.entries(input.fontSizes)
  .map(([name, px]) => `  --ts-fs-${name}: ${px}px;`)
  .join('\n')}
${input.spacing.map((v, i) => `  --ts-space-${i}: ${v}px;`).join('\n')}
${Object.entries(input.radius)
  .filter(([, v]) => v < 9999)
  .map(([k, v]) => `  --ts-radius-${k}: ${v}px;`)
  .join('\n')}
}
`
  return [{ name: 'app.scss', content: scss, language: 'scss' }]
}

/** 把 tokens.css 解析成 变量名 → 值（各平台产物与 Tailwind 配置共用）。 */
export function parseCssVars(css: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const match of css.matchAll(/(--ts-[A-Za-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[match[1]!] = match[2]!.trim()
  }
  return out
}

/** 语义色名 `color.bg.canvas` → `bg.canvas`。 */
export function semanticKeyFromPath(path: string): string {
  const parts = path.split('.')
  return parts[0] === 'color' ? parts.slice(1).join('.') : path
}

/** 从设计系统 manifest 构造各平台产物所需的输入（确定、无需再触磁盘）。 */
export function buildPlatformInput(style: {
  manifest: {
    resolvedSemantic: Record<string, { value: string }>
    componentClasses: string[]
  }
  tokensCss: string
}, components: Array<{ id: string; base: string }>): PlatformInput {
  const vars = parseCssVars(style.tokensCss)
  const semantics: Record<string, string> = {}
  const semanticVars: Record<string, string> = {}
  for (const [path, entry] of Object.entries(style.manifest.resolvedSemantic)) {
    const key = semanticKeyFromPath(path)
    semantics[key] = entry.value
    semanticVars[key] = `--ts-${key.replace(/\./g, '-').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`
  }

  const fontSizes: Record<string, number> = {}
  for (const [name, value] of Object.entries(vars)) {
    const fs = /^--ts-fs-(.+)$/.exec(name)
    if (fs) fontSizes[fs[1]!] = parseFloat(value)
  }
  const spacing = Object.entries(vars)
    .filter(([n]) => /^--ts-space-\d+$/.test(n))
    .sort((a, b) => Number(a[0].replace('--ts-space-', '')) - Number(b[0].replace('--ts-space-', '')))
    .map(([, v]) => parseFloat(v))
  const radius: Record<string, number> = {}
  for (const [name, value] of Object.entries(vars)) {
    const r = /^--ts-radius-(.+)$/.exec(name)
    if (r) radius[r[1]!] = parseFloat(value)
  }
  const shadows: Record<string, string> = {}
  for (const [name, value] of Object.entries(vars)) {
    const s = /^--ts-shadow-(.+)$/.exec(name)
    if (s) shadows[s[1]!] = value
  }
  const fontFamilies: Record<string, string> = {}
  for (const [name, value] of Object.entries(vars)) {
    const f = /^--ts-font-(.+)$/.exec(name)
    if (f && !/^--ts-font-size/.test(name)) fontFamilies[f[1]!] = value
  }

  return {
    semantics,
    semanticVars,
    fontFamilies,
    fontSizes,
    weights: { regular: 400, medium: 500, semibold: 600, bold: 700 },
    lineHeights: { tight: 1.15, snug: 1.3, normal: 1.45, relaxed: 1.65 },
    spacing: spacing.length ? spacing : [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64],
    radius,
    shadows,
    components,
  }
}

const GENERATORS: Record<PlatformStack, (input: PlatformInput) => CodeFile[]> = {
  swiftui: swiftUiFiles,
  uikit: uiKitFiles,
  compose: composeFiles,
  xml: xmlFiles,
  weapp: weappFiles,
  uniapp: uniappFiles,
  taro: taroFiles,
}

/** 生成多端产物：design-spec.md + 该技术栈的主题/Token 文件。 */
export function generatePlatformFiles(target: PlatformTarget, stack: PlatformStack, input: PlatformInput): CodeFile[] {
  const allowed = STACKS[target]
  if (!allowed.includes(stack)) {
    throw new Error(`技术栈 ${stack} 不属于 ${PLATFORM_LABEL[target]}（可选：${allowed.join('/')}）`)
  }
  return [
    { name: 'design-spec.md', content: designSpec(target, stack, input), language: 'markdown' },
    ...GENERATORS[stack](input),
  ]
}
