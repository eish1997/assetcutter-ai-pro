import { exec } from 'node:child_process';

/** 在本机默认浏览器中打开 URL（仅本机控制台用，不写死业务域名） */
export function openDefaultBrowser(url: string): void {
  const u = url.replace(/"/g, '\\"');
  if (process.platform === 'win32') {
    exec(`cmd /c start "" "${u}"`, { windowsHide: true });
    return;
  }
  if (process.platform === 'darwin') {
    exec(`open "${u}"`);
    return;
  }
  exec(`xdg-open "${u}"`);
}
