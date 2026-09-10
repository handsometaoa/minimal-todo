// 用户接口层：业务代码统一从这里获取用户与会员能力
//
// 契约（全异步，为后续接入真实用户体系预留）：
//   getProfile()          → { id, nickname, avatar, type } | null
//   getMembershipStatus() → { active, isPermanent, expiresAt, planId } | null
//   updateProfile(patch)  → profile | null
//   login(credentials)    → { ok, reason? }
//   logout()              → { ok, reason? }
//
// 当前默认实现为「本地用户」（数据存主进程 SQLite）；
// 未来对接真实用户时，仅需在此工厂切换为远程实现，业务代码不动。

import { createLocalUserProvider } from './local-provider.js';

let providerInstance = null;

export function getUserProvider() {
    if (!providerInstance) {
        providerInstance = createLocalUserProvider();
    }
    return providerInstance;
}
