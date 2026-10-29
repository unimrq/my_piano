# 钢琴练习

中文网页钢琴练习工具。连接 USB MIDI 钢琴，跟着五线谱和下落音符练习；导入、收藏、设置与练习记录均保存在当前浏览器，无账号或服务器数据库。

## 启动

需要 Node.js 22.12 或以上版本。

```sh
git clone https://github.com/unimrq/my_piano.git
cd my_piano
npm ci
npm run build
npm run web
```

在电脑 Chrome / Edge 打开 <http://localhost:4173/>。Windows 也可在安装依赖后双击 `启动网页版.cmd`。开发时运行 `npm run dev`，使用命令输出的地址。

远程和 iPad 使用请部署 HTTPS 静态站点，详见 [部署说明](docs/部署说明.md)。构建产物是完整的 `dist/`，不需要后端、数据库或常驻 Node.js。

## 连接与练习

1. 钢琴开机，用数据线连接当前浏览设备。FP-30X 使用琴背面的 **USB Computer**，USB-C 电脑或 iPad 可用 USB-C 转 USB-B 数据线。
2. 打开设备设置，点击“连接钢琴”并允许浏览器访问 MIDI，选择输入与输出。
3. 点击曲目卡片开始。初学建议双手或先分手，使用“自由跟弹”：弹对当前音或和弦后立即进入下一组，不必追赶时钟。重复音须松开重弹，和弦目标键需同时按住，允许慢慢找键。
4. 熟悉后切换“节奏模式”，倒数一小节后按固定速度弹奏。顶栏滑条调速；重复工具可直接在谱面拖选起止小节，反复练习。

五线谱上下完整适配可用高度。整块谱面可拖拽，滚轮横向浏览，单击可定位开始线；练习区域高度和最少显示白键数可在设置中调整。支持平板横竖屏、触摸操作和浏览器全屏；浏览器未提供网页全屏接口时，使用浏览器自己的全屏菜单。

自由跟弹不自动播放其他声部，即使旧设置曾开启伴奏也一样。自己的琴声由钢琴发出，网页不重复回放输入。完整示范、节奏模式手动开启的伴奏通过 MIDI 输出到钢琴；节拍器由当前设备发声。断线或切到后台会暂停，返回后由用户继续。

节奏模式默认以起音前后 150 毫秒判定，谱面标记正确、错音、漏音与早晚偏差。按键时值不足只提示，不扣起音分；力度和踏板不评分。结束后可查看问题小节与记录。每日视奏提供三档离线生成的原创练习。

## 曲库与导入

公共曲库包含 5 首 Noctave CC0 入门双手谱：《欢乐颂》《小星星》《摇篮曲》《月光下》《雅克兄弟（两只老虎旋律）》。保留来源 MusicXML 原文件，逐曲来源及 SHA-256 见 [曲库索引](public/catalogue/manifest.json)。

“导入曲谱”支持 `.mid`、`.midi`、`.xml`、`.musicxml` 和 `.mxl`，确认声部分配后才加入本地曲库。优先使用合法获取的 MusicXML/MXL，可以保留原谱的音高、节奏、谱号、调号和指法；显示由本地引擎重新排版。

MIDI 显示为“自动转谱”：按十六分音符量化，保留完整八分三连音，练习使用原始演奏时间，不保证还原出版谱或自动推断可靠指法。复杂总谱建议先提取钢琴声部。反复、房子、D.C./D.S./Coda 保留显示，判定按书写顺序进行，不自动展开；需要反复可用 A/B 循环。装饰音仅显示，移调声部请先导出实音谱。不支持 PDF、图片或音频转谱。

本机个人流行曲索引 `src/personal-catalogue.json` 和 `public/catalogue/personal-*.mid` 已排除 Git，克隆此仓库不会获得这些文件。可在网页内导入自己的曲谱，导入文件不会上传服务器。应用 MIT 许可不代表曲目或编配许可，详见 [来源说明](NOTICE.md)。

## 浏览器与本地数据

Web MIDI 需要受支持的浏览器，以及 HTTPS 或本机 localhost 安全上下文；普通局域网 HTTP 不能保证连接 MIDI。[MDN 接口说明](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/requestMIDIAccess)

iPad Safari 当前不提供原生 Web MIDI。iPad 可用 MIDIWeb Browser 的 MIDI 桥接尝试连接，仍需实际设备验证 MIDI、节拍器、全屏与休眠恢复；平板视口自动测试不等于 iPad 真机测试。[浏览器兼容数据](https://github.com/mdn/browser-compat-data/blob/main/api/Navigator.json)

曲库、设置和最近 1000 次记录保存在浏览器 IndexedDB，不跨设备同步。同一设备更换浏览器、域名、协议或端口会使用独立数据；清除站点数据可能删除记录。当前没有完整数据导出入口，请保留导入的原谱，并避免清除使用中的站点数据。旧曲库迁移前会在 IndexedDB 保留 `before-scores` 备份。

HTTPS / localhost 首次完整缓存后可离线重载。首次访问仍需能连接站点；离线缓存和个人曲库是两套存储，部署更新不需要清空个人数据。更新步骤见 [部署说明](docs/部署说明.md#更新与离线缓存)。

## 开发与检查

```sh
npm test
npm run build
npm run web
```

保持网页服务运行，在另一个终端执行浏览器检查：

```sh
npx playwright install chromium webkit
npm run test:web
npm run test:toolbar
```

浏览器检查使用 Chromium / WebKit 和模拟 MIDI；真实 FP-30X 发声、持续练习和 iPad 兼容性需另行试弹。验证边界见 [验证报告](docs/验证报告.md)。

应用使用 React、TypeScript、PixiJS 与 OpenSheetMusicDisplay，复用 Bach to Basics 的渲染和 MIDI 相关代码，无 Python 服务和远程转换 API。输入、解析和判定独立于界面；第三方许可见 [NOTICE.md](NOTICE.md)、[LICENSE.upstream](LICENSE.upstream) 和 [LICENSES.third-party.txt](LICENSES.third-party.txt)。
