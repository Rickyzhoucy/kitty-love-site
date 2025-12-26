#!/bin/bash

# Hello Kitty Love Site 启动脚本
# 用法: ./start.sh [start|stop|restart|status]

APP_NAME="kitty-love-site"
APP_DIR="/home/kitty-love-site"
LOG_FILE="$APP_DIR/app.log"
PID_FILE="$APP_DIR/app.pid"
PORT=3000

# 加载环境变量
export DATABASE_URL="file:./prisma/dev.db"

# 杀掉占用端口的进程
kill_port() {
    local pid=$(lsof -t -i:$PORT 2>/dev/null)
    if [ -n "$pid" ]; then
        echo "⚠️ 发现端口 $PORT 被占用，正在清理..."
        kill -9 $pid 2>/dev/null
        sleep 1
    fi
    
    # 也清理 next-server 进程
    pkill -9 -f "next-server" 2>/dev/null
    pkill -9 -f "next start" 2>/dev/null
}

start() {
    # 先清理可能存在的进程
    kill_port
    
    echo "🚀 启动 $APP_NAME..."
    cd "$APP_DIR"
    nohup pnpm start > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    sleep 3
    
    # 检查是否启动成功
    if lsof -i:$PORT > /dev/null 2>&1; then
        echo "✅ $APP_NAME 启动成功"
        echo "📝 日志文件: $LOG_FILE"
        echo "🌐 访问: http://localhost:$PORT"
    else
        echo "❌ 启动失败，请查看日志: tail -f $LOG_FILE"
        rm -f "$PID_FILE"
        return 1
    fi
}

stop() {
    echo "🛑 停止 $APP_NAME..."
    
    # 清理所有相关进程
    kill_port
    
    if [ -f "$PID_FILE" ]; then
        rm -f "$PID_FILE"
    fi
    
    echo "✅ $APP_NAME 已停止"
}

restart() {
    stop
    sleep 1
    start
}

status() {
    if lsof -i:$PORT > /dev/null 2>&1; then
        echo "✅ $APP_NAME 正在运行 (端口 $PORT)"
        lsof -i:$PORT | grep LISTEN
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
