/**
 * 宠物窗口的页面。
 *
 * **这里刻意几乎是空的。** 宠物本身由根布局里的 `FloatingPetWrapper` 渲染，
 * 全站共用同一个组件——桌面版不该有第二份宠物实现，否则改个动作要改两处。
 *
 * 这个路由的作用只是给 `DesktopChrome` 一个信号：把页面其余部分（导航、主
 * 内容区、背景色）全藏掉，只留下那只宠物和透明底。具体规则在 globals.css 的
 * `[data-desktop-pet="true"]` 一节。
 */
export default function DesktopPetPage() {
    return null;
}
