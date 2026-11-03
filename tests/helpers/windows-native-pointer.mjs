import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// One Win32 input driver for the packaged-app test. It moves the actual OS
// cursor without activating the window; CDP still sends the button events.
export function windowsNativePointer() {
  const script = `
    Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class PicLiteTestPointer { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); }';
    while ($null -ne ($line = [Console]::ReadLine())) {
      $point = $line.Split(',');
      if ([PicLiteTestPointer]::SetCursorPos([int]$point[0], [int]$point[1])) { [Console]::WriteLine('ok') }
      else { [Console]::WriteLine('SetCursorPos failed') }
    }
  `;
  const driver = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = [];
  let failure = '';
  driver.stderr.on('data', chunk => { failure += chunk; });
  createInterface({ input: driver.stdout }).on('line', line => {
    const request = pending.shift();
    if (!request) return;
    clearTimeout(request.timer);
    if (line === 'ok') request.resolve();
    else request.reject(Error(line + failure));
  });
  driver.on('error', error => { failure += error; });
  return {
    move: async (point, evaluate) => {
      const geometry = await evaluate(`(async()=>{const invoke=window.__TAURI_INTERNALS__.invoke;
        const [position,scale]=await Promise.all([invoke('plugin:window|inner_position'),invoke('plugin:window|scale_factor')]);
        return {x:position.x,y:position.y,scale};})()`);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Native mouse move timed out: ' + failure)), 15000);
        pending.push({ resolve, reject, timer });
        driver.stdin.write(`${Math.round(geometry.x + point.x * geometry.scale)},${Math.round(geometry.y + point.y * geometry.scale)}\n`);
      });
    },
    close: () => {
      driver.stdin.end();
      for (const request of pending.splice(0)) {
        clearTimeout(request.timer);
        request.reject(Error('Native pointer driver closed'));
      }
      driver.kill();
    },
  };
}
