#!/bin/bash

# Hello Kitty Love Site 启动脚本
# 用法: ./start.sh [start|stop|restart|status]

APP_NAME="kitty-love-site"
APP_DIR="/home/kitty-love-site"
LOG_FILE="$APP_DIR/app.log"
PID_FILE="$APP_DIR/app.pid"

# 加载环境变量
export DATABASE_URL="file:./prisma/dev.db"

start() {
    if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
        echo "❌ $APP_NAME 已经在运行 (PID: $(cat $PID_FILE))"
        return 1
    fi
    
    echo "🚀 启动 $APP_NAME..."
    cd "$APP_DIR"
    nohup pnpm start > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    sleep 2
    
    if kill -0 $(cat "$PID_FILE") 2>/dev/null; then
        echo "✅ $APP_NAME 启动成功 (PID: $(cat $PID_FILE))"
        echo "📝 日志文件: $LOG_FILE"
        echo "🌐 访问: http://localhost:3000"
    else
        echo "❌ 启动失败，请查看日志: tail -f $LOG_FILE"
        rm -f "$PID_FILE"
        return 1
    fi
}

stop() {
    if [ ! -f "$PID_FILE" ]; then
        echo "⚠️ $APP_NAME 没有在运行"
        return 0
    fi
    
    PID=$(cat "$PID_FILE")
    echo "🛑 停止 $APP_NAME (PID: $PID)..."
    
    kill $PID 2>/dev/null
    sleep 2
    
    if kill -0 $PID 2>/dev/null; then
        echo "强制终止..."
        kill -9 $PID 2>/dev/null
    fi
    
    rm -f "$PID_FILE"
    echo "✅ $APP_NAME 已停止"
}

restart() {
    stop
    sleep 1
    start
}

status() {
    if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
        echo "✅ $APP_NAME 正在运行 (PID: $(cat $PID_FILE))"
    else
        echo "⚠️ $APP_NAME 没有在运行"
        rm -f "$PID_FILE" 2>/dev/null
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
