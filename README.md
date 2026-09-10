<div align="center">

<img src="public/logo.png" width="120" alt="极简待办 Logo" />

# 极简待办 Minimal Todo

> 以桌面贴边挂件的方式记录和处理待办事项 —— 无构建、无框架的 Electron 桌面客户端。

[![Release](https://img.shields.io/github/v/release/handsometaoa/minimal-todo)](https://github.com/handsometaoa/minimal-todo/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](#-开源协议)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey)](#-平台兼容性)
[![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)

**本项目开源，个人使用完全免费。**

[功能特性](#-功能特性) · [下载安装](#-下载安装) · [开发指南](#-开发指南) · [Roadmap](#-roadmap) · [开源协议](#-开源协议)

</div>

## 📖 简介

极简待办是一个无构建、无框架的原生 JavaScript（ES Modules）项目：待办事项支持到期时间、到期提醒弹窗、日期筛选与手动排序；应用以透明贴边条形态常驻屏幕边缘，点击展开为面板，失焦自动收回。数据经 SQLite 落盘本地，用户与会员体系预留标准接口（当前为本地默认实现）。

## ✨ 功能特性

### 待办管理

- 添加 / 编辑 / 删除 / 完成 / 恢复待办，`全部` 视图支持拖动排序
- 到期时间：快捷预设（今天 / 明天 / 后天 / 下周，预设时刻可自定义）+ 自定义日期时间面板
- 到期提醒：30 秒轮询，到期弹出置顶不抢焦点的提醒窗，支持一键完成 / 稍后；已提醒不重复弹
- 过期语义：保存已过期的到期时间不弹提醒（仅提示），改回未来时间自动恢复提醒
- 筛选视图：`全部` / `过期` / `今天` / `明天` / `本周`；筛选视图内按到期时间升序，`全部` 保持手动顺序

### 外观与设置

- 深色 / 浅色 / 跟随系统三种外观模式
- 预设主题色 + 自定义主色 / 辅色
- 数据管理：JSON 导出（写入系统下载目录）/ 导入、清除完成历史

### 桌面形态

- 透明无边框贴边条（36px）↔ 展开面板（544px），停靠左侧或右侧、支持多显示器选择目标屏幕；启动时自动恢复上次停靠位置
- 失焦自动收回、窗口置顶、单实例锁（重复启动自动聚焦已有实例）
- 系统托盘图标（通知区右下角）：左键显示 / 隐藏侧边条，右键菜单可退出；Windows 默认把新图标收进「^」折叠区，可在托盘设置里设为常驻
- 首次启动引导：自动展开面板，分步介绍贴边常驻 / 到期提醒 / 主题个性化，仅首次显示（可跳过）
- 开机自启：设置 → 通用 中开关（Electron 登录项 API，Windows 写注册表 Run 键 / macOS 写登录项，状态以系统为准）
- 到期提醒独立弹窗，数据落盘本地 SQLite（见[存储与用户](#存储与用户)）

### 会员

- SVIP 限时体验中（默认全开，经用户接口读取）；窗口停靠相关设置为会员能力

## 📦 下载安装

**普通用户**无需配置开发环境，直接从 [GitHub Releases](https://github.com/handsometaoa/minimal-todo/releases) 下载最新安装包：

| 平台    | 安装包                          | 说明                        |
| ------- | ------------------------------- | --------------------------- |
| Windows | `极简待办-Setup-<version>.exe`  | NSIS 安装向导，双击安装     |
| macOS   | `极简待办-<version>-<arch>.dmg` | 支持 Apple Silicon 与 Intel |

> 💡 项目开源，**个人使用完全免费**；安装包附带 SHA256 校验码（`SHA256SUMS`），可在下载后自行校验完整性。

## 🛠️ 开发指南

### 环境要求

- [Node.js](https://nodejs.org/) ≥ 22（开发工具链要求）
- 无需构建步骤

```bash
# 克隆仓库
git clone https://github.com/handsometaoa/minimal-todo.git
cd minimal-todo

# 安装依赖（postinstall 会自动对齐 better-sqlite3 的 Electron ABI）
npm install

# 启动
npm start
```

启动后屏幕右缘出现贴边条，点击展开面板；设置页可切换停靠边与目标屏幕。

### 常用命令

| 命令                     | 说明                                                          |
| ------------------------ | ------------------------------------------------------------- |
| `npm start`              | 启动 Electron 桌面客户端                                      |
| `npm run rebuild:native` | 针对 Electron ABI 重建 better-sqlite3（postinstall 自动执行） |
| `npm run lint`           | ESLint 检查                                                   |
| `npm run lint:fix`       | ESLint 自动修复                                               |
| `npm run format`         | Prettier 全量格式化                                           |
| `npm run format:check`   | Prettier 格式校验                                             |
| `npm run check`          | lint + 格式校验 + 模块引用检查（提交前跑这个）                |
| `npm run dist:win`       | 打包 Windows 安装包（NSIS `.exe`，输出到 `dist/`）            |
| `npm run dist:mac`       | 打包 macOS 安装包（`.dmg`，仅 macOS 可执行）                  |

### 项目结构

```
├── package.json              # 应用清单与脚本
├── electron/
│   ├── main.cjs              # 主进程：贴边窗口布局、提醒窗、数据库 IPC、屏幕枚举
│   ├── database.cjs          # SQLite：schema/迁移/DAO（better-sqlite3，WAL）
│   └── preload.cjs           # 渲染进程桥：contextBridge 暴露 window.sidebarHost（含 host.db）
├── public/
│   ├── sidebar.html          # 主面板页面（贴边条 + 展开面板）
│   └── reminder.html         # 到期提醒弹窗页面
├── src/
│   ├── app.js                # 渲染进程入口
│   ├── scripts/
│   │   ├── main.js           # 初始化、事件绑定、提醒轮询循环
│   │   ├── core.js           # 状态、加载/持久化、筛选/排序、主题、工具函数
│   │   ├── ui.js             # 视图渲染与交互
│   │   ├── todo-actions.js   # 待办增删改、到期时间编辑（操作级持久化）
│   │   ├── settings-actions.js / membership-actions.js / data-transfer.js
│   │   ├── reminder.js       # 提醒窗页面逻辑
│   │   ├── storage/          # 仓库层：SQLite（Electron）/ localStorage（浏览器兜底）
│   │   └── user/             # 用户接口：本地默认实现（可替换远程实现）
│   └── styles/styles.css
├── scripts/
│   ├── check-modules.mjs     # 模块引用完整性检查
│   └── verify-db.cjs         # 数据库独立验证（建库/迁移/DAO/持久化）
└── docs/storage-api.md       # 存储模型、仓库接口与用户接口文档
```

### 架构说明

#### 进程与通道

- **主进程**（`electron/main.cjs`）：负责窗口生命周期与宿主能力——贴边布局算法（`todo-sidebar:layout`）、提醒弹窗链路（`todo-reminder:show/ready/empty/dismiss`）、屏幕枚举、系统通知与数据导出
- **数据通道**（`ipcMain.handle`，异步 invoke）：`app-data:bootstrap` 一次拉全量；`todos:create/update/complete/restore/delete/reorder/bulk-replace`、`completed:clear-expired`、`settings:set`、`user:update-profile`、`data:import-legacy`
- **渲染进程**：页面代码通过 `window.sidebarHost`（`electron/preload.cjs` 经 contextBridge 暴露）调用宿主能力与 `host.db` 数据接口

#### 存储与用户

- **存储**：SQLite（`electron/database.cjs`，better-sqlite3 + WAL），库文件 `userData/app-data/minimal-todo.db`；数据模型含 `users / memberships / todos / settings / meta`，待办以单表 `status` 区分进行中与已完成。渲染层经仓库接口（`src/scripts/storage/`）操作级持久化，操作即落库
- **用户**：`src/scripts/user/` 定义统一用户接口（`getProfile / getMembershipStatus / updateProfile / login / logout`），当前为本地默认实现（本地用户 + SVIP 限时体验），后续对接真实用户仅替换工厂实现
- **历史迁移**：旧 JSON 文件存储（1.0.0/1.0.1 的 `userData/storage`）首次建库时自动导入并备份，详见 [docs/storage-api.md](docs/storage-api.md)

## 🖥️ 平台兼容性

- **Windows**：主要验证平台，完整能力可用
- **macOS / Linux**：代码层面跨平台（Electron 与原生 API 均跨平台）；个别窗口选项（如 `skipTaskbar`、`thickFrame`）仅对 Windows 有意义，macOS 会忽略，不影响功能。macOS 实机验证待做

## 🚀 打包发布

- **Windows**：`npm run dist:win` 本地构建，产物 `dist/极简待办-Setup-<version>.exe`（NSIS 安装向导，带品牌侧边图、可选安装目录、创建桌面快捷方式；侧边图源文件 `build/installerSidebar.bmp`，可用 `npx electron scripts/render-installer-assets.cjs` 重新生成）
- **macOS**：`.dmg` 只能在 macOS 上构建。两种方式：
    - 在 Mac 上执行 `npm run dist:mac`（产出 Apple Silicon + Intel 双架构）
    - 推送 `v*` 标签或手动触发 GitHub Actions 工作流 `.github/workflows/release.yml`，云端构建 Windows / macOS 安装包，并自动创建 GitHub Release 挂载全部产物
- 国内网络构建时若工具链下载超时，设置镜像：
  `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`

## 📐 开发规范

- 代码风格由 ESLint + Prettier 强约束（4 空格缩进、单引号、分号），`.editorconfig` 统一编辑器行为
- 提交前执行 `npm run check`，确保 lint、格式、模块引用三项全绿
- 提交信息使用中文，格式 `feat: xxx` / `fix: xxx` / `chore: xxx`

## 🗺️ Roadmap

- [ ] 接入真实用户体系（用户接口已就绪，替换 `src/scripts/user/` 工厂实现）
- [ ] 基于用户体系接入云同步（数据模型已预留 `user_id` / `updated_at`）
- [ ] macOS 实机验证（安装包可由 CI 构建）

## 🤝 参与贡献

欢迎提交 [Issue](https://github.com/handsometaoa/minimal-todo/issues) 反馈问题或提出建议；贡献代码请 Fork 仓库后提交 Pull Request，并遵循[开发规范](#-开发规范)。

## 📄 开源协议

本项目基于 [MIT License](https://opensource.org/licenses/MIT) 开源，**个人使用完全免费**，可自由使用、学习、修改与分发。
