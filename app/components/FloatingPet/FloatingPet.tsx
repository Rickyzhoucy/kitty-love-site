'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import styles from './FloatingPet.module.css';
import { usePet } from './usePet';
import { PET_CONFIG } from './petConfig';
import { petEvents } from '@/lib/petEvents';
import type { Live2DPetHandle, Live2DMotion } from './Live2DPet';

// 动态导入 Live2D 组件避免 SSR 问题，但优化加载体验
const Live2DPet = dynamic(() => import('./Live2DPet'), {
    ssr: false,
    loading: () => (
        <div className={styles.petLoading} style={{ width: 180, height: 180 }}>
            {/* 这里的 Loading 可以做得更好看一点 */}
            🐾
        </div>
    )
});

type MenuType = 'none' | 'main' | 'status' | 'color' | 'accessory' | 'rename' | 'actions';

// 简单映射配饰位置
const getAccessoryPosition = (id: string) => {
    switch (id) {
        case 'glasses': return 'eyes';
        case 'scarf': return 'neck';
        case 'wings': return 'back';
        case 'bow':
        case 'crown':
        case 'halo':
        default: return 'top';
    }
};

export default function FloatingPet() {
    const pathname = usePathname();
    const { pet, loading, feed, play, rename, changeColor, equipItem, refetch } = usePet();
    const [menuType, setMenuType] = useState<MenuType>('none');
    const [speech, setSpeech] = useState<string | null>(null);
    const [isAnimating, setIsAnimating] = useState(false);
    const [animationType, setAnimationType] = useState<'levelUp' | 'evolving' | null>(null);
    // 聊天状态
    const [isChatting, setIsChatting] = useState(false);
    const [chatInput, setChatInput] = useState('');
    const [chatHistory, setChatHistory] = useState<{ role: string, content: string }[]>([]);
    const [isSending, setIsSending] = useState(false);
    const [newName, setNewName] = useState('');
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [live2dLoaded, setLive2dLoaded] = useState(false);
    const dragOffset = useRef({ x: 0, y: 0, w: 0, h: 0 }); // Added w, h
    const containerRef = useRef<HTMLDivElement>(null);
    const live2dRef = useRef<Live2DPetHandle>(null);

    // Hide on admin and verify pages
    if (pathname?.startsWith('/admin') || pathname?.startsWith('/verify')) return null;

    const handleLive2DLoad = useCallback(() => setLive2dLoaded(true), []);
    const handleLive2DError = useCallback((e: Error) => console.error('Live2D error:', e), []);

    // 显示对话气泡 (duration = 0 为永久)
    const showSpeech = useCallback((text: string, duration = 3000) => {
        setSpeech(text);
        if (duration > 0) {
            setTimeout(() => setSpeech(prev => prev === text ? null : prev), duration);
        }
    }, []);

    // 监听宠物事件
    useEffect(() => {
        const unsubscribe = petEvents.subscribe((type, data) => {
            if (type === 'experience_gained' && data.message) {
                showSpeech(data.message);
                refetch(); // 刷新状态
            } else if (type === 'refetch') {
                refetch();
            }
        });
        return unsubscribe;
    }, [showSpeech, refetch]);

    // 加载保存的位置
    useEffect(() => {
        const saved = localStorage.getItem('petPosition');
        if (saved) {
            try {
                setPosition(JSON.parse(saved));
            } catch { }
        }
    }, []);

    // 保存位置
    useEffect(() => {
        if (position.x !== 0 || position.y !== 0) {
            localStorage.setItem('petPosition', JSON.stringify(position));
        }
    }, [position]);

    // 播放动画
    const playAnimation = (type: 'levelUp' | 'evolving') => {
        setAnimationType(type);
        setIsAnimating(true);
        setTimeout(() => {
            setIsAnimating(false);
            setAnimationType(null);
        }, type === 'evolving' ? 1000 : 500);
    };

    // 处理喂食
    const handleFeed = async () => {
        const result = await feed();
        if (result.success) {
            showSpeech('好吃！谢谢主人~ 🍎');
            live2dRef.current?.playMotion('Shake'); // 播放开心动画
            if (result.expGained) {
                showSpeech(`获得 ${result.expGained} 经验！`, 2000);
            }
        } else {
            showSpeech(result.message || '今天吃太多了...', 2000);
        }
        setMenuType('none');
    };

    // 处理玩耍
    const handlePlay = async () => {
        const result = await play();
        if (result.success) {
            showSpeech('好开心！🎮✨');
            live2dRef.current?.playMotion('Flick'); // 播放互动动画
            if (result.expGained) {
                setTimeout(() => showSpeech(`获得 ${result.expGained} 经验！`, 2000), 1500);
            }
        } else {
            showSpeech(result.message || '有点累了...', 2000);
        }
        setMenuType('none');
    };

    // 处理改名
    const handleRename = async () => {
        if (newName.trim()) {
            await rename(newName.trim());
            showSpeech(`好的，以后叫我 ${newName.trim()} 吧！`);
            setNewName('');
        }
        setMenuType('none');
    };

    // 处理聊天
    const handleChat = () => {
        setIsChatting(true);
        setMenuType('none');
        showSpeech('想跟我聊什么呢？喵~');
    };

    // 发送聊天消息
    const sendChatMessage = async (overrideMessage?: string, triggerContext?: string) => {
        const message = overrideMessage || chatInput.trim();
        // 如果没有消息且没有触发上下文，或者正在发送，或者宠物未加载，则返回
        if ((!message && !triggerContext) || isSending || !pet) return;

        if (!overrideMessage && !triggerContext) setChatInput('');
        setIsSending(true);

        try {
            const res = await fetch('/api/pet/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: triggerContext ? `[System: ${triggerContext}]` : message,
                    history: chatHistory,
                    petName: pet.name // Dynamic Name Injection
                })
            });

            if (res.ok) {
                const data = await res.json();
                if (data.reply) {
                    // Chat replies are now sticky until closed or replaced
                    showSpeech(data.reply, 0);
                    // 仅保存用户对话历史，跳过系统触发的上下文（保持历史清晰）
                    if (!triggerContext) {
                        setChatHistory(prev => [
                            ...prev,
                            { role: 'user', content: message },
                            { role: 'assistant', content: data.reply }
                        ].slice(-10));
                    }

                    if (pet.mode === 'live2d') {
                        live2dRef.current?.playMotion('Tap');
                    }
                }
            } else {
                if (!triggerContext) showSpeech('我好像听不懂... (API Error)');
            }
        } catch {
            if (!triggerContext) showSpeech('网络好像有点问题喵...');
        } finally {
            setIsSending(false);
        }
    };

    // 主动触发逻辑
    useEffect(() => {
        // 页面加载时的问候
        if (pet && !isSending) {
            // 延迟一点触发，避免和加载冲突
            const timer = setTimeout(() => {
                // 50% 概率触发
                if (Math.random() > 0.5) sendChatMessage(undefined, "主人刚进入页面，热情的打个招呼");
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [pet?.id]); // 依赖 pet.id 避免重复

    // 监听事件触发对话
    useEffect(() => {
        const unsubscribe = petEvents.subscribe((type, data) => {
            if (type === 'experience_gained') {
                // 原有的消息显示
                if (data.message) showSpeech(data.message);

                // 30% 概率触发 AI 追评，或者特定事件必触发
                if (data.source === 'photo' || Math.random() > 0.7) {
                    setTimeout(() => {
                        let context = `主人刚刚获得了经验。`;
                        if (data.source === 'photo') context = "主人刚上传了一张新照片到相册。";
                        if (data.source === 'memo_add') context = "主人刚添加了一个新备忘录。";
                        if (data.source === 'memo_complete') context = "主人刚完成了一个备忘录任务。";
                        sendChatMessage(undefined, context);
                    }, 3000); // 3秒后追评
                }
                refetch();
            } else if (type === 'refetch') {
                refetch();
            }
        });
        return unsubscribe;
    }, [showSpeech, refetch]);

    // 处理颜色更换
    const handleColorChange = async (colorId: string) => {
        if (colorId === 'none') {
            // 清除颜色 (使用 API 直接调用或通过 helper 传递 None)
            // 假设 changeColor 支持任意字符串，我们在 API 处理
            await changeColor('none');
            showSpeech('颜色已清除~');
        } else {
            await changeColor(colorId);
            showSpeech('换了新颜色！好漂亮~');
        }
        setMenuType('none');
    };

    // 处理配饰装备
    const handleEquip = async (accessoryId: string) => {
        if (accessoryId === 'none') {
            // 清除配饰 - 实际上需要更新 equippedItems 为空或移除 head
            // 我们手动调用 API
            await fetch('/api/pet', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'equip', equippedItems: {} }) // 清空
            });
            refetch();
            showSpeech('配饰已摘下~');
        } else {
            await equipItem('head', accessoryId);
            showSpeech('新装备！看起来怎么样？');
        }
        setMenuType('none');
    };

    // 拖拽处理
    const handleMouseDown = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest(`.${styles.menu}`) ||
            (e.target as HTMLElement).closest(`.${styles.statusPanel}`)) {
            return;
        }
        setIsDragging(true);
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
            dragOffset.current = {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
                w: rect.width,
                h: rect.height
            };
        }
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (!isDragging) return;
        // 使用实际捕获的宽高进行计算，避免跳动
        const { w, h, x: offsetX, y: offsetY } = dragOffset.current;
        const newX = window.innerWidth - e.clientX - (w - offsetX);
        const newY = window.innerHeight - e.clientY - (h - offsetY);

        setPosition({
            x: Math.max(0, Math.min(window.innerWidth - w, newX)),
            y: Math.max(0, Math.min(window.innerHeight - h, newY))
        });
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            return () => {
                window.removeEventListener('mousemove', handleMouseMove);
                window.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isDragging]);

    // 点击宠物切换菜单
    const handlePetClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!isDragging) {
            setMenuType(prev => prev === 'none' ? 'main' : 'none');
        }
    };

    // 关闭菜单 - 使用 mousedown 避免与菜单项 click 冲突
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            // 延迟检查，让菜单项的点击先执行
            setTimeout(() => {
                if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                    setMenuType('none');
                    setIsChatting(false); // 关闭聊天输入框
                }
            }, 10);
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // 初始加载状态
    if (loading || !pet) {
        return (
            <div className={styles.floatingPetContainer} style={{ right: 20, bottom: 120 }}>
                <div className={styles.petLoading} style={{
                    width: 150,
                    height: 150,
                    background: 'rgba(255,255,255,0.1)',
                    borderRadius: '50%',
                    backdropFilter: 'blur(4px)'
                }}>
                    🐾
                </div>
            </div>
        );
    }

    const mood = PET_CONFIG.getMood(pet.hunger, pet.happiness);
    const moodEmoji = PET_CONFIG.moods[mood as keyof typeof PET_CONFIG.moods];
    const evolutionName = PET_CONFIG.evolutionNames[pet.evolution];
    const requiredExp = PET_CONFIG.getRequiredExp(pet.level);
    const expProgress = (pet.experience / requiredExp) * 100;

    // 获取已装备的配饰
    const equippedAccessory = pet.equippedItems?.head
        ? PET_CONFIG.accessories.find(a => a.id === pet.equippedItems.head)
        : null;



    return (
        <div
            ref={containerRef}
            className={styles.floatingPetContainer}
            style={{
                right: position.x || 20,
                bottom: position.y || 120
            }}
        >
            {/* 聊天输入框 - 新设计 */}
            {isChatting && (
                <div className={styles.chatPanel} onClick={e => e.stopPropagation()}>
                    <div className={styles.chatHeader}>
                        <span>与 {pet.name} 对话</span>
                        <div className={styles.closeBtn} onClick={() => setIsChatting(false)}>✕</div>
                    </div>

                    <div className={styles.presetChips}>
                        <div className={styles.chip} onClick={() => sendChatMessage("帮我查一下待办事项")}>📝 查待办</div>
                        <div className={styles.chip} onClick={() => sendChatMessage("查看你的状态")}>📊 查状态</div>
                        <div className={styles.chip} onClick={() => sendChatMessage("讲个笑话吧")}>😄 讲笑话</div>
                        <div className={styles.chip} onClick={() => sendChatMessage("夸夸我")}>🥰 夸夸我</div>
                    </div>

                    <div className={styles.inputGroup}>
                        <input
                            className={styles.input}
                            type="text"
                            value={chatInput}
                            onChange={e => setChatInput(e.target.value)}
                            onKeyPress={e => e.key === 'Enter' && sendChatMessage()}
                            placeholder="说点什么..."
                            autoFocus
                        />
                        <button
                            className={styles.sendBtn}
                            onClick={() => sendChatMessage()}
                            disabled={isSending}
                        >
                            {isSending ? '...' : '➤'}
                        </button>
                    </div>
                </div>
            )}

            {/* 对话气泡 */}
            {speech && (
                <div className={styles.speechBubble}>
                    {speech}
                    <div
                        className={styles.closeSpeech}
                        onClick={(e) => { e.stopPropagation(); setSpeech(null); }}
                        title="关闭"
                    >
                        ✕
                    </div>
                </div>
            )}

            {/* 宠物主体 */}
            <div
                className={styles.petWrapper}
                onMouseDown={handleMouseDown}
                onClick={handlePetClick}
            >
                <div
                    className={`${styles.petBody} ${styles.live2dBody} ${isAnimating && animationType ? styles[animationType] : ''}`}
                >
                    {/* 颜色覆盖层 */}
                    {/* 颜色覆盖层 */}
                    {pet.color && (() => {
                        const colorConfig = PET_CONFIG.colors.find(c => c.id === pet.color);
                        if (colorConfig) {
                            // Live2D 模式下跳过渐变色（技术限制），传统模式支持所有颜色
                            if (pet.mode === 'live2d' && colorConfig.color.includes('gradient')) {
                                return null;
                            }
                            return (
                                <div
                                    className={styles.colorOverlay}
                                    style={{
                                        background: colorConfig.color,
                                        // 传统模式下调整大小以覆盖图片
                                        width: pet.mode === 'classic' ? '150px' : '130px',
                                        height: pet.mode === 'classic' ? '150px' : '130px',
                                        opacity: colorConfig.color.includes('gradient') ? 0.4 : 0.6
                                    }}
                                />
                            );
                        }
                        return null;
                    })()}


                    {/* 宠物渲染: Live2D 或 传统模式 */}
                    {pet.mode === 'classic' ? (
                        <div className={styles.classicModeWrapper}>
                            {pet.customSprite ? (
                                <img
                                    src={pet.customSprite}
                                    alt="Pet"
                                    style={{
                                        width: 150,
                                        height: 150,
                                        objectFit: 'contain',
                                        filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.1))'
                                    }}
                                />
                            ) : (
                                <span style={{ fontSize: '80px', lineHeight: 1 }}>
                                    {PET_CONFIG.moods[mood as keyof typeof PET_CONFIG.moods] || '🐱'}
                                </span>
                            )}
                        </div>
                    ) : (
                        <Live2DPet
                            ref={live2dRef}
                            modelPath="/wanko/runtime/wanko_touch.model3.json"
                            width={180}
                            height={180}
                            onLoad={handleLive2DLoad}
                            onError={handleLive2DError}
                        />
                    )}

                    {/* 配饰渲染 - 恢复显示 */}
                    {equippedAccessory && (
                        <div className={`${styles.accessory} ${styles[getAccessoryPosition(equippedAccessory.id)] || styles.top}`}>
                            {equippedAccessory.emoji}
                        </div>
                    )}

                    {/* 等级标签 */}
                    <span className={styles.levelBadge}>Lv.{pet.level}</span>
                </div>

                {/* 简易状态条 */}
                <div className={styles.statusBars}>
                    <div className={styles.statusRow} title={`经验: ${pet.experience}/${requiredExp}`}>
                        <span className={styles.statusIcon}>⭐</span>
                        <div className={styles.statusBar}>
                            <div className={`${styles.statusFill} ${styles.exp}`} style={{ width: `${expProgress}%` }} />
                        </div>
                    </div>
                    <div className={styles.statusRow} title={`饱腹: ${pet.hunger}%`}>
                        <span className={styles.statusIcon}>🍗</span>
                        <div className={styles.statusBar}>
                            <div className={`${styles.statusFill} ${styles.hunger}`} style={{ width: `${pet.hunger}%` }} />
                        </div>
                    </div>
                    <div className={styles.statusRow} title={`开心: ${pet.happiness}%`}>
                        <span className={styles.statusIcon}>❤️</span>
                        <div className={styles.statusBar}>
                            <div className={`${styles.statusFill} ${styles.happiness}`} style={{ width: `${pet.happiness}%` }} />
                        </div>
                    </div>
                </div>
            </div>

            {/* 独立聊天按钮 */}
            {!isChatting && (
                <div
                    onClick={handleChat}
                    style={{
                        position: 'absolute',
                        left: -40,
                        bottom: 40,
                        width: 40,
                        height: 40,
                        background: 'white',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                        cursor: 'pointer',
                        fontSize: '20px',
                        zIndex: 10
                    }}
                    title="对话"
                >
                    💬
                </div>
            )}

            {/* 主菜单 */}
            {menuType === 'main' && (
                <div className={styles.menu} onClick={(e) => e.stopPropagation()}>
                    <div className={styles.menuItem} onClick={handleFeed}>🍎 喂食</div>
                    <div className={styles.menuItem} onClick={handlePlay}>🎮 玩耍</div>
                    {/* Chat removed from here */}
                    <div className={styles.menuItem} onClick={() => setMenuType('actions')}>⚡ 动作</div>
                    <div className={styles.menuItem} onClick={() => setMenuType('status')}>📊 状态</div>
                    <div className={styles.menuItem} onClick={() => setMenuType('color')}>🎨 换色</div>
                    <div className={styles.menuItem} onClick={() => setMenuType('accessory')}>👑 配饰</div>
                    <div className={styles.menuItem} onClick={() => setMenuType('rename')}>✏️ 改名</div>
                </div>
            )}

            {/* 动作菜单 */}
            {menuType === 'actions' && (
                <div className={styles.menu}>
                    <div className={styles.menuItem} onClick={() => setMenuType('main')}>
                        <span>🔙</span> 返回
                    </div>
                    <div className={styles.menuItem} onClick={() => { live2dRef.current?.playMotion('Tap'); setMenuType('none'); }}>
                        <span>👆</span> 点击
                    </div>
                    <div className={styles.menuItem} onClick={() => { live2dRef.current?.playMotion('Shake'); setMenuType('none'); }}>
                        <span>👋</span> 摇晃
                    </div>
                    <div className={styles.menuItem} onClick={() => { live2dRef.current?.playMotion('Flick'); setMenuType('none'); }}>
                        <span>✨</span> 抚摸
                    </div>
                </div>
            )}

            {/* 状态面板 */}
            {menuType === 'status' && (
                <div className={styles.statusPanel} onClick={(e) => e.stopPropagation()}>
                    <h3>{pet.name} <span onClick={() => setMenuType('main')}>✕</span></h3>
                    <div className={styles.statRow}>
                        <span className={styles.statLabel}>阶段</span>
                        <span className={styles.statValue}>{evolutionName}</span>
                    </div>
                    <div className={styles.statRow}>
                        <span className={styles.statLabel}>等级</span>
                        <span className={styles.statValue}>Lv.{pet.level}</span>
                    </div>
                    <div className={styles.statRow}>
                        <span className={styles.statLabel}>经验</span>
                        <span className={styles.statValue}>{pet.experience}/{requiredExp}</span>
                    </div>
                    <div className={styles.progressBar}>
                        <div className={styles.progressFill} style={{ width: `${expProgress}%`, background: '#4CAF50' }} />
                    </div>
                    <div className={styles.statRow} style={{ marginTop: 8 }}>
                        <span className={styles.statLabel}>饱腹度</span>
                        <span className={styles.statValue}>{pet.hunger}%</span>
                    </div>
                    <div className={styles.statRow}>
                        <span className={styles.statLabel}>开心值</span>
                        <span className={styles.statValue}>{pet.happiness}%</span>
                    </div>
                </div>
            )}

            {/* 颜色选择 */}
            {menuType === 'color' && (
                <div className={styles.menu} onClick={(e) => e.stopPropagation()}>
                    <div className={styles.menuItem} onClick={() => setMenuType('main')}>← 返回</div>
                    {/* 清除按钮 */}
                    <div className={styles.menuItem} onClick={() => handleColorChange('none')}>
                        🚫 清除/默认
                    </div>
                    {PET_CONFIG.colors.map(c => (
                        <div
                            key={c.id}
                            className={`${styles.menuItem} ${pet.level < c.unlockLevel ? styles.disabled : ''}`}
                            onClick={() => pet.level >= c.unlockLevel && handleColorChange(c.id)}
                        >
                            <span style={{
                                width: 16, height: 16, borderRadius: '50%',
                                background: c.color, display: 'inline-block'
                            }} />
                            {c.name} {pet.level < c.unlockLevel && `(Lv.${c.unlockLevel})`}
                        </div>
                    ))}
                </div>
            )}

            {/* 配饰选择 */}
            {menuType === 'accessory' && (
                <div className={styles.menu} onClick={(e) => e.stopPropagation()}>
                    <div className={styles.menuItem} onClick={() => setMenuType('main')}>← 返回</div>
                    {/* 清除按钮 */}
                    <div className={styles.menuItem} onClick={() => handleEquip('none')}>
                        🚫 摘下所有
                    </div>
                    {PET_CONFIG.accessories.map(a => {
                        // 只要达到进化等级就视为解锁，容错手动修改数据库的情况
                        const unlocked = (pet.accessories?.includes(a.id)) || (pet.evolution >= a.evolution);
                        return (
                            <div
                                key={a.id}
                                className={`${styles.menuItem} ${!unlocked ? styles.disabled : ''}`}
                                onClick={() => unlocked && handleEquip(a.id)}
                            >
                                {a.emoji} {a.name} {!unlocked && `(${PET_CONFIG.evolutionNames[a.evolution]}解锁)`}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* 改名输入 */}
            {menuType === 'rename' && (
                <div className={styles.statusPanel} onClick={(e) => e.stopPropagation()}>
                    <h3>给宠物起个名字 <span onClick={() => setMenuType('main')}>✕</span></h3>
                    <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder={pet.name}
                        style={{
                            width: '100%',
                            padding: '8px',
                            border: '1px solid #ddd',
                            borderRadius: '6px',
                            marginBottom: '8px'
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                    />
                    <button
                        onClick={handleRename}
                        style={{
                            width: '100%',
                            padding: '8px',
                            background: '#FF69B4',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer'
                        }}
                    >
                        确定
                    </button>
                </div>
            )}
        </div>
    );
}
