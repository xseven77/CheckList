# CheckList · 婚礼筹备清单

婚礼行程与物资筹备清单全栈应用（3—7 号）。支持多人多端实时同步勾选、日历导入、长图导出，基于本地 JSON 文件持久化存储，开箱即用，支持独立自部署。

---

## 核心功能

- **查看与勾选**：事项与明细随时勾选，实时计算总进度、每日进度与各分区进度；
- **日历导入**：上传 .ics 文件、填写订阅链接（支持 webcal://）或粘贴 .ics 文本，单向导入日历事件（按事件 UID 匹配，勾选状态原样保留）；
- **实时同步**：基于 Server-Sent Events (SSE)，多台手机/电脑打开同一页面，任何一端勾选实时推送到所有设备；
- **长图导出**：一键生成高清 PNG 长图（✓ 标注已完成项），支持手机长按保存与电脑下载分享；
- **移动端优化**：触控区域 ≥ 44px，窄屏适配自适应布局；
- **可选访问保护**：配置环境变量 `APP_PASSWORD` 即可开启 HTTP Basic 认证，未配置则完全开放。

---

## 本地开发与运行

### 快速启动（构建并启动生产服务）
```bash
# 默认：后台 nohup 守护运行，默认乱序高端口 48293
./start.sh

# 前台运行（查看实时输出）
./start.sh -f

# 指定端口后台运行
./start.sh -p 52381

# 运维命令
./start.sh status   # 查看运行状态
./start.sh stop     # 停止后台服务
./start.sh restart  # 重启后台服务
```

### 分步运行
1. **安装依赖**：
   ```bash
   npm install
   ```
2. **开发模式（热更新）**：
   ```bash
   npm run dev
   ```
   打开浏览器访问 [http://localhost:3000](http://localhost:3000)。同一局域网下的手机可通过 `http://<电脑局域网IP>:3000` 访问。
3. **独立构建与启动**：
   ```bash
   npm run build
   npm start
   ```

---

## 部署方式

### 方式一：Docker / Docker Compose（推荐）

项目根目录已提供 `Dockerfile` 与 `docker-compose.yml`：

```bash
# 启动容器
docker compose up -d --build
```
数据会自动持久化挂载到宿主机的 `./data` 目录。

如需开启访问密码，在 `docker-compose.yml` 中或启动时传入环境变量：
```yaml
environment:
  - APP_PASSWORD=your_password
```

### 方式二：Node.js 原生部署

```bash
npm ci
npm run build
PORT=3000 npm start
```

---

## 数据持久化机制

* **种子数据**：[`data/seed.json`](data/seed.json) 包含默认的 3—7 号全部行程、事项及分组明细，受 Git 版本控制；
* **运行时状态**：应用首次启动读取数据时，若无运行时状态文件，会自动从 `seed.json` 复制生成 `data/state.json`；
* **原子写入与并发控制**：所有的勾选与导入操作均在服务端排队串行写入，采用临时文件 + 重命名实现原子写入，避免断电或并发写损坏数据；
* **数据备份**：访问 `GET /api/checklist` 即可获取当前整份 JSON 数据，支持脚本定期备份。

---

## 项目结构

```text
├── app/
│   ├── api/
│   │   ├── calendar/import/  # 日历导入（.ics 文件 / 订阅链接 / 粘贴文本，POST）
│   │   ├── checklist/    # 获取整份清单 JSON
│   │   ├── groups/[id]/  # 切换组内明细勾选态 (PUT)
│   │   ├── tasks/[id]/   # 切换事项勾选态 (PUT)
│   │   └── stream/       # SSE 实时推送通道 (GET)
│   ├── globals.css       # 全局样式与浅/深色主题
│   ├── layout.tsx        # 根布局
│   └── page.tsx          # 页面入口 (SSR)
├── components/
│   └── Checklist.tsx     # 清单核心交互组件
├── data/
│   ├── seed.json         # 初始种子数据
│   └── state.json        # 运行时动态数据 (gitignore)
├── lib/
│   ├── calendarSync.ts   # 日历事件 → 清单事项映射
│   ├── exportImage.ts    # Canvas 高清长图绘制
│   ├── ics.ts            # .ics 解析
│   ├── store.ts          # JSON 数据持久化与事件总线
│   └── types.ts          # 数据模型与类型定义
├── proxy.ts              # 可选密码访问控制代理 (Next.js 16)
├── Dockerfile            # 多阶段轻量镜像构建
└── docker-compose.yml    # 容器化一键部署编排
```
