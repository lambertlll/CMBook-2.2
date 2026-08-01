/**
 * CMBook 浏览器兼容性检测 — 纯 ES5，必须在所有应用 JS 之前执行
 *
 * 检测项：
 *   1. JS 逻辑赋值 ??=           (Safari 14+)
 *   2. JS 私有字段 #x             (Safari 14.1+)
 *   3. CSS oklch()               (Safari 15.4+)
 *   4. CSS color-mix()           (Safari 16.2+)
 *
 * 任何一项不通过都说明 WKWebView 内核过低，应用会白屏或样式错乱，
 * 直接替换页面为升级提示，阻止后续 JS 执行。
 */
(function () {
  var ok = true;
  var code = '';

  // 1. JS 逻辑赋值 ??= (Safari 14+)
  if (ok) {
    try {
      new Function('var a = null; a ??= 1');
    } catch (e) {
      ok = false;
      code = 'JS_ASSIGN';
    }
  }

  // 2. JS 私有字段 (Safari 14.1+)
  if (ok) {
    try {
      new Function('class C { #x = 1; }');
    } catch (e) {
      ok = false;
      code = 'JS_PRIVATE';
    }
  }

  // 3. CSS oklch() (Safari 15.4+)
  if (ok) {
    try {
      var el = document.createElement('div');
      el.style.color = 'oklch(0.5 0.2 240)';
      if (el.style.color === '' || el.style.color.indexOf('oklch') === -1) {
        ok = false;
        code = 'CSS_OKLCH';
      }
    } catch (e) {
      ok = false;
      code = 'CSS_OKLCH';
    }
  }

  // 4. CSS color-mix() (Safari 16.2+)
  if (ok) {
    try {
      var el2 = document.createElement('div');
      el2.style.color = 'color-mix(in srgb, red, blue)';
      if (el2.style.color === '' || el2.style.color.indexOf('color-mix') === -1) {
        ok = false;
        code = 'CSS_MIX';
      }
    } catch (e) {
      ok = false;
      code = 'CSS_MIX';
    }
  }

  if (!ok) {
    showNotice(code);
    // 抛出异常阻止后续脚本执行
    throw new Error('CMBook compatibility check failed: ' + code);
  }

  // 兜底：如果页面加载后 body 仍为空（未预见的问题），显示提示
  window.addEventListener('error', function (e) {
    if (document.body && document.body.children.length === 0) {
      showNotice('RUNTIME');
    }
  });

  function showNotice(reason) {
    var html =
      '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
      'background:#f5f5f5;color:#333;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;' +
      'padding:40px;text-align:center;z-index:999999;">' +
      '<div style="max-width:460px;">' +
      '<div style="font-size:48px;margin-bottom:16px;">\u26A0\uFE0F</div>' +
      '<h2 style="font-size:20px;font-weight:600;margin:0 0 12px 0;">\u7CFB\u7EDF\u7248\u672C\u8FC7\u4F4E</h2>' +
      '<p style="font-size:14px;line-height:1.6;color:#666;margin:0 0 20px 0;">' +
      '\u62DB\u672C\u9700\u8981 macOS 13 (Ventura) \u6216\u66F4\u9AD8\u7248\u672C\u624D\u80FD\u6B63\u5E38\u8FD0\u884C\u3002<br/>' +
      '\u8BF7\u5347\u7EA7 macOS \u7CFB\u7EDF\uFF0C\u6216\u5728\u300C\u7CFB\u7EDF\u8BBE\u7F6E \u203A \u8F6F\u4EF6\u66F4\u65B0\u300D\u4E2D\u66F4\u65B0 Safari\u3002' +
      '</p>' +
      '<p style="font-size:12px;color:#aaa;margin:0;">' +
      '\u5982\u5DF2\u5347\u7EA7\u4ECD\u6709\u6B64\u63D0\u793A\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458\u53CD\u9988\u3002<br/>' +
      '\u8BCA\u65AD\u7801: ' + reason +
      '</p>' +
      '</div></div>';

    document.title = '\u7CFB\u7EDF\u7248\u672C\u8FC7\u4F4E - CMBook';
    if (document.body) {
      document.body.innerHTML = html;
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        document.body.innerHTML = html;
      });
    }
  }
})();
