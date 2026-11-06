/**
 * 宿主桥：插件内任何模块都能用到 activate(host) 拿到的宿主服务。
 *
 * 官方要求日志走 host.log（省略令牌、原始会话文本与敏感参数），并且 isWorker 为真时
 * 跳过用户数据写入，防止子会话重复写入。宿主之外（单测/本地脚本）没有 host，
 * 日志回落到 console，worker 判定回落为 false。
 */
export interface HostLog {
  debug(message: string): void
  warn(message: string): void
}

export interface HostServices {
  log: HostLog
  isWorker: boolean
}

let services: HostServices | null = null

export function setHostServices(next: HostServices | null): void {
  services = next
}

/** 子会话（worker）不写用户数据。宿主外视为主会话。 */
export function isWorkerSession(): boolean {
  return services?.isWorker === true
}

/** 非致命问题：有宿主日志通道时走 host.log.warn，否则打到 stderr。 */
export function warnUser(message: string): void {
  const line = `[tianshu-canvas] ${message}`
  if (services) services.log.warn(line)
  else console.error(line)
}
