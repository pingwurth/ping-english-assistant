/**
 * 模型设置页的功能卡片区 —— Kokoro 本地 TTS 与 SOE 语音评测配置。
 * 从 model-config-list-dialog.tsx 拆出（2026-11 全仓复审 c078：主文件 1029 行
 * 超 README「文件 < 800 行」约定；两卡片与列表/弹窗无状态耦合，天然可独立）。
 */

import { useCallback, useEffect, useState } from 'react'
import { Headphones, Mic, Pencil } from 'lucide-react'
import { invalidateSoeServiceCache } from '@/services'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { DEFAULT_SOE_PROXY_URL } from '@/lib/service-endpoints'
import { getKokoroModelId, setKokoroModelId } from '@/platform/kokoro-tts'

export const SOE_PROVIDERS = [
  { value: 'mock', label: '演示模式' },
  { value: 'azure', label: 'Azure' },
  { value: 'iflytek', label: '科大讯飞' },
  { value: 'tencent', label: '腾讯云' },
] as const

/* ── KokoroConfigCard — Kokoro 本地 TTS 配置 ── */

export function KokoroConfigCard() {
  const [modelId, setModelId] = useState('')
  const [modelPath, setModelPath] = useState('')
  const [editing, setEditing] = useState(false)
  const [editModelId, setEditModelId] = useState('')
  const [editModelPath, setEditModelPath] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/settings/kokoro')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.modelId) setModelId(data.modelId)
        if (data?.modelPath) setModelPath(data.modelPath)
      })
      .catch(() => {})
  }, [])

  const handleEdit = () => {
    setEditModelId(modelId)
    setEditModelPath(modelPath)
    setEditing(true)
    setError('')
  }

  const handleCancel = () => {
    setEditing(false)
    setError('')
  }

  const handleSave = async () => {
    if (!editModelId.trim()) { setError('模型 ID 不能为空'); return }
    if (!editModelPath.trim()) { setError('模型路径不能为空'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/settings/kokoro', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: editModelId.trim(), modelPath: editModelPath.trim() }),
      })
      if (!res.ok) throw new Error('保存失败')
      setModelId(editModelId.trim())
      setModelPath(editModelPath.trim())
      setKokoroModelId(editModelId.trim())
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base"><Headphones data-icon="inline-start" />Kokoro 配置</CardTitle>
          {!editing && (
            <Button size="sm" variant="outline" onClick={handleEdit}>
              <Pencil className="mr-1 size-3" />编辑
            </Button>
          )}
        </div>

        <div className="rounded-xl border px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">本地离线语音合成模型（ONNX Runtime Web）</p>
          {editing ? (
            <div className="mt-2 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">模型 ID</label>
                <Input
                  value={editModelId}
                  onChange={e => setEditModelId(e.target.value)}
                  placeholder="onnx-community/Kokoro-82M-v1.0-ONNX"
                />
                <p className="text-xs text-muted-foreground">HuggingFace 模型 ID，用于下载模型文件</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">模型路径</label>
                <Input
                  value={editModelPath}
                  onChange={e => setEditModelPath(e.target.value)}
                  placeholder="/home/user/.ping-eng/kokoro-models"
                />
                <p className="text-xs text-muted-foreground">模型文件本地存储目录，启动时优先从此路径加载</p>
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
                  {saving ? '保存中...' : '保存'}
                </Button>
                <Button size="sm" variant="outline" onClick={handleCancel}>取消</Button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex flex-col gap-1.5">
              <div>
                <p className="text-xs text-muted-foreground">模型 ID</p>
                <p className="truncate text-sm font-medium">{modelId || '加载中...'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">模型路径</p>
                <p className="truncate text-sm font-medium font-mono text-xs">{modelPath || '加载中...'}</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                运行时状态：{getKokoroModelId() === modelId ? '已同步' : '待加载'}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/* ── SoeConfigCard — 语音评测（跟读评分）配置 ── */

/** SOE 配置形态（settings.json 的 soe section；与 lib/server-settings.ts 保持一致） */
interface SoeConfig {
  provider: 'mock' | 'azure' | 'tencent' | 'iflytek'
  proxyUrl: string
  /** 代理共享密钥（server/.env SOE_SHARED_TOKEN；GET 回填为掩码，保存时原样回传保留真值） */
  sharedToken?: string
  azure?: { key?: string; region?: string; host?: string }
  tencent?: { appId?: string; secretId?: string; secretKey?: string }
  iflytek?: { appId?: string; apiKey?: string; apiSecret?: string }
}

const soeProviderLabel = (v: SoeConfig['provider']) => SOE_PROVIDERS.find(p => p.value === v)?.label || v

/** 凭据齐备判定（与服务端 providerCredsOk 同口径：azure 密钥+端点、tencent 三件、iflytek 三件） */
function soeCredsOk(c: SoeConfig, name: 'azure' | 'tencent' | 'iflytek'): boolean {
  if (name === 'azure') return Boolean(c.azure?.key && (c.azure?.host || c.azure?.region))
  if (name === 'tencent') return Boolean(c.tencent?.appId && c.tencent?.secretId && c.tencent?.secretKey)
  return Boolean(c.iflytek?.appId && c.iflytek?.apiKey && c.iflytek?.apiSecret)
}

/** 各 provider 的凭据输入字段表（标签/占位/是否密文）—— 数据驱动渲染。
 *  原为三个 ~29 行 JSX 块逐字段拷贝，新增字段或漏一个 type=password 只会发生在单侧 */
const SOE_CRED_FIELDS: Record<'azure' | 'tencent' | 'iflytek', Array<{ key: string; label: string; placeholder: string; password?: boolean }>> = {
  azure: [
    { key: 'key', label: 'Speech Key', placeholder: 'Azure 资源密钥（Ocp-Apim-Subscription-Key）', password: true },
    { key: 'region', label: 'Region', placeholder: 'eastasia' },
    { key: 'host', label: 'Host（可选）', placeholder: '自定义域名资源（设置后优先于 Region）' },
  ],
  tencent: [
    { key: 'appId', label: 'AppID', placeholder: '腾讯云账号 AppID（数字，控制台「账号信息」页）' },
    { key: 'secretId', label: 'SecretId', placeholder: '腾讯云 CAM API 密钥 SecretId' },
    { key: 'secretKey', label: 'SecretKey', placeholder: '腾讯云 CAM API 密钥 SecretKey', password: true },
  ],
  iflytek: [
    { key: 'appId', label: 'AppId', placeholder: '讯飞控制台「语音评测」应用 AppId' },
    { key: 'apiKey', label: 'APIKey', placeholder: '讯飞 API Key', password: true },
    { key: 'apiSecret', label: 'APISecret', placeholder: '讯飞 API Secret', password: true },
  ],
}

export function SoeConfigCard() {
  const [config, setConfig] = useState<SoeConfig | null>(null)
  const [editing, setEditing] = useState(false)
  const [editProvider, setEditProvider] = useState<SoeConfig['provider']>('mock')
  const [editProxyUrl, setEditProxyUrl] = useState('')
  const [editAzure, setEditAzure] = useState({ key: '', region: '', host: '' })
  const [editTencent, setEditTencent] = useState({ appId: '', secretId: '', secretKey: '' })
  const [editIflytek, setEditIflytek] = useState({ appId: '', apiKey: '', apiSecret: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [health, setHealth] = useState<'unknown' | 'ok' | 'down'>('unknown')

  // 连接徽标走同源 BFF（内部探测 {proxyUrl}/healthz，无 CORS）；任何失败静默置为未连接
  const checkHealth = useCallback(async () => {
    setHealth('unknown')
    try {
      const res = await fetch('/api/soe/health', { signal: AbortSignal.timeout(4000) })
      const data = res.ok ? await res.json().catch(() => null) : null
      setHealth(data?.ok ? 'ok' : 'down')
    } catch {
      setHealth('down')
    }
  }, [])

  // 挂载加载配置（失败回落默认：mock + 默认代理地址）并检测一次连通性
  useEffect(() => {
    const fallback: SoeConfig = { provider: 'mock', proxyUrl: DEFAULT_SOE_PROXY_URL }
    fetch('/api/settings/soe')
      .then(res => res.ok ? res.json() : null)
      .then((data: SoeConfig | null) => setConfig(data ?? fallback))
      .catch(() => setConfig(fallback))
    void checkHealth()
  }, [checkHealth])

  /** 代理共享密钥（server/.env SOE_SHARED_TOKEN；跨机部署代理开启鉴权时必填，本机回环可留空） */
  const [editToken, setEditToken] = useState('')

  /** 三 provider 凭据编辑值的统一读写（SOE_CRED_FIELDS 数据驱动渲染用） */
  const editCreds = { azure: editAzure, tencent: editTencent, iflytek: editIflytek } as const
  const setEditCred = (provider: keyof typeof editCreds, key: string, value: string) => {
    if (provider === 'azure') setEditAzure((p) => ({ ...p, [key]: value } as typeof p))
    else if (provider === 'tencent') setEditTencent((p) => ({ ...p, [key]: value } as typeof p))
    else setEditIflytek((p) => ({ ...p, [key]: value } as typeof p))
  }

  const handleEdit = () => {
    const c = config ?? { provider: 'mock' as const, proxyUrl: DEFAULT_SOE_PROXY_URL }
    setEditProvider(c.provider)
    setEditProxyUrl(c.proxyUrl)
    setEditToken(c.sharedToken ?? '')
    setEditAzure({ key: c.azure?.key ?? '', region: c.azure?.region ?? '', host: c.azure?.host ?? '' })
    setEditTencent({ appId: c.tencent?.appId ?? '', secretId: c.tencent?.secretId ?? '', secretKey: c.tencent?.secretKey ?? '' })
    setEditIflytek({ appId: c.iflytek?.appId ?? '', apiKey: c.iflytek?.apiKey ?? '', apiSecret: c.iflytek?.apiSecret ?? '' })
    setEditing(true)
    setError('')
  }

  const handleCancel = () => {
    setEditing(false)
    setError('')
  }

  const handleSave = async () => {
    if (editProvider !== 'mock' && !editProxyUrl.trim()) { setError('代理服务地址不能为空'); return }
    setSaving(true)
    setError('')
    try {
      // 未选中的 provider 保留已存密钥；选中者以编辑值整体覆盖（空串由服务端归一丢弃）
      const body: SoeConfig = {
        provider: editProvider,
        proxyUrl: editProxyUrl.trim() || DEFAULT_SOE_PROXY_URL,
        sharedToken: editToken.trim() || undefined,
        azure: editProvider === 'azure' ? editAzure : config?.azure,
        tencent: editProvider === 'tencent' ? editTencent : config?.tencent,
        iflytek: editProvider === 'iflytek' ? editIflytek : config?.iflytek,
      }
      const res = await fetch('/api/settings/soe', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('保存失败')
      // PUT 已成功就先失效评分服务缓存，再做响应解析/收尾 —— 解析抖动不该让
      // 已持久化的设置继续用旧缓存（res.json() 抛错会跳过原本放在后面的失效调用）
      invalidateSoeServiceCache()
      setConfig(await res.json().catch(() => null) ?? body)
      setEditing(false)
      void checkHealth()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base"><Mic data-icon="inline-start" />语音评测</CardTitle>
          {!editing && (
            <div className="flex items-center gap-2">
              {config?.provider === 'mock' ? (
                <span className="text-xs text-muted-foreground">演示模式·无需代理</span>
              ) : health === 'ok' ? (
                <Badge variant="secondary">已连接</Badge>
              ) : health === 'down' ? (
                <Badge variant="destructive">未连接</Badge>
              ) : (
                <span className="text-xs text-muted-foreground">检测中…</span>
              )}
              <Button size="sm" variant="outline" onClick={handleEdit}>
                <Pencil className="mr-1 size-3" />编辑
              </Button>
            </div>
          )}
        </div>

        <div className="rounded-xl border px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">跟读发音评分（provider 与密钥存本机 settings.json，经同源服务转发）</p>
          {editing ? (
            <div className="mt-2 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">评分服务</label>
                <select
                  value={editProvider}
                  onChange={(e) => setEditProvider(e.target.value as SoeConfig['provider'])}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {SOE_PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">代理服务地址</label>
                <Input
                  value={editProxyUrl}
                  onChange={(e) => setEditProxyUrl(e.target.value)}
                  placeholder={DEFAULT_SOE_PROXY_URL}
                />
              </div>
              {editProvider !== 'mock' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">共享密钥（可选）</label>
                  <Input
                    type="password"
                    value={editToken}
                    onChange={(e) => setEditToken(e.target.value)}
                    placeholder="代理 server 的 SOE_SHARED_TOKEN；本机回环部署可留空"
                  />
                </div>
              )}

              {editProvider !== 'mock' && (
                <div className="flex flex-col gap-2">
                  {SOE_CRED_FIELDS[editProvider].map((f) => (
                    <div key={f.key} className="flex flex-col gap-1.5">
                      <label className="text-sm font-medium">{f.label}</label>
                      <Input
                        type={f.password ? 'password' : undefined}
                        value={(editCreds[editProvider] as Record<string, string>)[f.key]}
                        onChange={(e) => setEditCred(editProvider, f.key, e.target.value)}
                        placeholder={f.placeholder}
                      />
                    </div>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                {editProvider === 'mock'
                  ? '演示模式使用本地伪评分，无需代理与密钥'
                  : '密钥保存在本机 ~/.ping-eng/settings.json，由本地服务转发至评分代理，不会进入浏览器评分请求'}
              </p>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
                  {saving ? '保存中...' : '保存'}
                </Button>
                <Button size="sm" variant="outline" onClick={handleCancel}>取消</Button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex flex-col gap-1.5">
              <div>
                <p className="text-xs text-muted-foreground">评分服务</p>
                <p className="text-sm font-medium">{config ? soeProviderLabel(config.provider) : '加载中...'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">代理服务地址</p>
                <p className="truncate font-mono text-xs font-medium">{config?.proxyUrl || DEFAULT_SOE_PROXY_URL}</p>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                <span>Azure：{config && soeCredsOk(config, 'azure') ? '已配置' : '未配置'}</span>
                <span>科大讯飞：{config && soeCredsOk(config, 'iflytek') ? '已配置' : '未配置'}</span>
                <span>腾讯云：{config && soeCredsOk(config, 'tencent') ? '已配置' : '未配置'}</span>
                <span>共享密钥：{config?.sharedToken ? '已配置' : '未配置'}</span>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
