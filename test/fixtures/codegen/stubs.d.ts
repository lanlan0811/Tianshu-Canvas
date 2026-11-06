/**
 * 适配器产物编译验收用的最小类型桩。
 *
 * 只描述签名，不描述运行时：任何违反 props 契约的产物都会让 tsc 失败，
 * 从而证明「编译通过」不是靠 any 假绿。桩由 verify-codegen.mjs 复制进临时目录。
 *
 * 注意：JSX.Element 必须是带成员的对象类型——空接口会让 TS 报
 * “return type 'unknown' is not a valid JSX element”，组件统一返回 JSX.Element。
 */

declare global {
  namespace JSX {
    interface Element {
      type: unknown
      props: unknown
      key: string | null
    }
    interface IntrinsicElements {
      [name: string]: Record<string, unknown>
    }
  }
}

declare module 'react' {
  export type ReactNode = JSX.Element | string | number | boolean | null | undefined
  export type CSSProperties = Record<string, string | number>
  export interface ReactElement {
    type: unknown
    props: unknown
    key: string | null
  }
  export const Fragment: unknown
  export function createElement(type: unknown, props?: unknown, ...children: unknown[]): JSX.Element
  export type HTMLAttributes<T> = { className?: string; style?: CSSProperties; children?: ReactNode }
  export type ButtonHTMLAttributes<T> = HTMLAttributes<T> & { disabled?: boolean; type?: 'button' | 'submit' | 'reset'; onClick?: () => void }
  export type InputHTMLAttributes<T> = HTMLAttributes<T> & { placeholder?: string; value?: string; type?: string; name?: string; id?: string; disabled?: boolean }
  export type TableHTMLAttributes<T> = HTMLAttributes<T>
  const React: { createElement: typeof createElement; Fragment: unknown }
  export default React
}

declare module 'react/jsx-runtime' {
  export const jsx: (type: unknown, props: unknown, key?: unknown) => JSX.Element
  export const jsxs: (type: unknown, props: unknown, key?: unknown) => JSX.Element
  export const Fragment: unknown
}

declare module '@/components/ui/button' {
  import type { ReactNode, CSSProperties } from 'react'
  export interface ButtonProps {
    variant?: 'default' | 'secondary' | 'ghost' | 'destructive' | 'outline' | 'link'
    size?: 'default' | 'sm' | 'lg' | 'icon'
    className?: string
    style?: CSSProperties
    children?: ReactNode
    disabled?: boolean
    type?: 'button' | 'submit' | 'reset'
    onClick?: () => void
  }
  export const Button: (props: ButtonProps) => JSX.Element
  export const buttonVariants: (props: ButtonProps) => string
}

declare module '@/components/ui/input' {
  export interface InputProps {
    className?: string
    placeholder?: string
    value?: string
    type?: string
    name?: string
    id?: string
    disabled?: boolean
  }
  export const Input: (props: InputProps) => JSX.Element
}

declare module '@/components/ui/table' {
  export const Table: (props: { className?: string; children?: unknown }) => JSX.Element
  export const TableHeader: (props: { className?: string; children?: unknown }) => JSX.Element
  export const TableBody: (props: { className?: string; children?: unknown }) => JSX.Element
  export const TableRow: (props: { className?: string; children?: unknown }) => JSX.Element
  export const TableHead: (props: { className?: string; children?: unknown }) => JSX.Element
  export const TableCell: (props: { className?: string; children?: unknown }) => JSX.Element
}

declare module '@/components/ui/badge' {
  export const Badge: (props: { variant?: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string; children?: unknown }) => JSX.Element
}

declare module '@/components/ui/card' {
  export const Card: (props: { className?: string; children?: unknown }) => JSX.Element
}

declare module '@/components/ui/tabs' {
  export const Tabs: (props: { defaultValue?: string; children?: unknown }) => JSX.Element
  export const TabsTrigger: (props: { value: string; children?: unknown }) => JSX.Element
}

declare module '@/components/ui/dialog' {
  export const Dialog: (props: { children?: unknown }) => JSX.Element
  export const DialogTrigger: (props: { children?: unknown }) => JSX.Element
  export const DialogContent: (props: { children?: unknown }) => JSX.Element
}

declare module '@/lib/utils' {
  export function cn(...inputs: Array<string | undefined | false | null>): string
}

declare module 'antd' {
  import type { ReactNode, CSSProperties } from 'react'
  export interface ThemeConfig {
    token?: {
      colorPrimary?: string
      colorSuccess?: string
      colorWarning?: string
      colorError?: string
      colorInfo?: string
      colorBgBase?: string
      colorTextBase?: string
      colorBorder?: string
      borderRadius?: number
      fontFamily?: string
    }
  }
  export const ConfigProvider: (props: { theme?: ThemeConfig; children?: ReactNode }) => JSX.Element
  export const Button: (props: {
    type?: 'primary' | 'default' | 'dashed' | 'text' | 'link'
    danger?: boolean
    disabled?: boolean
    style?: CSSProperties
    children?: ReactNode
    onClick?: () => void
  }) => JSX.Element
  export const Input: (props: { placeholder?: string; value?: string; type?: string; style?: CSSProperties; disabled?: boolean }) => JSX.Element
  export const Select: (props: { options?: Array<{ value: string; label: string }>; style?: CSSProperties; placeholder?: string }) => JSX.Element
  export interface TableColumn<T> {
    title: string
    dataIndex: keyof T & string
    key: string
  }
  export const Table: <T extends Record<string, unknown> = Record<string, unknown>>(props: {
    columns: Array<TableColumn<T>>
    dataSource: T[]
    pagination?: false | Record<string, unknown>
    style?: CSSProperties
  }) => JSX.Element
  export const Card: (props: { style?: CSSProperties; children?: ReactNode }) => JSX.Element
  export const Tag: (props: { children?: ReactNode; style?: CSSProperties }) => JSX.Element
  export const Tabs: (props: { items: Array<{ key: string; label: string; children?: ReactNode }> }) => JSX.Element
  export const Modal: (props: { open?: boolean; title?: string; children?: ReactNode }) => JSX.Element
  export const Flex: (props: { style?: CSSProperties; children?: ReactNode }) => JSX.Element
}
