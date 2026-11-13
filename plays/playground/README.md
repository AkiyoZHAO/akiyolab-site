# Playground v1

工程入口为 `index.html`、`playground.js`、`playground.css`，首页通过 `plays.json` 的 `play:playground` anchor 进入。沿用全站 tokens、Owner Auth 和 Cloudflare Worker Static Assets。

内容由 Dot 负责。页面按已发布 JSON 渲染，浏览与反馈无需写入公开 events。

## 每日发布契约 v1

`index.json` 保存 `schema_version: 1`、`timezone: "Asia/Shanghai"`、`dates: ["YYYY-MM-DD"]`。日期指本地发行日。浏览器默认打开上海当天或之前最近一期，旧期明确显示原日期。`?date=YYYY-MM-DD` 提供稳定期刊链接。未来日期在发行日前隐藏于导航，静态文件本身仍公开可访问。

`editions/YYYY-MM-DD.json` 使用下面的结构。完整验证器为 `model.js`，与发布前验收共享。示例中的占位文字与地址需由 Dot 替换为实际内容。

```json
{
  "schema_version": 1,
  "id": "playground-2026-11-13",
  "date": "2026-11-13",
  "timezone": "Asia/Shanghai",
  "title": "Edition title in English",
  "intro": "A short introduction in English.",
  "editorial_note": "Optional editorial observation about today's mix.",
  "items": [{
    "id": "stable-work-id",
    "type": "interactive",
    "title": "Original work title",
    "summary": "A concise factual description.",
    "comment": "Dot's short editorial take.",
    "language": "en",
    "url": "https://example.com/original",
    "keywords": ["generative art", "play"],
    "preview": {
      "url": "previews/stable-work-id.webp",
      "alt": "Describe what the real preview shows",
      "kind": "screenshot",
      "source_url": "https://example.com/original",
      "verified_at": "2026-11-13T08:00:00+08:00"
    },
    "metadata": {
      "interest": { "domain": ["art"], "topic": ["generative art"], "angle": ["playful"] },
      "format": { "modality": ["visual"], "interaction": ["hands-on"], "narrative": ["exploratory"], "consumption": ["5 minutes"] },
      "source": { "creator": ["Creator name"], "platform": ["Creator website"], "discovery": ["Direct visit"], "access": ["free", "browser"] }
    },
    "access": {
      "mode": "external",
      "verification": { "status": "verified", "checked_at": "2026-11-13T08:00:00+08:00", "note": "Original page and main interaction opened successfully." }
    },
    "evidence": [{ "url": "https://example.com/original", "label": "Original work / creator credits" }]
  }]
}
```

- `type` 接受 `news / article / video / audio / interactive`。新闻采用突出标题与关键词的排版，互动内容采用宽幅预览，其余按图文、观看或收听组织。
- item ID 为稳定作品标识，同一作品跨期可复用。单期内唯一，使用小写字母、数字和连字符，最长 96 字符。
- metadata 的每个维度均为字符串数组，可多选，也可留空数组。公开卡片展示关键词，Behind the Curtain 展示每条主要属性、完整 metadata 与证据链接，统计直接从本期 items 计算。
- `verification.status` 接受 `unverified / verified / inaccessible`。后两者必须有 `checked_at` 和实际验证说明。验证为 Dot 在记录时间的观察，后续访问仍可能变化。
- 预览可省略。已有预览须使用原作品截图或源站图片，`kind` 为 `screenshot / source-image`，保留出处与验证时间。文件放 `previews/`，所有 asset URL 相对 `plays/playground/`，避免远程热链、跟踪请求与 CSP 变更。
- 外部视频、音频和网页通过原站访问。获得合法可发布的音视频文件时可设置 `access.mode: "native"` 与 `media_url: "media/file.mp3"` 或 `media/file.mp4`，仅支持经过验证的本地文件。原站链接始终保留。播放器使用原生 controls、`preload="none"`，播放由用户手动触发。

更新流程为写入本期 JSON 与真实素材 → 将日期加入 `index.json` → `node scripts/check.mjs` → 提交并推送 `main` → 现有部署工作流 → `node scripts/check-live.mjs`。文件与索引在同一次提交中发布。历史日期留在清单中。

## 偏好契约 v1

公开默认值在 `preferences.json`，私有覆盖保存在 `panel_private.panel = playground:preferences:v1`，`content` 结构与默认文件一致。三个组各有 `prefer: string[]` 和 `avoid: string[]`，对该组所有 metadata 维度表达倾向。`exploration` 为 0–1 的探索倾向，`languages` 为语言代码数组。它们为后续策展提供软偏好，UI 保存后显示明确确认，当前已发布内容继续按原顺序呈现。

## 私有反馈契约 v1

复用现有 `panel_private` 的 Owner-only RLS，所有页面读写经过 `core/playground.js` 与 `core/panels.js`。每条反馈独立保存为 `panel = playground:feedback:v1:<uuid>`，重试沿用同一 UUID，避免反馈间覆盖与同一次提交重复记录。

```json
{
  "schema_version": 1,
  "id": "UUID",
  "scope": "item",
  "edition_id": "playground-2026-11-13",
  "item_id": "stable-work-id",
  "text": "Free text, 1–4000 characters",
  "submitted_at": "2026-11-13T08:00:00.000Z"
}
```

`scope` 接受 `item / edition / product`。整期反馈的 `item_id` 为 null，产品反馈的两个关联 ID 均为 null。数据库 `updated_at` 提供服务端收讫时间。仅收到数据库返回后显示成功，网络错误保留文字与重试 ID，并显示交付尚未确认。

Dot 使用已有 Owner 会话通过只读脚本获取本命名空间的配置与反馈，保留现有 RLS。访问令牌由既有安全凭据通道注入 `SUPABASE_ACCESS_TOKEN`，避免写入命令历史、仓库或日志。脚本验证 Owner 身份，分页读取，不返回其他面板正文。

```bash
node scripts/read-playground-private.mjs /absolute/private/path/playground-handoff.json
```

输出文件须位于仓库之外，权限为 0600。脚本以独占创建方式写文件，重跑使用新文件名。Dot 可按 `id` 在自己的私有状态中记录已消费反馈。读取和消费状态均属于运营侧。既有 Owner 数据备份也覆盖这些私有记录。

Owner 登录后的 `Download private handoff` 按钮也能下载同结构的 Playground 专属记录。Dot 可在已授权且维持 Owner 会话的浏览器环境读取此导出，使用现有 Supabase SDK 会话续期。下载文件仅包含 `playground:*`，保存到浏览器下载目录，后续经私有渠道交接。

## 验收与交接

- 正式目标地址为 `https://akiyolab.com/plays/playground/`，复用根仓库部署工作流与域名。
- `node scripts/check.mjs` 已接入 Edition、metadata、偏好、日期、索引和素材存在性检查。
- `node scripts/check-remote.mjs` 检查原有 Auth/RLS 与私有表，`node scripts/check-live.mjs` 检查新页面与已发布 JSON。
- 空清单显示首期待发布，加载错误有重试，预览/媒体失败提供明确提示与原站入口，旧期显示实际日期。
- Dot 已确认契约，并提供 `2026-11-13` 首期 7 条内容。首期未提供可再发布的预览图，保留真实来源链接与验证说明。工程接入时修正了 Digital Garden URL 的 HTML 实体转义。
- 默认偏好由工程提供初始值，Owner 可修改。当前默认探索比例为 30%，主要语言为英文。
- 定时环境尚无已确认可用的稳定私有读取通道。脚本支持已有 Owner access token，令牌续期和保管由运营环境的既有 Auth 会话承担。新增持久凭据或数据库角色须另行确认。

## 2026-11-13 上线记录

- 已发布到正式域名与既有 GitHub Pages 预览。正式首期链接为 `https://akiyolab.com/plays/playground/?date=2026-11-13`。
- 实现提交为 `1038393`，正式 Worker 版本为 `15322d1a-a242-44a6-a6b1-e173c5f4fc76`。此次正式发布使用 Owner 授权的 Wrangler OAuth，会话保存在本机钥匙串。
- `check.mjs`、`check-remote.mjs`、`check-live.mjs` 全部通过。浏览器验收覆盖首页入口、真实 7 条 JSON、1440 / 390 / 320 宽度、匿名门禁、错误日期、图片和音频失败、反馈失败保留与同 ID 重试。
- 正式站 Owner 已通过正常页面提交一条单条内容的工程测试反馈，服务端确认成功，专属私有导出读取到了相同 ID 与上下文。测试 ID 为 `19b6d024-cd79-426e-8baa-7397d3586a8f`，供 Dot 识别并忽略该测试。偏好按默认值保存后已验证刷新重新读取。
- 真实数据库事务检查验证了 Owner 私有写入/读取及非 Owner 的读取隔离、写入拒绝，测试事务已回滚。
- 现有 Supabase 项目此前暂停，本次已恢复。Owner 通过官方恢复邮件重新登录，密码设置由 Owner 在网页完成。
- 首次部署遗漏本地 `task-*.md` 的资产排除，一份工程交接日志被上传。已补齐 `.assetsignore` 并重新发布，线上该路径已返回 404，`check-live.mjs` 增加了回归检查。
- 仓库 Actions 已配置部署专用 `CLOUDFLARE_API_TOKEN`，main push 将执行本地检查、Supabase 门禁、Cloudflare 部署和正式站 smoke。Dot 发布时提交本期 JSON、素材及日期清单到 main，即可触发正式更新。独立定时环境的私有读取继续按运营侧接入状态交接。
- 部署 token 名称为 `lab-play-github-actions`。权限限定为指定账号的 Workers Scripts Edit，以及 `akiyolab.com` 的 Workers Routes Edit / Zone Read。采用默认的无到期日设置，凭据经 GitHub 公钥加密后写入 Actions secret。
- 首次自动发布发现 Wrangler Action 在资产根目录安装 `node_modules`，导致资产超限。已将依赖目录及 npm 生成的清单加入 `.assetsignore`，并补充线上隐藏资产验收。
- 已通过真实 main push 验证自动发布，提交为 `1ed545a`。[验收流水线](https://github.com/AkiyoZHAO/lab-play/actions/runs/43389354014) 的静态检查、Supabase 门禁、Cloudflare 部署与正式站 smoke 全部成功。
