// 生成安装器视觉资源（需在完整 Electron 环境运行，非 ELECTRON_RUN_AS_NODE）：
//   npx electron scripts/render-installer-assets.cjs
// 产物（均在 build/ 下）：
//   installerSidebar.bmp         164x314 24位位图（向导式安装的侧边图）
//   installerHeader.bmp          150x57  24位位图（一键安装进度窗的头部横幅）
//   *.preview.png                同设计的 PNG 预览（仅供人眼检查，不参与打包）
//
// 为什么用位图：NSIS 的图只接受 BMP；用 HTML+CSS 设计再离屏截图，
// 可以得到现代的渐变/发光效果而不是老式纯色图。
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const projectRoot = path.join(__dirname, '..');
const logoUrl = pathToFileURL(path.join(projectRoot, 'public', 'logo.png')).href;

// 两套位图规格：sidebar 用于「向导式」安装，header 用于「一键安装」进度窗
const SPECS = [
    { width: 164, height: 314, name: 'installerSidebar', kind: 'sidebar' },
    { width: 150, height: 57, name: 'installerHeader', kind: 'header' }
];

function sidebarHtml(width, height) {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${width}px; height: ${height}px; overflow: hidden; }
  body {
    font-family: 'Microsoft YaHei', 'Segoe UI', sans-serif;
    background: linear-gradient(168deg, #10151f 0%, #131a29 46%, #1a2440 100%);
    color: #f2f6ff;
    position: relative;
  }
  /* 顶部主色光晕 */
  .glow {
    position: absolute; top: -70px; left: 50%; transform: translateX(-50%);
    width: 240px; height: 240px; border-radius: 50%;
    background: radial-gradient(circle, rgba(72, 118, 255, 0.42) 0%, rgba(72, 118, 255, 0) 68%);
  }
  /* 细网格纹理，增加质感 */
  .grid {
    position: absolute; inset: 0; opacity: 0.05;
    background-image:
      linear-gradient(rgba(255,255,255,.85) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,.85) 1px, transparent 1px);
    background-size: 22px 22px;
    -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,.9), rgba(0,0,0,0) 62%);
  }
  .wrap { position: relative; height: 100%; display: flex; flex-direction: column; align-items: center; padding: 46px 14px 20px; }
  .logo {
    width: 58px; height: 58px; border-radius: 17px; overflow: hidden;
    box-shadow: 0 10px 26px rgba(64, 108, 255, 0.45), 0 0 0 1px rgba(255,255,255,0.14);
  }
  .logo img { width: 100%; height: 100%; display: block; }
  h1 { margin-top: 14px; font-size: 17px; letter-spacing: 0.06em; font-weight: 700; }
  .en { margin-top: 3px; font-size: 8.5px; letter-spacing: 0.3em; color: rgba(226, 235, 255, 0.5); font-weight: 600; }
  .line { width: 26px; height: 2px; border-radius: 2px; margin: 16px auto 14px;
          background: linear-gradient(90deg, #4d7dff, #35c8dd); }
  ul { list-style: none; width: 100%; display: flex; flex-direction: column; gap: 12px; }
  li { display: flex; align-items: center; gap: 8px; font-size: 10.5px;
       color: rgba(230, 238, 252, 0.86); white-space: nowrap; }
  li .dot { flex: none; width: 5px; height: 5px; border-radius: 50%;
            background: #4d7dff; box-shadow: 0 0 8px rgba(77, 125, 255, 0.9); }
  li b { font-weight: 600; color: #ffffff; }
  .spacer { flex: 1; }
  .foot { font-size: 8.5px; letter-spacing: 0.14em; color: rgba(220, 230, 250, 0.38); }
</style>
</head>
<body>
  <div class="glow"></div>
  <div class="grid"></div>
  <div class="wrap">
    <div class="logo"><img src="${logoUrl}" /></div>
    <h1>极简待办</h1>
    <div class="en">MINIMAL TODO</div>
    <div class="line"></div>
    <ul>
      <li><span class="dot"></span><span><b>贴边常驻</b>，即点即用</span></li>
      <li><span class="dot"></span><span><b>到期提醒</b>，到点弹窗</span></li>
      <li><span class="dot"></span><span><b>数据本地</b>，安全私密</span></li>
      <li><span class="dot"></span><span><b>主题随心</b>，深浅切换</span></li>
    </ul>
    <div class="spacer"></div>
    <div class="foot">WINDOWS 安装向导</div>
  </div>
</body>
</html>`;
}

function headerHtml(width, height) {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${width}px; height: ${height}px; overflow: hidden; }
  body {
    font-family: 'Microsoft YaHei', 'Segoe UI', sans-serif;
    background: linear-gradient(90deg, #10151f 0%, #16203a 70%, #1c2a52 100%);
    color: #f2f6ff; position: relative;
    display: flex; align-items: center; gap: 10px; padding: 0 12px;
  }
  .glow {
    position: absolute; right: -40px; top: -30px;
    width: 140px; height: 120px; border-radius: 50%;
    background: radial-gradient(circle, rgba(72, 118, 255, 0.4) 0%, rgba(72, 118, 255, 0) 70%);
  }
  .logo {
    flex: none; width: 34px; height: 34px; border-radius: 10px; overflow: hidden;
    box-shadow: 0 4px 12px rgba(64, 108, 255, 0.5), 0 0 0 1px rgba(255,255,255,0.16);
  }
  .logo img { width: 100%; height: 100%; display: block; }
  .text { display: flex; flex-direction: column; gap: 2px; }
  h1 { font-size: 14px; letter-spacing: 0.08em; font-weight: 700; }
  .sub { font-size: 7.5px; letter-spacing: 0.26em; color: rgba(226, 235, 255, 0.52); font-weight: 600; }
</style>
</head>
<body>
  <div class="glow"></div>
  <div class="logo"><img src="${logoUrl}" /></div>
  <div class="text">
    <h1>极简待办</h1>
    <div class="sub">MINIMAL TODO</div>
  </div>
</body>
</html>`;
}

function writeBMP(image) {
    const { width, height } = image.getSize();
    const bgra = image.toBitmap();
    const rowSize = Math.ceil((width * 3) / 4) * 4; // BMP 行按 4 字节对齐
    const pixelSize = rowSize * height;
    const buf = Buffer.alloc(54 + pixelSize);
    buf.write('BM', 0);
    buf.writeUInt32LE(buf.length, 2);
    buf.writeUInt32LE(54, 10);
    buf.writeUInt32LE(40, 14);
    buf.writeInt32LE(width, 18);
    buf.writeInt32LE(height, 22);
    buf.writeUInt16LE(1, 26);
    buf.writeUInt16LE(24, 28); // 24 位 BGR
    buf.writeUInt32LE(pixelSize, 34);
    // BMP 自底向上存储；toBitmap() 返回 BGRA 顺序，逐像素取 B/G/R 写入 BGR 行
    for (let y = 0; y < height; y++) {
        const src = (height - 1 - y) * width * 4;
        const dst = 54 + y * rowSize;
        for (let x = 0; x < width; x++) {
            buf[dst + x * 3] = bgra[src + x * 4];
            buf[dst + x * 3 + 1] = bgra[src + x * 4 + 1];
            buf[dst + x * 3 + 2] = bgra[src + x * 4 + 2];
        }
    }
    return buf;
}

async function renderAll() {
    // 复用同一个离屏窗口：连续创建多个离屏 BrowserWindow 在 Windows 上会导航失败（ERR_FAILED）
    const win = new BrowserWindow({
        width: SPECS[0].width,
        height: SPECS[0].height,
        useContentSize: true,
        show: false,
        frame: false,
        webPreferences: { backgroundThrottling: false, offscreen: true }
    });

    for (const spec of SPECS) {
        win.setContentSize(spec.width, spec.height);
        // data: URL 在部分环境下 loadURL 会 ERR_FAILED，落盘为临时文件加载更稳
        const tempHtml = path.join(projectRoot, 'build', '.render-tmp.html');
        const html =
            spec.kind === 'header' ? headerHtml(spec.width, spec.height) : sidebarHtml(spec.width, spec.height);
        fs.writeFileSync(tempHtml, html);
        await win.loadFile(tempHtml);
        await new Promise((r) => setTimeout(r, 500));
        let image = await win.webContents.capturePage();
        const { width, height } = image.getSize();
        if (width !== spec.width || height !== spec.height) {
            image = image.resize({ width: spec.width, height: spec.height });
        }
        const outBmp = path.join(projectRoot, 'build', `${spec.name}.bmp`);
        const outPng = path.join(projectRoot, 'build', `${spec.name}.preview.png`);
        fs.writeFileSync(outBmp, writeBMP(image));
        fs.writeFileSync(outPng, image.toPNG());
        fs.rmSync(tempHtml, { force: true });
        console.log('已生成:', outBmp, `(${fs.statSync(outBmp).size} bytes)`);
    }
    win.destroy();
}

app.whenReady().then(async () => {
    await renderAll();
    app.exit(0);
});
