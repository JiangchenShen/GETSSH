/**
 * MOOVIER SUPREME - Physics & Motion Engine Constants
 * 
 * 此文件定义了 Cinematic Soul（电影级灵魂）的核心运动语言。
 * 绝对禁止在物理弹簧中使用 `duration` 参数。
 */

// ==========================================
// 第一运动语言：物理弹簧 (Spring Physics)
// 适用场景：所有涉及位置(x/y)、尺寸(scale/width/height)、层级变化的 UI 动效
// ==========================================

/**
 * SPRING_FLUID（流体弹簧）
 * 模拟一个略显沉重的物体在无摩擦表面滑动。
 * 适用：大尺寸磁贴入场、多窗口撕裂、悬浮 Hover (y轴抬升)。
 */
export const SPRING_FLUID = {
  type: "spring",
  stiffness: 120,
  damping: 20,
  mass: 1.2
} as const;

/**
 * SPRING_SNAPPY（清脆弹簧）
 * 模拟一个轻巧、紧绷的机械结构迅速卡入到位。
 * 适用：快速点击反馈 (Active/Tap scale)、Toggle 状态切换、控制中心小面板折叠。
 */
export const SPRING_SNAPPY = {
  type: "spring",
  stiffness: 300,
  damping: 25,
  mass: 0.8
} as const;

/**
 * SPRING_GENTLE（舒缓弹簧）
 * 平滑且不张扬的运动。
 * 适用：非焦点磁贴的景深缩放 (scale: 0.992)、相邻磁贴间距的自动填充补位。
 */
export const SPRING_GENTLE = {
  type: "spring",
  stiffness: 100,
  damping: 18,
  mass: 1.0
} as const;


// ==========================================
// 第二运动语言：定制贝塞尔曲线 (Cinematic Bezier)
// 适用场景：纯透明度 (opacity) 渐变、颜色过渡、模糊 (blur) 半径变化
// ==========================================

/**
 * CINEMATIC_IN
 * 慢启动，快到达，无缓出。
 * 视觉意图：像物体被突然赋予速度，或摄影机的快速推镜 (Push-in)。
 */
export const CINEMATIC_IN = [0.32, 0, 0.67, 0] as const;

/**
 * CINEMATIC_OUT
 * 快启动，慢收尾，带轻微余韵。
 * 视觉意图：像物体在阻力中减速至静止，或画面溶解 (Dissolve)。用于焦点散焦。
 */
export const CINEMATIC_OUT = [0.33, 1, 0.68, 1] as const;

/**
 * CINEMATIC_SNAP
 * 极速响应，中段近乎线性，两端极短缓冲。
 * 视觉意图：高精度机械的咔哒感，或强烈的高频颜色闪切。
 */
export const CINEMATIC_SNAP = [0.87, 0, 0.13, 1] as const;
