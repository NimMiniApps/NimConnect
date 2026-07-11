import { onMounted, watch } from 'vue'
import { dataRefreshEpoch } from '../services/restore'

/** Re-run a page refresh when backup restore completes. */
export function useAfterRestoreRefresh(refresh: () => void | Promise<void>, runOnMount = true) {
  if (runOnMount) {
    onMounted(() => {
      void refresh()
    })
  }
  watch(dataRefreshEpoch, () => {
    void refresh()
  })
}
