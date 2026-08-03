/**
 * 首帧主题初始化（纯 ES5，同步阻塞，置于 <head> 最前，先于任何应用 JS）
 *
 * 目标：应用默认主题为「东方纸韵」(paper)——用户在首帧即看到纸韵，
 * 避免先以经典主题渲染、再由异步初始化跳变的闪烁。
 *
 * 说明：
 * - 这里直接设置 data-theme="paper" 并移除 .dark（paper 为浅色主题）；
 *   若用户此前在设置中持久化了其他主题（classic/navy/obsidian），
 *   ui-theme store 的 initUiTheme() 会在应用启动时异步读取 store.json 并覆盖为本值。
 * - 与 next-themes 的 class 策略互不冲突：next-themes 只管理 .dark 类，
 *   而 data-theme 由本脚本与 applyUiTheme 管理。
 */
(function () {
  try {
    var root = document.documentElement;
    root.setAttribute('data-theme', 'paper');
    root.classList.remove('dark');
    // 同步 next-themes 的明暗记忆，避免其初始化时按 system 重新应用
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('theme', 'light');
      }
    } catch (e) {
      /* localStorage 不可用时忽略（主题仍会由 initUiTheme 应用） */
    }
  } catch (e) {
    /* 首帧主题设置失败时静默，由 initUiTheme 兜底 */
  }
})();
