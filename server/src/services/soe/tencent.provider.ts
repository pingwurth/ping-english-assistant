/**
 * 腾讯云智聆口语评测（SOE）—— 备选方案占位，未实施。
 * 不实施原因（选型报告 §5.2）：基础版已宣布停止迭代（迁移 OEN 的成本与 OEN 定价待确认）；
 * 且初始化+分片的两段式协议代理实现比 Azure REST 重。Azure 网络不可达时再补。
 */

import { apiError, ERR } from '../../lib/api-error'
import type { SoeProvider } from './soe-provider'

export function createTencentSoeProvider(): SoeProvider {
  return {
    name: 'tencent',
    evaluate: async () => {
      throw apiError(ERR.PROVIDER_NOT_IMPLEMENTED, '腾讯 SOE provider 尚未实施（见 docs/发音评分技术选型报告.md §5.2）')
    },
  }
}
