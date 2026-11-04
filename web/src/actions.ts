/**
 * 画布动作上下文：让 PageNode 内的节点工具栏能触发重命名/复制/删除，
 * 而无需把函数塞进 node data。
 */
import { createContext, useContext } from 'react'

export interface CanvasActions {
  rename: (id: string, title: string) => void
  duplicate: (id: string) => void
  remove: (id: string) => void
}

const Ctx = createContext<CanvasActions | null>(null)

export const CanvasActionsProvider = Ctx.Provider

export function useCanvasActions(): CanvasActions | null {
  return useContext(Ctx)
}
