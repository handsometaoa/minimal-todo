import { state, normalizeMembershipStatus } from './core.js';
import { getUserProvider } from './user/index.js';
import { showToast } from './ui.js';

// 会员状态统一经用户接口获取（当前为本地默认实现：SVIP 限时体验）
export async function refreshMembershipStatus() {
    const status = await getUserProvider().getMembershipStatus();
    state.data.membership = normalizeMembershipStatus(status);
    return state.data.membership;
}

export async function purchaseMembership() {
    showToast('SVIP 限时体验中，暂不开放套餐购买', 'error');
}
