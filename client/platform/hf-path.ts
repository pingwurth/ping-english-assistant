/**
 * HuggingFace 代理路径解析 —— 纯函数，无 Next/Node 依赖（可直测）。
 *
 * 路径段会直接成为磁盘缓存路径的原料（localFileOf 里 join(modelPath, cacheKey, file)），
 * 所以解析层就是路径穿越的第一道闸：空段、点段、编码斜杠/反斜杠一律拒绝
 * （Next 路由会先把 %2e%2e/%2f 解码成段，恶意输入以解码后形态到达这里）。
 */

export interface HfFileRef {
  /** 磁盘缓存目录名：{org}--{repo} */
  cacheKey: string
  /** 缓存目录内的相对路径 */
  file: string
  /** 完整 org/repo，用于和 settings.kokoro.modelId 精确比对 */
  modelId: string
  /** 上游 URL */
  url: string
}

/** 本代理仅服务 Kokoro 模型仓库的固定 revision */
export const KOKORO_REVISION = 'main'

/** 解析 {org}/{repo}/resolve/{revision}/{file}，不合法时返回 null */
export function parseHfPath(path: string[], hfBase: string, revision: string = KOKORO_REVISION): HfFileRef | null {
  // 路径段是磁盘路径的原料：空段、点段、编码斜杠/反斜杠一律拒绝（防路径穿越）
  if (
    path.some(
      (seg) => !seg || seg === '.' || seg === '..' || seg.includes('/') || seg.includes('\\'),
    )
  ) {
    return null
  }

  const resolveIdx = path.indexOf('resolve')
  if (resolveIdx < 2 || resolveIdx >= path.length - 1) return null

  const org = path[0]!
  const repo = path.slice(1, resolveIdx).join('/')
  const rev = path[resolveIdx + 1]!
  const file = path.slice(resolveIdx + 2).join('/')
  if (!org || !repo || !rev || !file) return null
  if (rev !== revision) return null

  const modelId = `${org}/${repo}`
  return {
    modelId,
    cacheKey: `${org}--${repo}`,
    file,
    url: `${hfBase}/${org}/${repo}/resolve/${rev}/${file}`,
  }
}
