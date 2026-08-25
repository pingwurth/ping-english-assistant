/**
 * useSyncExternalStore 极简订阅封装 —— 零依赖替代 zustand/Pinia（原型端状态层）。
 * 与框架解耦：store 本体是纯 JS 对象，React 侧仅通过 useStore 订阅。
 */

import { useSyncExternalStore } from 'react'

export interface Store<T> {
  get: () => T
  set: (next: T | ((prev: T) => T)) => void
  subscribe: (listener: () => void) => () => void
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set: (next) => {
      state = typeof next === 'function' ? (next as (prev: T) => T)(state) : next
      listeners.forEach((l) => l())
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

/** React 订阅 hook（SSR 安全：getServerSnapshot 返回当前值） */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
