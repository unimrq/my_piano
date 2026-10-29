import { challengeDate, dailyChallenge } from "./daily";
import Icon, { type IconName } from "./Icon";
import { useEffect, useMemo, useState } from "react";
import { beatToSeconds, type Song, type Library } from "./model";
type Section = "all" | "favorites" | "recent" | "imports" | "daily";
const duration = (song: Song) => {
  const t = Math.round(beatToSeconds(song.duration, song.tempos));
  return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0");
};
const category = (song: Song) =>
  song.category ?? (song.source === "builtin" ? "入门旋律" : "我的曲谱");
export default function LibraryHome({
  library,
  onChoose,
  onFavorite,
  onImport,
  onDevice,
  onHistory,
  onHelp,
  device,
  ready,
}: {
  library: Library;
  onChoose: (s: Song) => void;
  onFavorite: (song: Song) => void;
  onImport: () => void;
  onDevice: () => void;
  onHistory: () => void;
  onHelp: () => void;
  device: string;
  ready: boolean;
}) {
  const [section, setSection] = useState<Section>("all"),
    [query, setQuery] = useState(""),
    [genre, setGenre] = useState("全部"),
    [level, setLevel] = useState("全部难度"),
    [info, setInfo] = useState<Song | null>(null);
  const [day, setDay] = useState(challengeDate);
  useEffect(() => {
    const timer = setInterval(() => setDay(challengeDate()), 60000);
    return () => clearInterval(timer);
  }, []);
  const daily = useMemo(
    () => [0, 1, 2].map((tier) => dailyChallenge(day, tier as 0 | 1 | 2)),
    [day],
  );
  const favorite = new Set(library.favorites ?? []);
  const recent = [
    ...new Set([library.lastSong, ...library.results.map((r) => r.songId)]),
  ];
  const last =
    library.songs.find((s) => s.id === library.lastSong) ?? library.songs[0];
  const songs = useMemo(() => {
    if (section === "daily") return daily;
    let songs = library.songs.filter(
      (s) =>
        (section === "all" ||
          (section === "favorites" && favorite.has(s.id)) ||
          (section === "recent" && recent.includes(s.id)) ||
          (section === "imports" && s.source !== "builtin")) &&
        (genre === "全部" || category(s) === genre) &&
        (level === "全部难度" || s.difficulty === level) &&
        `${s.title} ${s.composer ?? ""} ${s.focus ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
    return section === "recent"
      ? songs.sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id))
      : songs;
  }, [library, section, query, genre, level, daily]);
  const nav = (id: Section, label: string, icon: IconName, count?: number) => (
    <button
      className={section === id ? "selected" : ""}
      onClick={() => {
        setSection(id);
        setGenre("全部");
      }}
    >
      <Icon name={icon} />
      {label}
      {count !== undefined && <small>{count}</small>}
    </button>
  );
  return (
    <div className="library-home">
      <nav className="library-nav">
        <div className="library-logo">
          <img src="./icon.png" alt="" />
          钢琴练习
        </div>
        <div className="nav-menu">
          {nav("all", "发现曲目", "grid")}
          {nav("favorites", "我的收藏", "heart", favorite.size)}
          {nav("daily", "每日视奏", "daily")}
          {nav("recent", "最近练习", "clock")}
          {nav("imports", "我的导入", "import")}
        </div>
        <button className="nav-history" onClick={onHistory}>
          练习记录
        </button>
        <div className="nav-bottom">
          <button className="home-device" onClick={onDevice}>
            <span className="home-device-icon">
              <Icon name="piano" />
            </span>
            <span className="home-device-name">
              <strong>{device || "连接钢琴"}</strong>
              <small className={device ? "online" : ""}>
                {device ? "已连接" : "未连接"}
              </small>
            </span>
          </button>
          <button className="nav-help" onClick={onHelp}>
            使用帮助
          </button>
        </div>
      </nav>
      <div className="library-content">
        <div className="library-topbar">
          <label className="search-box">
            <Icon name="search" />
            <input
              aria-label="搜索曲库"
              placeholder="搜索曲名或作者"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button aria-label="清除搜索" onClick={() => setQuery("")}>
                <Icon name="close" />
              </button>
            )}
          </label>
          <button
            className="import-button"
            onClick={onImport}
            disabled={!ready}
          >
            导入曲谱
          </button>
        </div>
        <div className="library-scroll">
          <div className="library-title">
            <h1>
              {
                {
                  all: "曲库",
                  favorites: "我的收藏",
                  recent: "最近练习",
                  imports: "我的导入",
                  daily: "每日视奏",
                }[section]
              }
            </h1>
            <span>
              {section === "daily"
                ? `${day} · 北京时间`
                : ready
                  ? `${library.songs.length} 首本地曲目`
                  : "正在整理曲库…"}
            </span>
          </div>
          {section === "all" && !query && (
            <div className="library-featured">
              <div className="featured-continue">
                <span className="section-kicker">继续练习</span>
                <h2>{last.title}</h2>
                <p>
                  {last.composer ?? "传统旋律"}
                  <span>·</span>
                  {last.difficulty ?? "自选曲目"}
                </p>
                <button
                  className="primary"
                  onClick={() => onChoose(last)}
                  disabled={!ready}
                >
                  进入练习
                </button>
              </div>
            </div>
          )}
          {section !== "daily" && (
            <div className="library-filters">
              <div className="genre-tabs">
                {["全部", ...new Set(library.songs.map(category))].map((g) => (
                  <button
                    key={g}
                    className={genre === g ? "active" : ""}
                    onClick={() => setGenre(g)}
                  >
                    {g}
                  </button>
                ))}
              </div>
              <select
                aria-label="曲库难度"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
              >
                {["全部难度", "入门", "初级", "中级"].map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </div>
          )}
          <div className="catalogue-count">
            {songs.length} 首{query && ` · “${query}”`}
          </div>
          <div className="catalogue-grid">
            {(ready ? songs : []).map((s) => {
              const results = library.results.filter((r) => r.songId === s.id);
              const best = results.length
                ? Math.max(...results.map((r) => r.accuracy))
                : null;
              return (
                <article
                  key={s.id}
                  onClick={(event) => {
                    if (!(event.target as Element).closest("button"))
                      onChoose(s);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setInfo(s);
                  }}
                  className={`music-card category-${s.category === "古典" ? "classic" : s.category === "基本功" ? "study" : "folk"}`}
                >
                  <div className="card-art">
                    <button
                      aria-label={`收藏 ${s.title}`}
                      className={
                        favorite.has(s.id) ? "favorite active" : "favorite"
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        onFavorite(s);
                      }}
                    >
                      <Icon name="heart" />
                    </button>
                  </div>
                  <div className="card-body">
                    <div className="card-title">
                      <button onClick={() => onChoose(s)}>{s.title}</button>
                    </div>
                    <p>{s.composer ?? "传统旋律"}</p>
                    <div className="card-meta">
                      <span className={`level level-${s.difficulty ?? "初级"}`}>
                        {s.difficulty ?? "自选"}
                      </span>
                      <span>{s.measures.length} 小节</span>
                      <span>{duration(s)}</span>
                      {s.warning?.startsWith("自动转谱") && <span>自动转谱</span>}
                      {best !== null && (
                        <span className="card-best">最佳 {best}%</span>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          {songs.length === 0 && (
            <div className="library-empty">
              <h2>
                {section === "favorites" ? "还没有收藏" : "没有匹配的曲目"}
              </h2>
              <p>
                {section === "favorites"
                  ? "点击曲目右上角的爱心收藏。"
                  : "调整搜索和筛选，或导入自己的曲谱。"}
              </p>
              <button
                onClick={() => {
                  setQuery("");
                  setGenre("全部");
                  setLevel("全部难度");
                }}
              >
                重置筛选
              </button>
            </div>
          )}
        </div>
      </div>
      {info && (
        <div className="modal-backdrop">
          <div className="modal score-info">
            <div className="panel-heading">
              <h2>{info.title}</h2>
              <button onClick={() => setInfo(null)}>
                <Icon name="close" />
              </button>
            </div>
            <p>{info.focus ?? "旋律与节奏练习"}</p>
            <dl>
              <dt>版本</dt>
              <dd>
                {info.edition ??
                  (info.source === "builtin" ? "自制入门编配" : "用户导入曲谱")}
              </dd>
              <dt>来源与署名</dt>
              <dd>{info.sourceInfo ?? "用户自行导入"}</dd>
              <dt>授权</dt>
              <dd>
                {info.license ??
                  (info.source === "builtin"
                    ? "公版旋律 / 自制简易编配"
                    : "请遵循原曲谱授权")}
              </dd>
            </dl>
            {info.sourceUrl && <p className="source-url">{info.sourceUrl}</p>}
            {info.warning && <p className="hint">{info.warning}</p>}
            <div className="actions">
              <button onClick={() => setInfo(null)}>关闭</button>
              <button className="primary" onClick={() => onChoose(info)}>
                开始练习
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
