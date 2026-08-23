<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app';
import { useMaterialStore } from '@/stores/material';
import { useSettingsStore } from '@/stores/settings';

onLaunch(async () => {
  // 本地优先（ADR-4）：启动时从端内持久层恢复材料库与设置
  const settings = useSettingsStore();
  settings.restore();
  const materials = useMaterialStore();
  await materials.restore();
});
</script>

<style lang="scss">
/* 全局基础样式：三端共用 */
page {
  background: #f7f8fa;
  color: #1f2329;
  font-size: 14px;
  line-height: 1.6;
}
</style>
