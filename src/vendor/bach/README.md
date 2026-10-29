# Bach to Basics 渲染组件

上游：https://github.com/gigliof/bach-to-basics ，提交 `8b6db270f36e1be1b9d2a86ebb1f59adeb1e7091`，MIT（完整许可证见项目根目录 LICENSE.upstream）。

直接复用 FallingNotesRenderer、PianoKeyboard、colorUtils 及共享 MusicData。只调整本地 import 路径，抽取所需类型；PianoKeyboard 的 inputNoteOn 增加可选错音颜色参数，供现有判定模块调用。本轮按用户反馈，将 PianoKeyboard.paintKey 改为干净的黑白键面、纯色待弹高亮（保留黑键独立上层）并提供 setTargets；FallingNotesRenderer 改用清晰的单色双手音符，并在释放端留出视觉间隔区分连续同音，适配层关闭旧 ghost 覆盖提示以避免异色叠加；键位布局、交互、下落动画及对象池继续复用。键高由适配层随可用空间调整，音区裁切也由适配层处理。

Roll.tsx 仅转换数据并连接生命周期、尺寸和按键状态。通过 PixiJS 官方 `unsafe-eval` 兼容模块使用无需动态 eval 的实现，页面 CSP 没有增加 unsafe-eval。

琴键保留独立的黑键上层，增加白键前沿、黑键倒角与轻投影，按压位移为 2px；双行标签分别居中。示范亮键接入上游已有的 playback NoteOn/NoteOff 状态，未伪造 MIDI 输入或练习成绩。触键动画复用原有 ImpactFlash 和粒子数组，由真实输入或示范起音触发；接触期间按帧累积生成彩色碎片，总量受限。音条复用渐变缓存增加纵向层次，未来音符不提前发光。

上游 SyncEngine/AccuracyTracker 与在线音源、全局 Tone Transport 耦合，其等待逻辑按单个 noteIndex 放行，和弦及 150ms 判定不适合直接替换已验证模块。Trainer 上新增可视反馈及起始拍点，原有起音评分标准保持；MIDI 接入不变。Sightread 也作了源码比较（GPL-3.0），未复制其代码或曲目。
