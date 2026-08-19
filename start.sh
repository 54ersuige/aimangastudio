#!/usr/bin/env bash
# ============================================================
#  AIMangaStudio 一键启动（Linux / macOS / WSL）
#  - 检查 Node.js >=18
#  - 首次运行自动安装依赖
#  - 后端 + 前端后台启动
#  - 自动打开浏览器
#
#  用法：
#    bash start.sh            # 启动
#    bash start.sh --stop     # 停止
#    bash start.sh --status   # 查看状态
# ============================================================
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BACKEND_PORT=3001
FRONTEND_PORT=5173

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
cyan()   { printf '\033[36m%s\033[0m\n' "$*"; }
banner() {
    printf '\n============================================================\n'
    printf '  %s\n' "$1"
    printf '============================================================\n\n'
}

port_listening() {
    local port="$1"
    if command -v ss >/dev/null 2>&1; then
        ss -ltn 2>/dev/null | awk -v p=":$port" '$4 ~ p {found=1} END{exit !found}'
    elif command -v lsof >/dev/null 2>&1; then
        lsof -iTCP:"$port" -sTCP:LISTEN -P -n >/dev/null 2>&1
    elif command -v netstat >/dev/null 2>&1; then
        netstat -ltn 2>/dev/null | awk -v p=":$port" '$4 ~ p {found=1} END{exit !found}'
    else
        return 1
    fi
}

stop_services() {
    banner "停止 AIMangaStudio"
    cyan "[*] 关闭占用 $BACKEND_PORT / $FRONTEND_PORT 的进程（如有）"
    for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
        pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
        if [ -n "$pids" ]; then
            echo "$pids" | xargs -r kill -9 2>/dev/null || true
        fi
    done
    # 兜底：杀掉所有 node 子进程里与本项目相关的（按命令行匹配 cwd）
    pkill -f "node .*server/index.ts" 2>/dev/null || true
    pkill -f "vite" 2>/dev/null || true
    green "[OK] 已停止"
}

show_status() {
    banner "AIMangaStudio 运行状态"
    for pair in "Backend (3001) $BACKEND_PORT" "Frontend (5173) $FRONTEND_PORT"; do
        name="${pair%% *}"; port="${pair##* }"
        if port_listening "$port"; then
            printf '  \033[32m[RUNNING]\033[0m %-18s port %s\n' "$name" "$port"
        else
            printf '  \033[90m[STOPPED]\033[0m %-18s port %s\n' "$name" "$port"
        fi
    done
    printf '\n'
}

case "${1:-}" in
    --stop)   stop_services; exit 0 ;;
    --status) show_status;   exit 0 ;;
esac

banner "AIMangaStudio 启动中..."

# 1) Node.js 检查
if ! command -v node >/dev/null 2>&1; then
    red "[X] 未检测到 Node.js。请先安装 Node.js 18+：https://nodejs.org/"
    exit 1
fi
NODE_VERSION="$(node -v | tr -d 'v')"
NODE_MAJOR="$(echo "$NODE_VERSION" | cut -d. -f1)"
if [ "$NODE_MAJOR" -lt 18 ]; then
    red "[X] Node.js 版本过低（当前 v$NODE_VERSION，需要 18+）。"
    exit 1
fi
green "[OK] Node.js 检测通过：v$NODE_VERSION"

# 2) 端口检查
if port_listening "$BACKEND_PORT"; then
    red "[X] 后端端口 $BACKEND_PORT 已被占用。请先关闭占用的进程。"
    exit 1
fi
if port_listening "$FRONTEND_PORT"; then
    yellow "[!] 前端端口 $FRONTEND_PORT 已被占用，可能之前启动的 AIMangaStudio 还没关掉。"
    yellow "    无需操作，继续（Vite 会自动切换到下一个可用端口）。"
fi

# 3) 依赖
if [ ! -d "node_modules" ]; then
    cyan "[*] 首次运行，正在安装前端依赖（这可能需要 1-2 分钟）..."
    npm install || { red "[X] 前端依赖安装失败。"; exit 1; }
fi
if [ ! -d "server/node_modules" ]; then
    cyan "[*] 首次运行，正在安装后端依赖..."
    ( cd server && npm install ) || { red "[X] 后端依赖安装失败。"; exit 1; }
fi
green "[OK] 依赖就绪"

# 4) 启动后端
cyan "[*] 启动后端（端口 $BACKEND_PORT）"
( cd "$SCRIPT_DIR/server" && nohup npm run start > "$SCRIPT_DIR/.backend.log" 2>&1 & )
BACKEND_PID=$!

# 5) 启动前端
cyan "[*] 启动前端（端口 $FRONTEND_PORT）"
( cd "$SCRIPT_DIR" && nohup npm run dev:client > "$SCRIPT_DIR/.frontend.log" 2>&1 & )
FRONTEND_PID=$!

# 6) 等就绪，打开浏览器
cyan "[*] 等待服务就绪..."
waited=0
while [ $waited -lt 60 ]; do
    if port_listening "$FRONTEND_PORT"; then break; fi
    sleep 1
    waited=$((waited+1))
done

if port_listening "$FRONTEND_PORT"; then
    green "[OK] 服务已就绪，打开浏览器..."
    if command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$FRONTEND_PORT" >/dev/null 2>&1 &
    elif command -v open    >/dev/null 2>&1; then open    "http://localhost:$FRONTEND_PORT" >/dev/null 2>&1 &
    fi
else
    yellow "[!] 等待超时，请稍后手动打开 http://localhost:$FRONTEND_PORT"
fi

green "
============================================================
  AIMangaStudio 已启动！

    浏览器：   http://localhost:$FRONTEND_PORT
    后端 API： http://localhost:$BACKEND_PORT

  日志：
    后端： tail -f .backend.log
    前端： tail -f .frontend.log

  停止服务：bash start.sh --stop
  查看状态：bash start.sh --status
============================================================
"

exit 0