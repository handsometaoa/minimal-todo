# 极简待办 · 数据存储与用户接口文档

> 版本：v2（SQLite + Repository + 用户接口）　更新日期：2026-09-10
> 适用范围：Electron 桌面客户端（Windows / macOS）

## 1. 架构总览

```
渲染层业务代码 ──┬─→ storage 仓库层 ──→ host.db (IPC invoke) ──→ 主进程 SQLite (better-sqlite3)
                └─→ user 用户接口 ───→ host.db (IPC invoke) ──→ 主进程 SQLite (users/memberships)

浏览器兜底（无 Electron 宿主时）：storage 仓库层 → localStorage 快照
```

设计目标：

1. **本地优先**：所有数据落盘主进程 `userData/app-data/minimal-todo.db`，零后端依赖。
2. **操作级持久化**：每个用户操作（增删改/完成/恢复/排序）立即写库，内存状态始终是 UI 的事实来源；
   写入失败通过统一错误通道 toast 提示，不影响界面响应。
3. **可替换用户体系**：用户与会员经 `src/scripts/user/` 接口访问，当前为本地默认实现，
   后续对接真实用户（远程账号）只需替换工厂返回的实现。

## 2. SQLite 数据模型（schemaVersion = 1）

库文件：`userData/app-data/minimal-todo.db`（WAL 模式，外键开启）。
schema 与迁移框架在 `electron/database.cjs`，`meta.schemaVersion` 驱动版本升级。

```sql
meta(key, value)                          -- schemaVersion / currentUserId / 迁移标记等

users(id TEXT PK, nickname, avatar, type DEFAULT 'local', created_at, updated_at)
memberships(user_id PK → users, active, is_permanent, expires_at, plan_id, updated_at)

todos(id TEXT PK, user_id → users, text,
      status TEXT CHECK (status IN ('active','completed')),
      due_at, reminded_at, completed_at,      -- 到期/已提醒/完成时间（ms 时间戳）
      sort_order, deleted, created_at, updated_at)

settings(user_id PK → users, appearance_mode, theme_mode, preset_theme_id,
         custom_primary, custom_secondary, due_presets JSON, updated_at)
```

要点：

- 原「todos / completed 双列表」建模为单表 `status` 字段；展示顺序：
  active 按 `sort_order ASC`（拖拽排序时全量重排为 0..n-1，新增/恢复取 `MIN(sort_order)-1` 置顶），
  completed 按 `completed_at DESC`。
- `deleted`（软删除）本期仅建模预留，删除均为硬删。
- 建库种子数据：默认用户 `local`（昵称「本地用户」）+ 会员行（`active=1, plan_id='trial_month'`，
  即 **SVIP 限时体验全开**）。
- 渲染层内存对象为 camelCase（`id/text/createdAt/dueAt/remindedAt/completedAt`），
  行 ↔ 对象映射由 `electron/database.cjs` 负责，渲染层无感知。

## 3. 渲染层仓库接口（src/scripts/storage/）

`getRepositories()` 返回页面级单例，所有方法异步：

| 方法                              | 说明                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `bootstrap()`                     | 首屏一次拉全量：`{ userId, user, membership, todos, completed, settings, dock }` |
| `todos.create(todo)`              | 新增进行中待办（列表最前）                                                       |
| `todos.update(todo)`              | 整对象更新（内存对象为完整事实来源）                                             |
| `todos.complete(id, at)`          | 标记完成                                                                         |
| `todos.restore(id)`               | 恢复为未完成（清到期/提醒/完成标记，回到最前）                                   |
| `todos.remove(id)`                | 删除（硬删）                                                                     |
| `todos.reorder(orderedIds)`       | 拖拽排序全量重排                                                                 |
| `todos.bulkReplace(payload)`      | 事务全量替换（导入 / 迁移）                                                      |
| `clearExpiredCompleted(beforeTs)` | 清理过期已完成历史，返回 `{ removed }`                                           |
| `saveSettings(settings)`          | 保存主题 / 外观 / 快捷提醒时间                                                   |

后端实现：

- **SqliteBackend**（Electron）：`window.sidebarHost.db.*`（preload 对 `ipcRenderer.invoke` 的封装，
  通道清单见 `electron/preload.cjs` 的 `DB_HANDLERS`）。
- **LocalBackend**（纯浏览器兜底）：localStorage 快照键 `minimal-todo/local-backend`，操作语义与 SQLite 对齐。

失败处理：业务代码经 `core.js` 的 `persist(promise, errorMessage)` 调用——fire-and-forget，
失败走 `setSaveErrorHandler` 注册的 toast 通道，不阻塞 UI。

**设备级设置**（窗口停靠、开机自启偏好等）存于 `meta` 表 `device.*` 键，
渲染层经 `host.db.getDeviceSettings() / setDeviceSetting()` 读写；
主进程启动时直接读库恢复上次贴边停靠位置（显示器 + 左右侧）。

`device.dock`（`{ displayId, side }`）是停靠配置的唯一事实来源：主进程启动定位与渲染层
`bootstrap()` 快照下发、设置页写入均消费/更新同一份，渲染层不读旧 localStorage 值，
避免窗口位置与设置页显示分叉。

## 4. 用户接口（src/scripts/user/）

```js
import { getUserProvider } from './user/index.js';

const provider = getUserProvider();
await provider.getProfile(); // { id, nickname, avatar, type } | null
await provider.getMembershipStatus(); // { active, isPermanent, expiresAt, planId } | null
await provider.updateProfile(patch); // profile | null
await provider.login(credentials); // { ok: false, reason: 'not_available' }（默认实现未开放）
await provider.logout(); // { ok: false, reason: 'not_available' }
```

- 默认实现 `LocalUserProvider`（`user/local-provider.js`）：读写 SQLite `users` / `memberships`，
  首次读取后缓存；`login/logout` 返回 `not_available`。
- 会员策略：默认实现下 **SVIP 限时体验全开**（与历史体验一致）；SVIP 门禁逻辑
  （窗口停靠、界面设置、导入导出、清理历史）保持不变。
- **接入真实用户**：在 `user/index.js` 工厂替换为远程实现（如 `RemoteUserProvider`，REST + token），
  业务代码（`main.js` / `membership-actions.js` / `ui.js`）无需改动。

## 5. 历史数据迁移（自动，仅一次）

| 来源                                                                                  | 时机                                | 行为                                                                      |
| ------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------- |
| 旧 JSON 文档存储 `userData/storage/todo__data.json`、`todo__setting.json`             | 主进程首次建库（schemaVersion 0→1） | 待办与设置导入新表；旧 `storage/` 目录改名备份为 `storage-legacy-backup/` |
| localStorage 视图/停靠设置（`todo/ui-local-settings`、`todo/sidebar-local-settings`） | 不迁移                              | 属设备态，继续存 localStorage                                             |

导入/导出 JSON 格式不变（`{exportedAt, schemaVersion, meta, data}`），旧导出文件仍可导入。

## 6. 打包与开发注意事项

- `better-sqlite3` 为原生模块：安装依赖后由 `postinstall`（`electron-rebuild -f -w better-sqlite3`）
  对齐 Electron ABI；`package.json` 的 `build.asarUnpack` 已配置 `node_modules/better-sqlite3/**`。
- 若官方 prebuilt 缺失（版本组合较新/较旧时可能发生），需本地编译：Windows 需 VS Build Tools，
  macOS 需 Xcode CLT；也可降级/升级 better-sqlite3 至有对应 Electron ABI 预编译的版本。
- 独立验证数据库：`ELECTRON_RUN_AS_NODE=1 npx electron scripts/verify-db.cjs`
  （覆盖建库、种子数据、DAO、旧数据迁移与重启持久化）。
