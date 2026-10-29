# 开源来源

钢琴练习 0.2.0：网页 MIDI 钢琴练习工具，MIT。应用代码许可与曲谱许可分别说明。

参考并改写 Bach to Basics 的 `frontend/src/workers/midi.worker.ts` MIDI 解析流程，包括音符、力度、PPQ 与速度图提取。上游：https://github.com/gigliof/bach-to-basics ，本次核对提交 `8b6db270f36e1be1b9d2a86ebb1f59adeb1e7091`。上游版权为 Copyright (c) 2025-2026 gigliof，完整许可见 LICENSE.upstream。

0.2.0 直接复用上游 FallingNotesRenderer、PianoKeyboard、colorUtils 及共享 MusicData 类型/工具。改动与适配边界见 src/vendor/bach/README.md。五线谱继续复用 OpenSheetMusicDisplay；在现有判定上新增逐音符反馈，不改变起音评分标准，MIDI 接入继续复用。未包含上游在线采样音源、Python 服务或识别模块。

网页运行依赖的许可正文汇总在 LICENSES.third-party.txt。界面使用设备本地系统字体；谱面符号字体由 OpenSheetMusicDisplay/VexFlow 内嵌，无运行时在线字体或 Electron 运行时。

当前内置曲库来自 [Noctave](https://noctavepiano.com/) 已有的入门双手编配：《欢乐颂》《小星星》《摇篮曲》《月光下》《雅克兄弟（两只老虎旋律）》。来源网站将这些曲谱标为 CC0 1.0。逐曲来源页面、压缩 MusicXML 下载地址、版本说明和 SHA-256 校验值见 `public/catalogue/manifest.json`。

原文件按来源字节保存，未自行改写音高、节奏或声部；`scripts/fetch-catalogue.cjs` 只下载并核对校验值。应用使用本地制谱引擎重新排版显示，不保证复现来源网站的视觉版式。公共源码不分发中文流行曲文件。本机个人曲库另有四首原始双手钢琴 MIDI，索引和原文件已排除 Git，不将原歌曲或合集视为 CC0/MIT。个人来源：Chorus Yuen 编配《月亮代表我的心》（Truongca 公开下载）、NGERN／EveryonePiano 12352《刻在我心底的名字》纸谱用于核对（MIDI来自xigaomeicun/MIDI）、AutoPiano《晴天》、callmeyyzx/midi《青花瓷》。原编配者未明的合集保留该事实；原曲权利归原权利人，未取得公开分发授权。

此前 POP909 的 10 首旋律轨自行简化片段已撤下。历史来源为 [Music X Lab / POP909](https://github.com/music-x-lab/POP909-Dataset)，ISMIR 2020，作者 Ziyu Wang, Ke Chen, Junyan Jiang, Yiyi Zhang, Maoran Xu, Shuqi Dai, Guxian Bin, Gus Xia；仓库 MIT 正文仍保留于 `public/licenses/POP909-MIT.txt` 用于追溯，仓库许可不代表原歌曲权利。此前 PianoBooster/Mutopia 和自制示范曲也不属于当前内置曲库，相关历史许可证保留。

每日视奏是本项目确定性算法生成的原创练习，CC0-1.0；不是 POP909 曲目或其他平台挑战题。

自动指法：复用 [PianoPlayer](https://github.com/marcomusy/pianoplayer) 的手部静息几何、手指强度、黑键成本与移动成本思路，适配为浏览器 TypeScript（src/vendor/pianoplayer.ts）。Copyright (c) 2017 Marco Musy，完整 MIT 许可位于 public/licenses/PianoPlayer-MIT.txt，随静态构建提供。此适配使用有界 beam search 对整组和弦搜索并处理仍按住的键，不是上游 Python 引擎的逐行移植，也不宣称与其结果相同。左右手分别求解、保留原谱指法，超出五指或手掌跨度且无法分配的组留空；不依赖 Python、远程 API 或收费模型。
