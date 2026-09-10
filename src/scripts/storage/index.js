// 存储仓库入口：页面级单例，业务代码统一从这里取数据访问接口
// Electron 环境走主进程 SQLite，浏览器兜底走 localStorage 快照（见 repositories.js）

import { createRepositories } from './repositories.js';

let repositoriesInstance = null;

export function getRepositories() {
    if (!repositoriesInstance) {
        repositoriesInstance = createRepositories(window.sidebarHost || null);
    }
    return repositoriesInstance;
}
