/**
 * 最小 PNG 编解码 + 像素 diff（零依赖，只用 node:zlib）。
 *
 * 支持范围正好覆盖 Chrome 截图：8 位、非隔行、RGB(2)/RGBA(6)/灰度(0)/灰度+alpha(4)。
 * 不支持调色板与 16 位——遇到时抛可读错误，由调用方提示换 dpr 或格式。
 */

import { deflateSync, inflateSync } from 'node:zlib'

export interface PngImage {
  width: number
  height: number
  /** 每像素通道数（1/2/3/4）。 */
  channels: number
  /** 原始像素，行优先、无滤波。 */
  data: Buffer
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** 解码 PNG 为未滤波像素。 */
export function decodePng(input: Buffer): PngImage {
  if (!input.subarray(0, 8).equals(SIGNATURE)) throw new Error('不是 PNG 文件')
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat: Buffer[] = []

  while (offset + 8 <= input.length) {
    const length = input.readUInt32BE(offset)
    const type = input.toString('ascii', offset + 4, offset + 8)
    const body = input.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      bitDepth = body[8]!
      colorType = body[9]!
      interlace = body[12]!
    } else if (type === 'IDAT') {
      idat.push(body)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }

  if (bitDepth !== 8) throw new Error(`暂不支持 ${bitDepth} 位 PNG（截图应为 8 位）`)
  if (interlace !== 0) throw new Error('暂不支持隔行 PNG')
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : colorType === 4 ? 2 : 0
  if (channels === 0) throw new Error(`暂不支持的 PNG 颜色类型：${colorType}（调色板图像请改用 RGB 截图）`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(stride * height)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]!
    const row = y * stride
    for (let x = 0; x < stride; x++) {
      const val = raw[pos + x]!
      const a = x >= channels ? out[row + x - channels]! : 0
      const b = y > 0 ? out[row - stride + x]! : 0
      const c = y > 0 && x >= channels ? out[row - stride + x - channels]! : 0
      let value = val
      if (filter === 1) value = (val + a) & 0xff
      else if (filter === 2) value = (val + b) & 0xff
      else if (filter === 3) value = (val + ((a + b) >> 1)) & 0xff
      else if (filter === 4) value = (val + paeth(a, b, c)) & 0xff
      out[row + x] = value
    }
    pos += stride
  }
  return { width, height, channels, data: out }
}

function chunk(type: string, body: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(body.length)
  const name = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([name, body])))
  return Buffer.concat([len, name, body, crc])
}

/** 生成纯色 PNG（测试与占位用），RGB/RGBA 非隔行。 */
export function encodePng(width: number, height: number, rgba: [number, number, number, number] = [255, 255, 255, 255]): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const stride = width * 4 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0
    for (let x = 0; x < width; x++) {
      const at = y * stride + 1 + x * 4
      raw[at] = rgba[0]
      raw[at + 1] = rgba[1]
      raw[at + 2] = rgba[2]
      raw[at + 3] = rgba[3]
    }
  }
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** 把任意 PNG 图像重新编码成 PNG（RGBA 非隔行），用于拼图与裁剪。 */
export function encodeImage(image: PngImage): Buffer {
  const { width, height, channels, data } = image
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = width * 4 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * channels
      const dst = y * stride + 1 + x * 4
      if (channels === 1 || channels === 2) {
        raw[dst] = data[src]!
        raw[dst + 1] = data[src]!
        raw[dst + 2] = data[src]!
        raw[dst + 3] = channels === 2 ? data[src + 1]! : 255
      } else {
        raw[dst] = data[src]!
        raw[dst + 1] = data[src + 1]!
        raw[dst + 2] = data[src + 2]!
        raw[dst + 3] = channels === 4 ? data[src + 3]! : 255
      }
    }
  }
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/**
 * 最近邻缩放到指定尺寸（只用于 filmstrip 缩略图，不追求画质）。
 * 用于把多帧拼成一张总览图，让代理一次看完整段动效。
 */
export function scaleImage(image: PngImage, width: number, height: number): PngImage {
  const out = Buffer.alloc(width * height * 4)
  const sx = image.width / width
  const sy = image.height / height
  for (let y = 0; y < height; y++) {
    const srcY = Math.min(image.height - 1, Math.floor(y * sy))
    for (let x = 0; x < width; x++) {
      const srcX = Math.min(image.width - 1, Math.floor(x * sx))
      const src = (srcY * image.width + srcX) * image.channels
      const dst = (y * width + x) * 4
      if (image.channels === 1 || image.channels === 2) {
        out[dst] = image.data[src]!
        out[dst + 1] = image.data[src]!
        out[dst + 2] = image.data[src]!
        out[dst + 3] = image.channels === 2 ? image.data[src + 1]! : 255
      } else {
        out[dst] = image.data[src]!
        out[dst + 1] = image.data[src + 1]!
        out[dst + 2] = image.data[src + 2]!
        out[dst + 3] = image.channels === 4 ? image.data[src + 3]! : 255
      }
    }
  }
  return { width, height, channels: 4, data: out }
}

/** 把若干张同尺寸图按列数拼成网格（filmstrip 用），间隙填背景色。 */
export function tileImages(images: PngImage[], columns: number, gap = 4, background: [number, number, number] = [24, 24, 27]): PngImage {
  if (images.length === 0) return { width: 1, height: 1, channels: 4, data: Buffer.from([0, 0, 0, 255]) }
  const cellW = images[0]!.width
  const cellH = images[0]!.height
  const cols = Math.max(1, Math.min(columns, images.length))
  const rows = Math.ceil(images.length / cols)
  const width = cols * cellW + (cols - 1) * gap
  const height = rows * cellH + (rows - 1) * gap
  const out = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = background[0]
    out[i * 4 + 1] = background[1]
    out[i * 4 + 2] = background[2]
    out[i * 4 + 3] = 255
  }
  images.forEach((image, index) => {
    const col = index % cols
    const row = Math.floor(index / cols)
    const offsetX = col * (cellW + gap)
    const offsetY = row * (cellH + gap)
    for (let y = 0; y < Math.min(image.height, cellH); y++) {
      for (let x = 0; x < Math.min(image.width, cellW); x++) {
        const src = (y * image.width + x) * image.channels
        const dst = ((offsetY + y) * width + offsetX + x) * 4
        const read = (channel: number): number =>
          image.channels === 1 || image.channels === 2
            ? image.data[src]!
            : image.data[src + Math.min(channel, image.channels - 1)]!
        out[dst] = read(0)
        out[dst + 1] = read(1)
        out[dst + 2] = read(2)
        out[dst + 3] = image.channels === 4 ? image.data[src + 3]! : 255
      }
    }
  })
  return { width, height, channels: 4, data: out }
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface DiffResult {
  width: number
  height: number
  changed: number
  total: number
  ratio: number
  /** 1 - ratio，保留 4 位小数。 */
  score: number
  /** 变化像素的包围盒；无变化为 null。 */
  bbox: Rect | null
}

function pixelAt(img: PngImage, x: number, y: number): [number, number, number] {
  const i = (y * img.width + x) * img.channels
  if (img.channels === 1) return [img.data[i]!, img.data[i]!, img.data[i]!]
  if (img.channels === 2) return [img.data[i]!, img.data[i]!, img.data[i]!]
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!]
}

/**
 * 像素 diff。`threshold` 为单通道允许的最大差值（默认 8，容忍抗锯齿）。
 * `ignore` 直接跳过（同一坐标系，便于排除批注图钉等动态元素）。
 */
export function diffPng(a: PngImage, b: PngImage, options: { threshold?: number; ignore?: Rect[] } = {}): DiffResult {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`尺寸不一致：${a.width}×${a.height} vs ${b.width}×${b.height}（基线需与当前 dpr/设备一致）`)
  }
  const threshold = options.threshold ?? 8
  const ignore = options.ignore ?? []
  let changed = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      if (ignore.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)) continue
      const pa = pixelAt(a, x, y)
      const pb = pixelAt(b, x, y)
      if (Math.abs(pa[0] - pb[0]) > threshold || Math.abs(pa[1] - pb[1]) > threshold || Math.abs(pa[2] - pb[2]) > threshold) {
        changed++
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  const total = a.width * a.height
  const ratio = total === 0 ? 0 : changed / total
  return {
    width: a.width,
    height: a.height,
    changed,
    total,
    ratio: Number(ratio.toFixed(6)),
    score: Number((1 - ratio).toFixed(4)),
    bbox: changed ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
  }
}
