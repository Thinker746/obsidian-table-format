# Table Format

一个 Obsidian 插件：选中表格中的若干单元格，把它们合并成一个(横向 colspan、纵向 rowspan 或矩形区域)。

## 合并语法

合并信息直接写在 Markdown 表格里，不依赖额外文件，没装插件时表格也能正常显示：

| 单元格内容 | 含义 |
| --- | --- |
| `<` | 与左边的单元格合并 |
| `^` | 与上边的单元格合并 |

示例：

```markdown
| 季度 | 产品     | <   | 备注 |
| ---- | -------- | --- | ---- |
| Q1   | 手机     | 120 | 旺季 |
| ^    | 平板     | 80  | ^    |
| Q2   | 合计 200 | <   | -    |
```

在阅读视图中渲染为：「产品」横跨 2 列，「Q1」和「旺季」纵跨 2 行，「合计 200」横跨 2 列。

## 使用方法

1. 把光标放进表格。
2. 选择单元格，二选一：
   - **在编辑器里直接选中**：拖选一段从某个单元格到另一个单元格的文字(源码模式下最方便)，执行命令「合并选中的单元格」。
   - **用面板选**：执行命令「打开单元格合并面板」，或在表格上点右键选「合并单元格…」，在弹出的网格里用鼠标或手指拖选，也可以先点一个单元格再按住 Shift 点另一个，然后点「合并」。
3. 想取消合并时，选中已合并的单元格，执行「拆分单元格(取消合并)」，或在面板里点「拆分」。

| 命令 | 作用 |
| --- | --- |
| 合并选中的单元格 | 选区跨了多个单元格时直接合并，否则打开面板 |
| 打开单元格合并面板 | 打开网格选择面板 |
| 拆分单元格(取消合并) | 拆开选区涉及的所有合并区域 |
| 对齐表格列宽 | 按显示宽度对齐源码中的列(中文算两个字符) |

可以在「设置 → 快捷键」里给这些命令绑定快捷键。

### 规则

- 选区碰到已合并的区域时，会自动扩大到包含整个区域，所以可以在已有合并的基础上继续合并。
- 被合并的单元格里有文字时，默认用空格拼接后放进左上角单元格；在设置里可以改成用 `<br>` 换行拼接，或只保留左上角的内容。
- 表头行可以横向合并，但不能和正文行纵向合并(HTML 表格的表头和正文是分开的)。

## 已知限制

- 合并效果显示在**阅读视图**和 **PDF 导出**中。实时预览(Live Preview)使用 Obsidian 自带的表格编辑器，里面仍显示 `<` / `^` 标记。
- 单元格内容如果恰好只有一个 `<` 或 `^`，会被当作合并标记。

## 安装

### 从 Release 下载

1. 打开 [Releases](https://github.com/Thinker746/obsidian-table-format/releases)，下载最新版本的 `table-format-<版本号>.zip`。
2. 解压到库目录下的 `.obsidian/plugins/`，得到 `.obsidian/plugins/table-format/`(里面有 `main.js`、`manifest.json`、`styles.css`)。
3. 重启 Obsidian 或在「设置 → 第三方插件」中刷新，然后启用 **Table Format**。

也可以用 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 插件，填入 `Thinker746/obsidian-table-format`，自动安装和更新。

### 从源码构建

```bash
npm install
npm run build
```

把 `main.js`、`manifest.json`、`styles.css` 复制到 `.obsidian/plugins/table-format/`。

### 开发

```bash
npm run dev    # 监听源码变化并重新构建
npm test       # 运行单元测试
```

### 发布新版本

```bash
npm version patch   # 或 minor / major：同步更新 manifest.json、versions.json，并打上标签
git push --follow-tags
```

推送标签后，GitHub Actions 会运行测试、构建，并创建 Release(附带 `main.js`、`manifest.json`、`styles.css` 和打包好的 zip)。
