'use client'
import { Toaster } from "@/components/ui/toaster"
import "./globals.css";
import 'react-photo-view/dist/react-photo-view.css';
import { Suspense, useEffect } from "react";
import { NextIntlProvider } from "@/components/providers/NextIntlProvider";
import Script from "next/script";
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
          {/* Polyfills for older macOS WKWebView (Safari 11-12) — must run before any app JS */}
          <Script id="legacy-polyfills" strategy="beforeInteractive">
            {`
              (function() {
                // globalThis — Safari 12.1+
                if (typeof globalThis === 'undefined') {
                  window.globalThis = window;
                }

                // Array.prototype.flatMap — Safari 12+
                if (!Array.prototype.flatMap) {
                  Array.prototype.flatMap = function(callback, thisArg) {
                    return Array.prototype.concat.apply([], this.map(callback, thisArg));
                  };
                }
                // Array.prototype.flat — Safari 12+
                if (!Array.prototype.flat) {
                  Array.prototype.flat = function(depth) {
                    depth = depth === undefined ? 1 : Math.floor(depth);
                    if (depth < 1) return Array.prototype.slice.call(this);
                    return (function flat(arr, d) {
                      var result = [];
                      for (var i = 0; i < arr.length; i++) {
                        if (Array.isArray(arr[i]) && d > 0) {
                          result = result.concat(flat(arr[i], d - 1));
                        } else {
                          result.push(arr[i]);
                        }
                      }
                      return result;
                    })(this, depth);
                  };
                }

                // String.prototype.replaceAll — Safari 13.1+
                if (!String.prototype.replaceAll) {
                  String.prototype.replaceAll = function(search, replacement) {
                    if (search instanceof RegExp) {
                      if (!search.global) {
                        throw new TypeError('String.prototype.replaceAll called with a non-global RegExp argument');
                      }
                      return this.replace(search, replacement);
                    }
                    return this.split(search).join(replacement);
                  };
                }

                // Object.fromEntries — Safari 12.1+
                if (!Object.fromEntries) {
                  Object.fromEntries = function(iterable) {
                    var obj = {};
                    for (var i = 0; i < iterable.length; i++) {
                      var entry = iterable[i];
                      if (Object(entry) === entry) {
                        var key = String(entry[0]);
                        var val = entry[1];
                        obj[key] = val;
                      }
                    }
                    return obj;
                  };
                }

                // Promise.allSettled — Safari 13+
                if (typeof Promise !== 'undefined' && !Promise.allSettled) {
                  Promise.allSettled = function(promises) {
                    return Promise.all(promises.map(function(p) {
                      return Promise.resolve(p).then(
                        function(value) { return { status: 'fulfilled', value: value }; },
                        function(reason) { return { status: 'rejected', reason: reason }; }
                      );
                    }));
                  };
                }

                // Promise.any — Safari 14+ (used by some dependencies)
                if (typeof Promise !== 'undefined' && !Promise.any) {
                  Promise.any = function(promises) {
                    return new Promise(function(resolve, reject) {
                      var pending = promises.length;
                      var errors = [];
                      if (pending === 0) {
                        reject(new AggregateError([], 'All promises were rejected'));
                        return;
                      }
                      promises.forEach(function(p, i) {
                        Promise.resolve(p).then(resolve, function(err) {
                          errors[i] = err;
                          if (--pending === 0) {
                            reject(new AggregateError(errors, 'All promises were rejected'));
                          }
                        });
                      });
                    });
                  };
                }

                // Array.prototype.findLast — Safari 15.4+
                if (!Array.prototype.findLast) {
                  Array.prototype.findLast = function(callback, thisArg) {
                    for (var i = this.length - 1; i >= 0; i--) {
                      if (callback.call(thisArg, this[i], i, this)) return this[i];
                    }
                  };
                }
                // Array.prototype.findLastIndex — Safari 15.4+
                if (!Array.prototype.findLastIndex) {
                  Array.prototype.findLastIndex = function(callback, thisArg) {
                    for (var i = this.length - 1; i >= 0; i--) {
                      if (callback.call(thisArg, this[i], i, this)) return i;
                    }
                    return -1;
                  };
                }

                // Array.prototype.at — Safari 15.4+
                if (!Array.prototype.at) {
                  Array.prototype.at = function(index) {
                    var n = this.length;
                    var i = index >= 0 ? index : n + index;
                    return i >= 0 && i < n ? this[i] : undefined;
                  };
                }

                // String.prototype.at — Safari 15.4+
                if (!String.prototype.at) {
                  String.prototype.at = function(index) {
                    var s = String(this);
                    var n = s.length;
                    var i = index >= 0 ? index : n + index;
                    return i >= 0 && i < n ? s.charAt(i) : undefined;
                  };
                }

                // structuredClone — Safari 15.4+
                if (typeof structuredClone === 'undefined') {
                  window.structuredClone = function(obj) {
                    return JSON.parse(JSON.stringify(obj));
                  };
                }

                // Object.hasOwn — Safari 15.4+
                if (!Object.hasOwn) {
                  Object.hasOwn = function(obj, prop) {
                    return Object.prototype.hasOwnProperty.call(obj, prop);
                  };
                }

                // String.prototype.matchAll — Safari 13+
                if (!String.prototype.matchAll) {
                  String.prototype.matchAll = function(regexp) {
                    if (regexp instanceof RegExp) {
                      if (!regexp.global) {
                        throw new TypeError('String.prototype.matchAll called with a non-global RegExp argument');
                      }
                    } else {
                      regexp = new RegExp(regexp, 'g');
                    }
                    var matches = [];
                    var match;
                    var s = String(this);
                    while ((match = regexp.exec(s)) !== null) {
                      matches.push(match);
                    }
                    return matches;
                  };
                }

                // AggregateError — Safari 14+
                if (typeof AggregateError === 'undefined') {
                  window.AggregateError = function(errors, message) {
                    var err = new Error(message);
                    err.errors = errors;
                    err.name = 'AggregateError';
                    return err;
                  };
                }
              })();
            `}
          </Script>
          {/* Define isSpace function globally to fix markdown-it issues with Next.js + Turbopack
          https://github.com/markdown-it/markdown-it/issues/1082#issuecomment-2749656365 */}
          <Script id="markdown-it-fix" strategy="beforeInteractive">
            {`
              if (typeof window !== 'undefined' && typeof window.isSpace === 'undefined') {
                window.isSpace = function(code) {
                  return code === 0x20 || code === 0x09 || code === 0x0A || code === 0x0B || code === 0x0C || code === 0x0D;
                };
              }
            `}
          </Script>
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
