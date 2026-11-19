# Web Annotator

Chrome / Edge Manifest V3 浏览器扩展：划词 **AI 上下文批注** + **网页翻译**。  
通过你自己配置的 OpenAI 兼容 API（Base URL + API Key + 模型）完成请求。

## 功能

- **AI 上下文批注**：选中文字后点击「AI 批注」，自动抽取正文/大纲，并结合**整篇文章**解读选区（过长则截取开头+选区附近+结尾）
- **多轮对话**：批注面板内可继续追问；支持「清空对话」重新开始
- **图片 / 文本附件**：对话中可附带图片（PNG/JPG/GIF/WebP）与常见文本文件（自动压缩图片、截断过长文本）
- **翻译选区**：工具条「翻译选区」，结果可一键替换选区
- **翻译本页**：工具条或扩展弹窗触发，分批翻译可见文本节点；可「还原本页」
- **设置**：保存 API 配置、测试连接；API Key 仅存本机 `chrome.storage.sync`

## 安装（加载已解压的扩展）

本扩展为纯前端 MV3 源码，**无需 npm build**，直接加载项目目录即可。

1. 打开 Chrome / Edge，进入 `chrome://extensions`（或 `edge://extensions`）
2. 打开「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本目录：`~/Projects/web-annotator`
5. 点击工具栏扩展图标，填写：
   - **API Base URL**（默认 `https://api.openai.com/v1`）
   - **API Key**
   - **模型**（默认 `gpt-4o-mini`）
   - **翻译目标语言**（默认中文）
6. 点击「测试连接」确认可用，再「保存设置」

## 使用

1. 打开任意网页，选中一段文字
2. 出现浮动工具条：`AI 批注` / `翻译选区` / `翻译本页` / `还原本页`
3. 结果在右侧面板展示；批注可继续对话、附加图片/文本文件，也可「保存」；译文可「替换选区」
4. 图片理解需模型支持视觉（如 `gpt-4o`、通义千问 VL / 多模态型号）

## 目录结构

```
web-annotator/
  manifest.json
  background/service-worker.js   # API 调用与消息路由
  content/content.js             # 划词工具条、面板、整页翻译
  content/styles.css
  popup/                         # 设置页
  shared/                        # storage / prompts / 默认配置
  icons/
```

## 权限说明

- `storage`：保存设置与批注历史
- `activeTab` / `scripting`：与当前页通信、整页翻译
- `host_permissions`：向任意网页注入 content script，并向你配置的 API 域名发起请求

## 兼容接口

请求格式为 OpenAI Chat Completions：

`POST {baseUrl}/chat/completions`

可使用 OpenAI 官方，或其它兼容网关（需自行填写对应 Base URL 与 Key）。

## 开发说明

当前实现不依赖打包工具，修改源码后在扩展管理页点击「重新加载」即可生效。  
若后续需要 TypeScript / Vite 构建链，可在本目录基础上再加脚手架。
