# Changelog

## v1.6.4 - 2026-04-05

### Fixed

- 修复长对话里超长 widget 在滚动回看时容易先出现空白再补画的问题。
- 修复高交互 widget 在预览链路下可能被错误接管，导致点击后出现白屏或状态丢失的问题。
- 修复运行时仍按导出时初始高度判断 `lazy / eager` 的偏差，改为结合当前视口高度与实际测量高度动态重算。

### Changed

- 长展示型 widget 默认显示预览图，点击后永久切换到真实 `live iframe`。
- 高交互 widget 默认保持 `live iframe`，不进入预览图模式。
- builder 会为 widget 标注显示型 / 交互型行为，runtime 优先使用该标注做渲染决策。
- 长 widget 预热顺序改为显式优先级：视口内 -> 视口下方 -> 视口上方。

### Tests

- `node --test tests/export-builder.test.js`
- `npx -y -p @playwright/test playwright test tests/export-page.e2e.spec.js --reporter=line`
