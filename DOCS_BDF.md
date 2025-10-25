# BDF 位图字体接入指南

本扩展支持在预览中使用 BDF 位图字体逐像素渲染文本（`drawStr`、`setCursor + print/println`）。

- 配置项：
  - `u8g2Preview.font.bdfPath`：BDF 文件路径（支持工作区相对路径或绝对路径）。
  - `u8g2Preview.font.useDrawColor`：文本是否遵循 `setDrawColor`（默认 true）。若关闭，文本始终用前景色绘制，避免与背景色相同导致看不见。

- 使用步骤：
  1. 准备一个像素字体的 `.bdf` 文件（ASCII 区间即可）。
  2. 在 VS Code 设置中填写 `u8g2Preview.font.bdfPath`。
  3. 打开预览（`U8g2: Open Preview`），输出面板可见字体加载日志。

- 注意事项：
  - BDF 的度量使用字体自带的 `FONT_ASCENT/DESCENT/BBX/DWIDTH` 信息，渲染基线与 U8g2 的光栅化可能存在 1px 左右差异，可用于布局预览。
  - 如需“直接”解析 U8g2 的压缩字体（`u8g2_font_*.c`），需要额外的解码器（后续可扩展）。若手头有等价 BDF 字体，推荐先用 BDF 方案进行预览。

- 示例：
  ```c
  u8g2.setCursor(0, 12);
  u8g2.print("HELLO 123");
  ```
  建议在绘制文字前确保 `setDrawColor(1)`，或在设置中关闭 `u8g2Preview.font.useDrawColor`。

