#!/usr/bin/env bash
set -e

# 进入项目根目录
cd "$(dirname "$0")"

# 默认复杂的乱端口（避免与常见 3000/8080 等冲突）
DEFAULT_PORT=48293
PORT="${PORT:-$DEFAULT_PORT}"

# 默认模式：后台守护运行 (nohup / daemon)
DAEMON=1

LOG_FILE="app.log"
PID_FILE="app.pid"

usage() {
  echo "使用方式:"
  echo "  $0                  # 默认后台 nohup 启动 (端口: ${DEFAULT_PORT})"
  echo "  $0 -f               # 前台运行 (--foreground，输出直接打印在终端)"
  echo "  $0 -p 52381         # 自定义端口后台启动"
  echo "  $0 -f -p 52381      # 自定义端口前台运行"
  echo "  $0 stop             # 停止后台服务"
  echo "  $0 restart          # 重启后台服务"
  echo "  $0 status           # 查看运行状态"
  exit 0
}

stop_service() {
  local stopped=0

  # 1. 按 PID 文件停止
  if [ -f "$PID_FILE" ]; then
    local pid
    pid=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "🛑 [CheckList] 正在停止后台服务 (PID: $pid)..."
      kill "$pid" 2>/dev/null || true
      for _ in {1..10}; do
        if ! kill -0 "$pid" 2>/dev/null; then
          stopped=1
          break
        fi
        sleep 0.5
      done
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
        stopped=1
      fi
    fi
    rm -f "$PID_FILE"
  fi

  # 2. 按端口兜底清理残留进程
  local port_pids
  port_pids=$(lsof -ti :"$PORT" 2>/dev/null || true)
  if [ -n "$port_pids" ]; then
    echo "🛑 [CheckList] 清理端口 $PORT 上的残留进程 ($port_pids)..."
    kill -9 $port_pids 2>/dev/null || true
    stopped=1
  fi

  if [ "$stopped" -eq 1 ]; then
    echo "✅ [CheckList] 服务已成功停止"
  else
    echo "ℹ️ [CheckList] 未检测到正在运行的服务"
  fi
}

status_service() {
  local running_pid=""
  if [ -f "$PID_FILE" ]; then
    local pid
    pid=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      running_pid="$pid"
    fi
  fi

  local port_pids
  port_pids=$(lsof -ti :"$PORT" 2>/dev/null || true)

  if [ -n "$running_pid" ] || [ -n "$port_pids" ]; then
    echo "🟢 [CheckList] 服务正在后台运行中"
    echo "  🔹 PID:     ${running_pid:-$port_pids}"
    echo "  🔹 端口:    $PORT"
    echo "  🔹 访问:    http://localhost:$PORT"
    echo "  🔹 日志:    $LOG_FILE"
  else
    echo "⚪ [CheckList] 服务未在运行"
  fi
}

# 参数解析
while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--foreground|foreground|--no-daemon)
      DAEMON=0
      shift
      ;;
    -d|--daemon|daemon|nohup)
      DAEMON=1
      shift
      ;;
    -p|--port)
      if [ -z "$2" ]; then
        echo "❌ 缺少端口参数"
        exit 1
      fi
      PORT="$2"
      shift 2
      ;;
    stop)
      stop_service
      exit 0
      ;;
    status)
      status_service
      exit 0
      ;;
    restart)
      stop_service
      DAEMON=1
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "未知参数: $1"
      usage
      ;;
  esac
done

# 检查依赖
echo "🚀 [CheckList] 检查依赖..."
if [ ! -d "node_modules" ]; then
  echo "📦 未检测到依赖，正在执行 npm install..."
  npm install
fi

# 构建项目
echo "🔨 [CheckList] 正在构建项目 (next build)..."
npm run build

# 获取局域网 IP
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "局域网IP")

# 后台模式 (默认：nohup / daemon)
if [ "$DAEMON" -eq 1 ]; then
  # 若端口或 PID 已有运行中服务，先自动停掉再启动
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null; then
    echo "⚠️ 检测到已有后台服务，正在重启..."
    stop_service
  elif [ -n "$(lsof -ti :"$PORT" 2>/dev/null || true)" ]; then
    echo "⚠️ 检测到端口 $PORT 已被占用，正在清理旧进程..."
    stop_service
  fi

  echo "✨ [CheckList] 默认后台启动 (nohup，端口: ${PORT})..."

  node -e "
    const { spawn } = require('child_process');
    const fs = require('fs');
    const out = fs.openSync('$LOG_FILE', 'a');
    const child = spawn('./node_modules/.bin/next', ['start', '-p', '$PORT'], {
      detached: true,
      stdio: ['ignore', out, out],
      env: { ...process.env, PORT: '$PORT' }
    });
    child.unref();
    fs.writeFileSync('$PID_FILE', String(child.pid));
  "

  # 等待 1.5 秒确认启动状态
  sleep 1.5
  PID=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    echo "✅ [CheckList] 服务已在后台成功启动！"
    echo "----------------------------------------"
    echo "  🔹 模式:     后台 (nohup 守护)"
    echo "  🔹 PID:      $PID"
    echo "  🔹 端口:     $PORT"
    echo "  🔹 本机访问: http://localhost:${PORT}"
    echo "  🔹 手机访问: http://${LAN_IP}:${PORT}"
    echo "  🔹 查看日志: tail -f ${LOG_FILE}"
    echo "  🔹 停止服务: ./start.sh stop"
    echo "  🔹 前台运行: ./start.sh -f"
    echo "----------------------------------------"
  else
    echo "❌ [CheckList] 后台启动失败，请检查日志:"
    cat "$LOG_FILE"
    rm -f "$PID_FILE"
    exit 1
  fi
else
  # 前台模式 (-f / --foreground)
  echo "✨ [CheckList] 前台运行模式 (端口: ${PORT})..."
  echo "  🔹 本机访问: http://localhost:${PORT}"
  echo "  🔹 手机访问: http://${LAN_IP}:${PORT}"
  echo "  🔹 按 Ctrl+C 即可退出"
  export PORT
  exec ./node_modules/.bin/next start -p "$PORT"
fi
