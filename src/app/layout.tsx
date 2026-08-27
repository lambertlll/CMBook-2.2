'use client'
import { Toaster } from "@/components/ui/toaster"
import "./globals.css";
import 'react-photo-view/dist/react-photo-view.css';
import { Suspense, useEffect } from "react";
import { NextIntlProvider } from "@/components/providers/NextIntlProvider";
import { getSyncPushQueue } from "@/lib/sync/sync-push-queue";
import { ConsoleFilter } from "@/components/console-filter";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 初始化同步推送队列
  useEffect(() => {
    getSyncPushQueue()
  }, [])

  return (
    <>
      <html lang="en" suppressHydrationWarning>
        <head>
          {/* 移动端视口设置 */}
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, viewport-fit=cover"
          />
          <meta name="mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
          {/* 浏览器兼容性检测 — 纯 ES5，阻塞执行，在任何应用 JS 之前运行。
              检测到不兼容的 WKWebView 时替换页面为升级提示，避免白屏。 */}
          {/* eslint-disable-next-line @next/next/no-sync-scripts -- 必须同步阻塞执行，确保在应用 JS 之前完成检测 */}
          <script src="/browser-check.js" />
          {/* Define isSpace globally to fix markdown-it issues with Next.js + Turbopack
          https://github.com/markdown-it/markdown-it/issues/1082#issuecomment-2749656365
          必须在 head 顶部 + 同步阻塞 + 顶层 var（不是 window 属性）：
            - next/script beforeInteractive 异步执行，某些 WebView 下 markdown-it 先跑 → 崩
            - 仅 window.isSpace = ... 不够——旧版 markdown-it 内部直接 isSpace() 全局调用，
              严格模式下 ReferenceError ("Can't find variable: isSpace" / "is not defined")
              顶层 var 会同时创建 window 属性和真正的全局标识符，两种调用方式都覆盖 */}
          {/* eslint-disable-next-line @next/next/no-sync-scripts -- 必须同步阻塞且顶层 var，确保 markdown-it 在任何 WebView 环境都能拿到 isSpace */}
          <script
            dangerouslySetInnerHTML={{
              __html: `
                try {
                  if (typeof window !== 'undefined') {
                    var __isSpace = window.isSpace;
                    if (typeof __isSpace !== 'function') {
                      __isSpace = function(code) {
                        return code === 0x20 || code === 0x09 || code === 0x0A || code === 0x0B || code === 0x0C || code === 0x0D;
                      };
                    }
                    window.isSpace = __isSpace;
                    /* 顶层 var 自动挂 window 属性并创建真正的全局标识符；
                       旧版 markdown-it 直接 isSpace(...) 调用也能解析到 */
                    var isSpace = __isSpace;
                  }
                } catch (e) { /* polyfill 自身异常不影响后续 JS */ }
              `,
            }}
          />
          {/* 首帧主题初始化：默认「东方纸韵」(paper)，同步设置 data-theme 避免首屏闪烁；
              用户持久化的其他主题由 ui-theme store 启动时异步覆盖 */}
          {/* eslint-disable-next-line @next/next/no-sync-scripts -- 必须在任何应用 JS 前同步应用主题 */}
          <script src="/theme-init.js" />
        </head>
        <body suppressHydrationWarning>
          <ConsoleFilter />
          <Suspense>
            <NextIntlProvider>
              {children}
            </NextIntlProvider>
          </Suspense>
          <Toaster />
        </body>
      </html>
    </>
  );
}
