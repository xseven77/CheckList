# CheckList · 婚礼筹备清单

3—7 号婚礼行程与物品清单，单页网页，已发布为 Claude Artifact：
https://claude.ai/artifact/XZm1PAexPNk1tBfRXmrLUH

## 功能
- 默认查看状态：勾选事项和明细，顶部显示总进度、每天进度、每个分区进度
- 点「编辑」进入编辑状态：增加、修改、删除明细；删除要二次确认，删除后 8 秒内可撤销
- 导出长图：把全部清单画成 PNG（✓ 表示已完成），可保存或长按保存
- 手机友好：触控区域 ≥ 44px，窄屏日期改为横排

## 数据
- 在 Claude 里登录打开时，勾选和修改存在 Artifact 的共享数据库里，所有能打开这个页面的人看到同一份
  - `groups/<分组id>`：`{ items: [{ id, t, d }], at }`
  - `tasks/<事项id>`：`{ done, at }`
  - 数据库里没有的分组用页面内置的默认清单
- 打不开共享数据库时（没登录等）只存在当前浏览器的 localStorage

## 文件
- `index.html`：页面本体（发布时平台会补上 `<!doctype html>` 等外层结构）
- `codex-original/`：之前 Codex 会话里做的版本，留作参考

## 更新
改完 `index.html` 后让 Claude 重新发布同一个文件，链接不变。
