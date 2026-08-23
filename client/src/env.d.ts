/// <reference types="@dcloudio/types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

declare module 'recorder-core';

/** uni-app 条件编译平台宏（架构文档 §2.1 适配层） */
declare const uni: UniApp.Uni;
