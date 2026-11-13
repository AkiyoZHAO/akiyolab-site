# Playground 专用只读接入草案

2026-11-13，本草案尚未在生产部署。Dot 已回报日更自动化没有 secret 注入字段，Default environment 没有配置 vault。本地环境列表仅能确认 Default environment 可运行，无法证明实际日更环境具备安全存储。当前交付包括无凭据迁移、客户端及合成测试。

## 接入前提

在实际日更运行时确认以下能力后，才进入创建账号和授权阶段。

1. 有运维方可管理、可撤销的私密凭据存储，访问权限仅授予该运行时。会话应通过受控接口注入内存。
2. 存储支持跨执行持久化、原子替换和跨执行互斥，或者提供等价的版本比较更新。Supabase refresh token 轮换后必须先保存新会话，再读取私有记录。
3. 实际云端完成非敏感标记的写入、另一次执行读取、互斥更新和删除测试，并能非交互访问 Supabase Auth 与 REST。
4. 确定轮换中断的安全恢复方法。刷新结果或存储提交不确定时停止读取并向运营方报告固定错误，恢复须走已确认的存储或专用账号流程。

公开仓库、Actions 日志和 artifacts 都不适合保存反馈或会话。现有 Actions secret 的部署凭据不提供日更运行时可读取、可轮换的会话存储能力。上述能力截至交接均未完成真实云端验证。

## 服务端边界

`playground-reader.sql` 复用 Supabase Auth 和 REST RPC。专用账号的 `app_metadata.role` 为 `playground_reader`，管理员登记其 Auth UUID 和已核实的 Aki Owner UUID。客户端只使用该账号的普通 Auth 会话。

现有 `panel_private` 使用全局 panel 主键，缺少行归属。草案增加 `owner_id`，新行默认取得调用者的 `auth.uid()`。旧 Playground 行的归属回填要求管理员明确指定唯一 Owner，检查失败则整次迁移回滚。执行前须核实该唯一 Owner 为 Aki，历史记录确实属于该账号。其他面板的旧行不做归属回填。

`private.playground_reader_grants` 保存专用 reader 到 Owner 的授权及撤销时间，表的客户端访问权限关闭。RPC 固定从授权表取得 Owner，只返回属于此 Owner 且匹配以下键的 `panel / content / updated_at`。

- 精确的 `playground:preferences:v1`
- 以 `playground:feedback:v1:` 开头的键

RPC 同时检查请求身份、JWT 中的专用角色、Auth 用户当前的专用角色及未撤销授权。查询只接受分页游标和 1–500 的页大小。函数使用固定空 `search_path` 和显式 schema，默认 PUBLIC/anon 执行权限被撤销。既有 Owner 写策略和 RPC 的 Owner 检查仍构成写入门禁。

授权表初始为空，迁移本身不会登记 reader。登记须在实际安全路径验收完成后，由管理员绑定已经核实的两方身份。撤销采用将该授权行的 `revoked_at` 设为当前时间，提交后的新请求即使携带原 JWT 也会被拒绝。随后通过管理员流程撤销该专用账号的登录和续期能力，并清除 vault 内会话。已经开始的读取可能在撤销时完成。

多用户隔离目前通过显式 `owner_id` 测试。原系统的全局 panel 主键仍限制同名 preferences 行只能存在一条，后续扩展多 Owner 产品时须独立处理该数据模型。

## 客户端契约

客户端位于 `scripts/lib/playground-reader.mjs`，导出 `readScopedPlayground({sessionStore})`。安全存储适配器须提供下面的接口，具体实现待实际云端存储确认。

```js
sessionStore.withExclusive(async store => {
  const session = await store.read();
  // session 包含 reader_id、access_token、refresh_token、expires_at。
  // store.replace(newSession) 必须原子、持久地保存会话。
});
```

客户端在整个读取过程持有存储锁，临近过期时续期，持久保存新会话后核实专用身份，再分页调用 `read_playground_private_v1`。HTTP、网络及存储错误仅提供固定诊断信息。返回值沿用 `{schema_version, exported_at, records}`，只存在调用者内存中。实际运营代码负责将其交给私密策展上下文。

每次执行完整读取，运营侧按 `panel + updated_at` 识别已处理记录。UUID 字典序游标仅用于一次读取内的分页。

## 已执行的合成验收

使用 PGlite 0.5.16 的真实 PostgreSQL WASM 引擎，载入仓库 `db/schema.sql` 与本迁移草案。Auth schema、用户、JWT claims 和记录全部由测试合成，Supabase Auth 服务由受控响应模拟。

```bash
npm install --prefix /tmp/lab-playground-reader-qa --no-package-lock --no-save @electric-sql/pglite@0.5.16
PGLITE_MODULE=/tmp/lab-playground-reader-qa/node_modules/@electric-sql/pglite/dist/index.js node --test scripts/tests/playground-reader.test.mjs
```

14 项测试实际执行并通过，覆盖精确键和 Aki 归属读取、其他用户和未归属行排除、原表直接读取隔离、匿名及无授权身份拒绝、可编辑 user metadata 无法提权、insert/upsert/update/delete 拒写、既有写 RPC 拒绝、管理操作拒绝、撤销后旧 JWT 拒绝、分页边界、Owner 正常写入、会话轮换保存顺序、保存失败停止读取、Owner 会话拒绝以及错误脱敏。

真实云端 vault、跨执行锁、Supabase 登录续期、生产迁移和生产权限验收尚待安全路径成立后执行。测试依赖安装在临时目录，数据库和脚本通过现有 `.assetsignore` 排除于网站资产之外。
