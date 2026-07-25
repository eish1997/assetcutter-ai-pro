import React from 'react';
import { PERMISSIONS } from '../../services/adminPermissions';
import { navigateAdmin } from '../../services/adminNavigate';
import { useAdminStaff } from './AdminStaffContext';
import AdminStaffInvitesPanel from './AdminStaffInvitesPanel';
import AdminRegistrationInvitesPanel from './AdminRegistrationInvitesPanel';

type InviteTab = 'staff' | 'registration';

function readTabFromUrl(canStaff: boolean, canRegistration: boolean): InviteTab {
  if (typeof window === 'undefined') {
    return canStaff ? 'staff' : 'registration';
  }
  const pathname = window.location.pathname;
  if (pathname.endsWith('/registration-invites') && canRegistration) return 'registration';
  if (pathname.endsWith('/staff-invites') && canStaff) return 'staff';
  const raw = new URLSearchParams(window.location.search).get('tab')?.trim();
  if (raw === 'registration' && canRegistration) return 'registration';
  if (raw === 'staff' && canStaff) return 'staff';
  if (canStaff) return 'staff';
  return 'registration';
}

const AdminInvitesPanel: React.FC = () => {
  const { can } = useAdminStaff();
  const canStaff = can(PERMISSIONS.USERS_ROLE_WRITE);
  const canRegistration = can(PERMISSIONS.REGISTRATION_INVITES_WRITE);
  const [tab, setTab] = React.useState<InviteTab>(() => readTabFromUrl(canStaff, canRegistration));

  React.useEffect(() => {
    setTab(readTabFromUrl(canStaff, canRegistration));
  }, [canStaff, canRegistration]);

  const selectTab = (next: InviteTab) => {
    setTab(next);
    navigateAdmin(`/admin/invites?tab=${next}`);
  };

  if (!canStaff && !canRegistration) {
    return (
      <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-8 max-w-lg">
        <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-gray-300">无权限</h2>
        <p className="mt-2 text-[11px] text-gray-500 leading-relaxed">当前角色无权管理邀请。</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-gray-300">邀请</h2>
        <p className="mt-1 text-[10px] text-gray-600">
          后台成员邀请与普通用户注册邀请码分 Tab 管理；API 与权限仍彼此独立。
        </p>
      </div>

      <div className="flex gap-2">
        {canStaff ? (
          <button
            type="button"
            onClick={() => selectTab('staff')}
            className={`px-3 py-1.5 rounded-lg text-[11px] ${
              tab === 'staff' ? 'bg-white/15 text-white' : 'bg-white/5 text-gray-400 hover:text-gray-200'
            }`}
          >
            后台成员
          </button>
        ) : null}
        {canRegistration ? (
          <button
            type="button"
            onClick={() => selectTab('registration')}
            className={`px-3 py-1.5 rounded-lg text-[11px] ${
              tab === 'registration'
                ? 'bg-white/15 text-white'
                : 'bg-white/5 text-gray-400 hover:text-gray-200'
            }`}
          >
            用户注册
          </button>
        ) : null}
      </div>

      {tab === 'staff' && canStaff ? <AdminStaffInvitesPanel embedded /> : null}
      {tab === 'registration' && canRegistration ? <AdminRegistrationInvitesPanel embedded /> : null}
    </div>
  );
};

export default AdminInvitesPanel;
