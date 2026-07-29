import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:3000';
const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
if (!username || !password) {
    throw new Error('E2E_USERNAME 与 E2E_PASSWORD 必须配置');
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
const networkErrors = [];
page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', error => consoleErrors.push(error.message));
page.on('requestfailed', request => {
    networkErrors.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText ?? 'failed'}`);
});
page.on('response', response => {
    if (response.status() >= 400) {
        networkErrors.push(`${response.request().method()} ${response.url()} — ${response.status()}`);
    }
});

try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: '用户名' }).fill(username);
    await page.getByRole('textbox', { name: '密码' }).fill(password);
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForURL(`${baseUrl}/`);

    const assertFirstPaint = async () => {
        const heading = page.getByRole('heading', { name: '我们的 小世界' });
        await heading.waitFor();
        await page.waitForFunction(
            element => {
                const style = getComputedStyle(element);
                const stage = document.querySelector('[aria-label="宠物 Kitty"]');
                return Number(style.opacity) >= 0.9
                    && element.getBoundingClientRect().height > 0
                    && stage
                    && Number(getComputedStyle(stage).opacity) >= 0.9
                    && stage.getBoundingClientRect().height > 0;
            },
            await heading.elementHandle(),
        );
    };
    await assertFirstPaint();

    await page.waitForFunction(() => {
        const visible = [...document.images].filter(
            image => getComputedStyle(image).display !== 'none' && image.alt.includes('动画'),
        );
        return visible.length >= 1 && visible.every(image => image.complete && image.naturalWidth > 0);
    });

    const firstFrame = await page.locator('img[alt*="动画"]:visible').first().getAttribute('src');
    await page.waitForFunction(
        previous => document.querySelector('img[alt*="动画"]:not([style*="display: none"])')?.getAttribute('src') !== previous,
        firstFrame,
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await assertFirstPaint();

    await page.getByRole('link', { name: '备忘', exact: true }).click();
    await page.waitForURL(`${baseUrl}/memo`);
    try {
        await page.getByRole('heading', { name: /^想去吃/ }).waitFor({ timeout: 30_000 });
    } catch (error) {
        const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 800);
        throw new Error(
            `备忘页未完成加载；页面：${bodyText}；网络错误：${networkErrors.join(' | ') || '无'}；控制台错误：${consoleErrors.join(' | ') || '无'}`,
            { cause: error },
        );
    }

    await page.getByRole('link', { name: '首页', exact: true }).click();
    await page.waitForURL(`${baseUrl}/`);
    await assertFirstPaint();
    await page.waitForTimeout(1_800);

    await mkdir('output/playwright', { recursive: true });
    await page.screenshot({ path: 'output/playwright/final-home.png', fullPage: false });

    if (networkErrors.length) {
        throw new Error(`浏览器网络错误：${networkErrors.join(' | ')}`);
    }
    if (consoleErrors.length) {
        throw new Error(`浏览器控制台错误：${consoleErrors.join(' | ')}`);
    }
    console.log(JSON.stringify({
        login: true,
        homeFrames: true,
        memoLoaded: true,
        returnedHome: true,
        consoleErrors: 0,
    }));
} finally {
    await context.close();
    await browser.close();
}
