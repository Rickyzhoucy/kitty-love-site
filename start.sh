#!/bin/bash

# Hello Kitty Love Site 启动脚本
# 用法: ./start.sh [start|stop|restart|status]

APP_NAME="kitty-love-site"
APP_DIR="/home/kitty-love-site"
LOG_FILE="$APP_DIR/app.log"
PID_FILE="$APP_DIR/app.pid"

# 加载环境变量
export DATABASE_URL="file:./prisma/dev.db"

# 检查 next-server 是否在运行
is_running() {
    pgrep -f "next-server" > /dev/null 2>&1
}

# 停止所有 next 相关进程
kill_next() {
    pkill -9 -f "next-server" 2>/dev/null
    pkill -9 -f "next start" 2>/dev/null
    pkill -9 -f "pnpm start" 2>/dev/null
    sleep 1
}

start() {
    if is_running; then
        echo "⚠️ $APP_NAME 已经在运行，先停止..."
        kill_next
    fi
    
    echo "🚀 启动 $APP_NAME..."
    cd "$APP_DIR"
    nohup pnpm start > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    sleep 3
    
    if is_running; then
        echo "✅ $APP_NAME 启动成功"
        echo "📝 日志文件: $LOG_FILE"
        echo "🌐 访问: http://localhost:3000"
        pgrep -f "next-server"
    else
        echo "❌ 启动失败，请查看日志: tail -f $LOG_FILE"
        return 1
    fi
}

stop() {
    echo "🛑 停止 $APP_NAME..."
    kill_next
    rm -f "$PID_FILE"
    
    if is_running; then
        echo "⚠️ 无法停止，尝试强制终止..."
        kill_next
    fi
    
    echo "✅ $APP_NAME 已停止"
}

restart() {
    stop
    sleep 1
    start
}

status() {
    if is_running; then
        echo "✅ $APP_NAME 正在运行"
        echo "进程信息:"
        ps aux | grep "next-server" | grep -v grep
    else
        echo "⚠️ $APP_NAME 没有在运行"
    fi
}

logs() {
    tail -f "$LOG_FILE"
}

case "$1" in
    start)   start ;;
    stop)    stop ;;
    restart) restart ;;
    status)  status ;;
    logs)    logs ;;
    *)
        echo "Hello Kitty Love Site 管理脚本 🎀"
        echo ""
        echo "用法: $0 {start|stop|restart|status|logs}"
        echo ""
        echo "  start   - 启动服务"
        echo "  stop    - 停止服务"
        echo "  restart - 重启服务"
        echo "  status  - 查看状态"
        echo "  logs    - 查看日志"
        ;;
esac
