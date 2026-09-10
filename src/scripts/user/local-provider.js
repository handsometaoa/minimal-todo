// 用户接口 · 默认实现（本地用户）
//
// 数据来源为主进程 SQLite 的 users / memberships 表（electron/database.cjs），
// 首次读取后缓存；后续对接真实用户（远程账号体系）时按同一契约替换为远程实现。
//
// 契约（全异步，见 index.js）：
//   getProfile()          → { id, nickname, avatar, type } | null
//   getMembershipStatus() → { active, isPermanent, expiresAt, planId } | null
//   updateProfile(patch)  → profile | null
//   login(credentials)    → { ok, reason? }
//   logout()              → { ok, reason? }

import { host } from '../core.js';

export function createLocalUserProvider() {
    let cache = null;

    async function loadOnce() {
        if (cache) return cache;
        try {
            if (host?.db?.bootstrap) {
                const snapshot = await host.db.bootstrap();
                cache = { user: snapshot?.user || null, membership: snapshot?.membership || null };
            }
        } catch (error) {
            console.error('[user] 读取本地用户信息失败:', error);
        }
        cache = cache || { user: null, membership: null };
        return cache;
    }

    return {
        async getProfile() {
            return (await loadOnce()).user;
        },

        async getMembershipStatus() {
            return (await loadOnce()).membership;
        },

        async updateProfile(patch) {
            await loadOnce();
            let updated = null;
            try {
                if (host?.db?.updateUserProfile) {
                    updated = await host.db.updateUserProfile(patch || {});
                }
            } catch (error) {
                console.error('[user] 更新本地用户信息失败:', error);
                return null;
            }
            if (updated) cache.user = updated;
            return updated;
        },

        // 本地账号无需登录/登出；真实用户体系接入后由远程实现提供
        async login() {
            return { ok: false, reason: 'not_available' };
        },

        async logout() {
            return { ok: false, reason: 'not_available' };
        }
    };
}
