/** User-facing store errors. Never surface backend exception text or raw error codes. */
export function storeFailureMessage(code: string, zh: boolean, retryAfterMs?: number): string {
  if (code === 'rate_limited') {
    if (retryAfterMs === undefined) return zh ? '尝试次数过多，请稍后再试' : 'Too many attempts. Try again later';
    const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    return zh ? `尝试次数过多，请 ${seconds} 秒后再试` : `Too many attempts. Try again in ${seconds} seconds`;
  }
  const messages: Record<string, [string, string]> = {
    wrong_password: ['密码不正确，请重新输入', 'Incorrect password. Try again'],
    needs_password: ['请输入密码以继续', 'Enter the password to continue'],
    current_password_required: ['请输入当前密码', 'Enter the current password'],
    must_change_master_password: ['请先更换主密码，再导出备份', 'Change the master password before exporting a backup'],
    locked: ['请先解锁，再重试', 'Unlock first, then try again'],
    unauthorized: ['应用已锁定，请解锁后重试', 'The app is locked. Unlock it and try again'],
    unavailable: ['此功能暂时不可用，请重启应用后重试', 'This feature is unavailable. Restart the app and try again'],
    not_configured: ['存储尚未就绪，请稍后重试', 'Storage is not ready. Try again shortly'],
    not_found: ['所选项目已不存在，请重新选择', 'The selected item no longer exists. Select it again'],
    invalid_argument: ['输入无效，请检查后重试', 'Check the input and try again'],
    corrupt: ['备份文件已损坏，请选择另一份备份', 'The backup is damaged. Choose another backup'],
    io: ['无法读写文件，请检查文件位置和访问权限', 'Cannot read or write the file. Check its location and access permissions'],
    busy: ['另一个操作正在进行，请稍后重试', 'Another operation is in progress. Try again shortly'],
    rotation_pending: ['密码更新尚未完成，请稍后重试', 'The password update is still in progress. Try again shortly'],
    file_too_large: ['文件太大，请选择较小的文件', 'The file is too large. Choose a smaller file'],
    cancelled: ['', ''],
  };
  return messages[code]?.[zh ? 0 : 1] ?? (zh ? '操作未完成，请重试' : 'The operation could not be completed. Try again');
}
