'use client';

import Card from '../components/ui/Card';
import PasskeyManager from '../components/PasskeyManager';

/**
 * 主站的账号设置。**目前只有一件事：passkey。**
 *
 * 没做进底部导航——那五个格子是内容入口（首页/故事/相册/计划/聊天/留言），
 * 塞一个「设置」进去会稀释它们。这一页从登录页的提示进来，或者直接敲地址；
 * 一年也用不到几次的东西不该占着常驻位置。
 *
 * 加钥匙**必须在当前设备上、以本人身份**做：钥匙生成在设备的安全芯片里，
 * 服务端只拿到公钥，所以后台也没法替谁加一把。
 */
export default function SettingsPage() {
    return (
        <div className="mx-auto w-full max-w-lg p-4 md:p-6">
            <h1 className="m-0 mb-4 font-display text-2xl text-ink">账号设置</h1>
            <Card className="p-5">
                <PasskeyManager base="/auth/passkey" />
            </Card>
        </div>
    );
}
